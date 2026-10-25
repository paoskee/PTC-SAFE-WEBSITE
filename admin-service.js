import { supabase } from "./supabase-config.js";

const ALERT_COLUMNS =
  "id,user_id,user_name,user_phone,emergency_type,latitude,longitude,status,created_at";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function requireAdminSession() {
  const db = client();
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Sign in as an administrator to update alerts.");

  const { data: isAdmin, error: adminError } = await db.rpc("is_admin");
  if (adminError) throw adminError;
  if (isAdmin !== true) {
    throw new Error("Administrator access is required to update alerts.");
  }
}

function documents(rows = []) {
  return rows.map((row) => {
    const { data, ...columns } = row;
    const nonNullColumns = Object.fromEntries(
      Object.entries(columns).filter(([, value]) => value !== null)
    );
    return {
      ...(data && typeof data === "object" ? data : {}),
      ...nonNullColumns,
    };
  });
}

function publicUserProfile(row) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return {
    id: String(row.id),
    name: row.name || data.name || "",
    email: row.email || data.email || "",
    course: row.course || data.course || "",
    role: row.role || data.role || "",
    phone:
      row.phone || row.contact_number || data.phone || data.contact_number || "",
  };
}

function reportError(onError, error) {
  if (onError) onError(error);
  else console.error("Supabase subscription failed.", error);
}

const locallyPublishedBroadcastIds = new Set();

function subscribeToDocuments(
  table,
  orderField,
  onUpdate,
  onError,
  rowLimit,
  selectFields = "id,data"
) {
  const db = client();
  const rowsById = new Map();
  const pendingChanges = [];
  let initialized = false;
  let active = true;
  const channel = db
    .channel(`${table}-dashboard-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        if (table === "alerts") {
          console.log("Supabase alerts realtime payload:", payload);
        }
        if (!initialized) {
          pendingChanges.push(payload);
          return;
        }
        applyChange(payload);
        publish();
      }
    )
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reportError(onError, error || new Error(`Realtime channel status: ${status}`));
      }
    });

  function applyChange(payload) {
    const row = payload.new;
    const oldRow = payload.old;
    const id = row?.id || oldRow?.id;
    if (!id) return;
    if (payload.eventType === "DELETE") rowsById.delete(id);
    else rowsById.set(id, row);
  }

  function publish() {
    if (!active) return;
    let result = documents([...rowsById.values()]);
    if (orderField) {
      result.sort((first, second) =>
        String(second[orderField] || "").localeCompare(
          String(first[orderField] || "")
        )
      );
    }
    if (rowLimit) result = result.slice(0, rowLimit);
    onUpdate(result);
  }

  const load = async () => {
    const pageSize = 1000;
    const loadedRows = [];
    let offset = 0;
    while (active) {
      let query = db.from(table).select(selectFields);
      if (orderField) {
        query = query.order(`data->>${orderField}`, { ascending: false });
      }
      if (rowLimit) query = query.limit(rowLimit);
      else query = query.range(offset, offset + pageSize - 1);
      const { data, error } = await query;
      if (error) {
        reportError(onError, error);
        return;
      }
      const page = data || [];
      if (table === "alerts") {
        console.log("Supabase alerts fetch payload:", page);
      }
      loadedRows.push(...page);
      if (rowLimit || page.length < pageSize) break;
      offset += page.length;
    }
    if (!active) return;
    rowsById.clear();
    loadedRows.forEach((row) => rowsById.set(row.id, row));
    initialized = true;
    pendingChanges.forEach(applyChange);
    pendingChanges.length = 0;
    publish();
  };

  void load();
  return () => {
    active = false;
    void db.removeChannel(channel);
  };
}

async function updateDocument(table, id, patch, expectedStatus) {
  const db = client();
  const { data: current, error: readError } = await db
    .from(table)
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error(`The ${table} record no longer exists.`);
  if (
    expectedStatus !== undefined &&
    current.data?.status !== expectedStatus
  ) {
    throw new Error(`The ${table} record is no longer ${expectedStatus}.`);
  }

  let query = db
    .from(table)
    .update({ data: { ...(current.data || {}), ...patch } })
    .eq("id", id);
  if (expectedStatus !== undefined) {
    query = query.eq("data->>status", expectedStatus);
  }
  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error(`The ${table} record changed before the update completed.`);
  }
}

async function updateRequestStatus(requestId, fromStatus, patch) {
  await updateDocument("emergency_requests", requestId, patch, fromStatus);
}

export async function assignResponder(incidentId, responderData) {
  await updateDocument("incidents", incidentId, {
    status: "responding",
    assignedResponder: {
      id: responderData.id,
      name: responderData.name,
      specialization: responderData.specialization,
      etaMinutes: responderData.etaMinutes,
      distanceMeters: responderData.distanceMeters,
    },
    dispatchedAt: new Date().toISOString(),
  });
}

export async function resolveIncident(incidentId) {
  await updateDocument("incidents", incidentId, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  });
}

export function subscribeToBroadcasts(onUpdateCallback, onError) {
  return subscribeToDocuments(
    "broadcasts",
    "sentAt",
    onUpdateCallback,
    onError,
    50
  );
}

export function subscribeToCampusBroadcasts(onBroadcast, onError) {
  const db = client();
  let active = true;
  const channel = db
    .channel("campus_broadcasts")
    .on("broadcast", { event: "campus_alert" }, ({ payload }) => {
      if (
        !active ||
        (payload?.id && locallyPublishedBroadcastIds.has(String(payload.id)))
      ) return;
      onBroadcast(payload);
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reportError(onError, error || new Error(`Broadcast channel status: ${status}`));
      }
    });

  return () => {
    active = false;
    void db.removeChannel(channel);
  };
}

export function subscribeToEmergencyRequests(onUpdateCallback, onError) {
  return subscribeToUserEnrichedDocuments(
    "emergency_requests",
    onUpdateCallback,
    onError
  );
}

export function subscribeToAlerts(onUpdateCallback, onError) {
  return subscribeToUserEnrichedDocuments(
    "alerts",
    onUpdateCallback,
    onError,
    "*"
  );
}

function subscribeToUserEnrichedDocuments(
  table,
  onUpdateCallback,
  onError,
  selectFields = "*"
) {
  const db = client();
  let active = true;
  let version = 0;
  const unsubscribe = subscribeToDocuments(
    table,
    null,
    async (records) => {
      const currentVersion = ++version;
      const userIds = [...new Set(records
        .map((record) => record.user_id || record.userId || record.uid)
        .filter(Boolean)
        .map(String))];
      let profiles = new Map();
      if (userIds.length) {
        const { data, error } = await db
          .from("users")
          .select("*")
          .in("id", userIds);
        if (error) reportError(onError, error);
        else {
          profiles = new Map((data || []).map((row) => [
            String(row.id),
            publicUserProfile(row),
          ]));
        }
      }
      if (!active || currentVersion !== version) return;
      onUpdateCallback(records.map((record) => {
        const userId = String(record.user_id || record.userId || record.uid || "");
        return {
          ...record,
          user_id: userId,
          userProfile:
            profiles.get(userId) ||
            record.userProfile ||
            record.userInfo ||
            null,
        };
      }));
    },
    onError,
    undefined,
    selectFields
  );
  return () => {
    active = false;
    unsubscribe();
  };
}

export function subscribeToSOSRecords(onUpdateCallback, onError) {
  const db = client();
  const recordsBySource = new Map();
  const unsubscribers = [];
  let active = true;
  let publishVersion = 0;

  async function publish() {
    const version = ++publishVersion;
    const records = [...recordsBySource.entries()].flatMap(([source, rows]) =>
      rows.map((record) => ({ ...record, _sourceTable: source }))
    );
    const userIds = [...new Set(records
      .map((record) => record.user_id || record.userId || record.uid)
      .filter(Boolean)
      .map(String))];
    let profiles = new Map();

    if (userIds.length) {
      const { data, error } = await db
        .from("users")
        .select("*")
        .in("id", userIds);
      if (error) {
        reportError(onError, error);
      } else {
        profiles = new Map((data || []).map((row) => [
          String(row.id),
          publicUserProfile(row),
        ]));
      }
    }

    if (!active || version !== publishVersion) return;
    onUpdateCallback(records.map((record) => {
      const userId = String(record.user_id || record.userId || record.uid || "");
      return {
        ...record,
        user_id: userId,
        userProfile:
          profiles.get(userId) ||
          record.userProfile ||
          record.userInfo ||
          null,
      };
    }));
  }

  for (const table of ["alerts", "emergency_requests", "incidents"]) {
    recordsBySource.set(table, []);
    unsubscribers.push(
      subscribeToDocuments(
        table,
        null,
        (records) => {
          recordsBySource.set(table, records);
          void publish().catch((error) => reportError(onError, error));
        },
        onError,
        undefined,
        "*"
      )
    );
  }

  return () => {
    active = false;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export function subscribeToIncidents(onUpdateCallback, onError) {
  const db = client();
  const incidentsById = new Map();
  const pendingChanges = [];
  let initialized = false;
  let active = true;
  let changeQueue = Promise.resolve();
  const channel = db
    .channel("public:incidents")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "incidents" },
      (payload) => {
        if (!initialized) {
          pendingChanges.push(payload);
          return;
        }
        changeQueue = changeQueue
          .then(() => applyIncidentChange(payload))
          .catch((error) => reportError(onError, error));
      }
    )
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reportError(onError, error || new Error(`Realtime channel status: ${status}`));
      }
    });

  function publish() {
    if (active) onUpdateCallback([...incidentsById.values()]);
  }

  async function loadUserProfiles(userIds) {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return new Map();

    const result = await db.from("users").select("*").in("id", ids);
    if (result.error) throw result.error;
    return new Map(
      (result.data || []).map((user) => [
        String(user.id),
        publicUserProfile(user),
      ])
    );
  }

  async function hydrate(rows) {
    const records = documents(rows || []);
    const profiles = await loadUserProfiles(
      records.map((record) => record.user_id || record.userId)
    );
    return records.map((record) => ({
      ...record,
      user_id: record.user_id || record.userId || "",
      latitude: record.latitude ?? record.lat,
      longitude: record.longitude ?? record.lng,
      created_at:
        record.created_at || record.createdAt || record.timestamp || null,
      users:
        record.users ||
        profiles.get(String(record.user_id || record.userId || "")) ||
        null,
    }));
  }

  async function loadInitialIncidents() {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; active; offset += pageSize) {
      const result = await db
        .from("incidents")
        .select("*")
        .range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      const page = result.data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (!active) return;
    const hydrated = await hydrate(rows);
    incidentsById.clear();
    hydrated.forEach((incident) => {
      if (incident.id) incidentsById.set(String(incident.id), incident);
    });
    initialized = true;
    for (const payload of pendingChanges.splice(0)) {
      await applyIncidentChange(payload, false);
    }
    publish();
  }

  async function applyIncidentChange(payload, publishAfter = true) {
    if (!active) return;
    const row = payload.new;
    const oldRow = payload.old;
    const id = row?.id || oldRow?.id;
    if (!id) return;
    if (payload.eventType === "DELETE") {
      incidentsById.delete(String(id));
    } else {
      const [incident] = await hydrate([row]);
      if (!active) return;
      incidentsById.set(String(id), incident);
    }
    if (publishAfter) publish();
  }

  void loadInitialIncidents().catch((error) => reportError(onError, error));
  return () => {
    active = false;
    void db.removeChannel(channel);
  };
}

export function subscribeToUsers(onUpdateCallback, onError) {
  return subscribeToDocuments(
    "users",
    null,
    onUpdateCallback,
    onError,
    undefined,
    "*"
  );
}

export async function refreshDashboardData() {
  const db = client();
  const tables = ["emergency_requests", "alerts", "incidents"];
  const loadTable = async (table) => {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db
        .from(table)
        .select("*")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return documents(rows);
  };
  const tableRows = await Promise.all(tables.map(loadTable));

  const recordsByTable = new Map(
    tables.map((table, index) => [
      table,
      tableRows[index],
    ])
  );
  const records = tables.flatMap((table) =>
    recordsByTable.get(table).map((record) => ({
      ...record,
      _sourceTable: table,
    }))
  );
  const userIds = [...new Set(
    records
      .map((record) => record.user_id || record.userId || record.uid)
      .filter(Boolean)
      .map(String)
  )];
  let profiles = new Map();
  if (userIds.length) {
    const { data, error } = await db
      .from("users")
      .select("*")
      .in("id", userIds);
    if (error) throw error;
    profiles = new Map((data || []).map((row) => [
      String(row.id),
      publicUserProfile(row),
    ]));
  }

  const enrich = (record) => {
    const userId = String(record.user_id || record.userId || record.uid || "");
    const profile =
      profiles.get(userId) ||
      record.userProfile ||
      record.userInfo ||
      null;
    return {
      ...record,
      user_id: userId,
      userProfile: profile,
      ...(record._sourceTable === "incidents" ? { users: profile } : {}),
    };
  };
  return {
    emergencyRequests: recordsByTable.get("emergency_requests").map(enrich),
    alerts: recordsByTable.get("alerts").map(enrich),
    incidents: recordsByTable.get("incidents").map(enrich),
    sosRecords: records.map(enrich),
  };
}

export async function getStaffResponders() {
  const { data, error } = await client().from("users").select("id,data");
  if (error) throw error;
  return documents(data).filter(
    (user) =>
      typeof user.staffSpecialty === "string" &&
      user.staffSpecialty.trim().length > 0
  );
}

export async function acceptAndDispatchAlert(alertId, responder) {
  await dispatchAlert(alertId, responder);
}

const SOS_TABLES = new Set(["alerts", "emergency_requests", "incidents"]);

function alertStatusForStorage(status) {
  return ({
    Accepted: "dispatched",
    Responding: "dispatched",
    Dispatched: "dispatched",
    Resolved: "resolved",
    Declined: "declined",
    Cancelled: "cancelled",
    "False Alarm": "false_alarm",
  })[status] || String(status).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

async function updateAlertRow(alertId, updates, expectedStatuses, requiredFields = []) {
  await requireAdminSession();
  const db = client();
  const { data: current, error: readError } = await db
    .from("alerts")
    .select("*")
    .eq("id", alertId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) {
    throw new Error(
      expectedStatuses?.length
        ? "The alert is no longer pending."
        : "The alert no longer exists."
    );
  }
  const missingFields = requiredFields.filter((field) =>
    !Object.hasOwn(current, field)
  );
  if (missingFields.length) {
    throw new Error(
      `Cannot assign this responder: the alerts table is missing required column${missingFields.length === 1 ? "" : "s"} ${missingFields.join(", ")}.`
    );
  }
  if (
    requiredFields.includes("assigned_responder_id") &&
    current.assigned_responder_id
  ) {
    throw new Error("This alert already has an assigned responder.");
  }
  const supportedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([field]) => Object.hasOwn(current, field))
  );

  let query = db.from("alerts").update(supportedUpdates).eq("id", alertId);
  if (expectedStatuses?.length) query = query.in("status", expectedStatuses);
  if (requiredFields.includes("assigned_responder_id")) {
    query = current.assigned_responder_id == null
      ? query.is("assigned_responder_id", null)
      : query.eq("assigned_responder_id", current.assigned_responder_id);
  }

  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error(
      expectedStatuses?.length
        ? "The alert is no longer pending."
        : "The alert no longer exists."
    );
  }
}

async function dispatchAlert(alertId, responder) {
  await updateAlertRow(
    alertId,
    {
      assigned_responder_id: responder.id,
      responder_status: "pending_acceptance",
      responder_id: responder.id,
      responder_name: responder.name,
      responder_phone: responder.phone,
      responder_unit: responder.unit,
      responder_specialty: responder.specialty,
      responder_eta_minutes: responder.etaMinutes,
      admin_note: responder.adminNote || null,
    },
    ["pending", "active", "new", "unhandled"],
    ["assigned_responder_id", "responder_status"]
  );
}

function statusForStorage(status, currentStatus) {
  const value = {
    Accepted: "accepted",
    Responding: "responding",
    Resolved: "resolved",
    Declined: "cancelled",
    "False Alarm": "false_alarm",
  }[status] || status;
  return typeof currentStatus === "string" &&
    currentStatus === currentStatus.toLowerCase()
    ? value.toLowerCase()
    : value;
}

async function updateSOSRecord(table, recordId, patch, expectedStatuses) {
  if (!SOS_TABLES.has(table)) throw new Error("Unsupported SOS record table.");
  const db = client();
  const { data: current, error: readError } = await db
    .from(table)
    .select("*")
    .eq("id", recordId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error("The SOS record no longer exists.");

  const isDocumentRecord =
    current.data &&
    typeof current.data === "object" &&
    (Object.hasOwn(current.data, "status") ||
      !Object.hasOwn(current, "status"));
  const currentStatus = isDocumentRecord
    ? current.data.status
    : current.status;
  if (
    expectedStatuses?.length &&
    !expectedStatuses.includes(String(currentStatus || "").toLowerCase())
  ) {
    throw new Error("The SOS record is no longer pending.");
  }

  const normalizedPatch = { ...patch };
  if (Object.hasOwn(normalizedPatch, "status")) {
    normalizedPatch.status = statusForStorage(
      normalizedPatch.status,
      currentStatus
    );
  }
  const updates = isDocumentRecord
    ? { data: { ...current.data, ...normalizedPatch } }
    : Object.fromEntries(
        Object.entries(normalizedPatch)
          .map(([field, value]) => {
            if (Object.hasOwn(current, field)) return [field, value];
            const snakeField = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
            if (Object.hasOwn(current, snakeField)) return [snakeField, value];
            if (field === "cancelledAt" && Object.hasOwn(current, "canceled_at")) {
              return ["canceled_at", value];
            }
            return null;
          })
          .filter(Boolean)
      );
  let query = db.from(table).update(updates).eq("id", recordId);
  if (expectedStatuses?.length && !isDocumentRecord) {
    query = query.eq("status", currentStatus);
  }
  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The SOS record changed before the update completed.");
}

export async function dispatchSOSRecord(table, recordId, responder) {
  if (table === "alerts") {
    await dispatchAlert(recordId, responder);
    return;
  }
  const now = new Date().toISOString();
  await updateSOSRecord(
    table,
    recordId,
    {
      status: "Accepted",
      assignedResponderId: responder.id,
      responderName: responder.name,
      responderPhone: responder.phone,
      responderUnit: responder.unit,
      responderSpecialty: responder.specialty,
      responderEtaMinutes: responder.etaMinutes,
      acceptedAt: now,
      dispatchedAt: now,
    },
    ["pending", "active", "new", "unhandled"]
  );
}

export async function updateSOSRecordStatus(table, recordId, status) {
  if (table === "alerts") {
    await updateAlertStatus(recordId, status);
    return;
  }
  const patch = { status };
  if (status === "Resolved") patch.resolvedAt = new Date().toISOString();
  if (status === "Declined" || status === "False Alarm") {
    patch.cancelledAt = new Date().toISOString();
  }
  await updateSOSRecord(table, recordId, patch);
}

export async function updateSOSResponderLocation(table, recordId, latitude, longitude) {
  if (table === "alerts") {
    await updateAlertResponderLocation(recordId, latitude, longitude);
    return;
  }
  await updateSOSRecord(table, recordId, {
    responderLatitude: latitude,
    responderLongitude: longitude,
    responderLocationUpdatedAt: new Date().toISOString(),
  });
}

export async function deleteSOSRecord(table, recordId) {
  if (!SOS_TABLES.has(table)) throw new Error("Unsupported SOS record table.");
  if (table === "alerts") await requireAdminSession();
  const { data, error } = await client()
    .from(table)
    .delete()
    .eq("id", recordId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The SOS record no longer exists.");
}

export async function updateAlertStatus(alertId, status) {
  const updates = { status: alertStatusForStorage(status) };
  if (updates.status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }
  await updateAlertRow(alertId, updates);
}

export async function updateAlertResponderLocation(alertId, latitude, longitude) {
  await updateAlertRow(alertId, {
    responder_latitude: latitude,
    responder_longitude: longitude,
    responder_location_updated_at: new Date().toISOString(),
  });
}

export async function getActiveAlerts() {
  await requireAdminSession();
  const { data, error } = await client()
    .from("alerts")
    .select(ALERT_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  console.log("Supabase pending alerts fetch payload:", data || []);
  return data || [];
}

export async function deleteAlertRecord(alertId) {
  await requireAdminSession();
  const { data, error } = await client()
    .from("alerts")
    .delete()
    .eq("id", alertId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The SOS record no longer exists.");
}

export async function acceptEmergencyRequest(requestId, responderInfo, adminId) {
  const now = new Date().toISOString();
  await updateRequestStatus(requestId, "pending", {
    status: "accepted",
    responderInfo,
    acceptedAt: now,
    updatedAt: now,
    handledBy: adminId,
  });
}

export async function cancelEmergencyRequest(requestId, adminId) {
  const now = new Date().toISOString();
  await updateRequestStatus(requestId, "pending", {
    status: "cancelled",
    cancelledAt: now,
    updatedAt: now,
    handledBy: adminId,
  });
}

export async function resolveEmergencyRequest(requestId, adminId) {
  const now = new Date().toISOString();
  await updateRequestStatus(requestId, "accepted", {
    status: "resolved",
    resolvedAt: now,
    updatedAt: now,
    handledBy: adminId,
  });
}

export async function updateEmergencyResponderLocation(requestId, location) {
  const now = new Date().toISOString();
  await updateRequestStatus(requestId, "accepted", {
    responderLocation: {
      lat: location.lat,
      lng: location.lng,
    },
    updatedAt: now,
  });
}

export async function sendBroadcast({
  message,
  quickType,
  urgency,
  audience,
  building,
  adminName,
}) {
  const sentAt = new Date().toISOString();
  const severity =
    urgency === "Critical" || urgency === "Emergency"
      ? "danger"
      : urgency === "Warning"
      ? "warning"
      : "info";
  const title =
    severity === "danger"
      ? "CAMPUS EMERGENCY ALERT"
      : severity === "warning"
      ? "CAMPUS WARNING"
      : quickType && quickType !== "Custom"
      ? quickType.toUpperCase()
      : "CAMPUS ANNOUNCEMENT";
  const data = {
    message,
    quickType,
    urgency,
    title,
    severity,
    audience,
    sentBy: adminName,
    sentAt,
  };
  if (building) data.building = building;

  const db = client();
  const { data: row, error } = await db
    .from("broadcasts")
    .insert({ data })
    .select("id")
    .single();
  if (error) throw error;

  const payload = {
    id: String(row.id),
    title,
    message,
    severity,
    audience,
    ...(building ? { building } : {}),
    timestamp: sentAt,
    sentBy: adminName,
  };
  locallyPublishedBroadcastIds.add(payload.id);
  if (locallyPublishedBroadcastIds.size > 100) {
    locallyPublishedBroadcastIds.delete(locallyPublishedBroadcastIds.values().next().value);
  }

  const channel = db.channel("campus_broadcasts");
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to the campus broadcast channel."));
      }, 10000);
      channel.subscribe((status, subscribeError) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(
            subscribeError ||
              new Error(`Campus broadcast channel status: ${status}`)
          );
        }
      });
    });

    const sendStatus = await channel.send({
      type: "broadcast",
      event: "campus_alert",
      payload,
    });
    if (sendStatus !== "ok") {
      throw new Error(`Supabase Realtime broadcast returned ${sendStatus}.`);
    }
    return { id: row.id, realtimeSent: true };
  } catch (broadcastError) {
    const error = new Error(
      `Broadcast was saved, but live delivery failed: ${broadcastError.message}`
    );
    error.persistedId = row.id;
    throw error;
  } finally {
    void db.removeChannel(channel);
  }
}
