import { isSupabaseConfigured } from "./supabase-config.js";

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
const hiddenField = (key) => /(password|token|secret|credential)/i.test(key);

let users = [];
let selectedCategory = "all";
let selectedUserId = null;
let sosLocations = new Map();
let sosRequests = [];
let sosAlerts = [];

function displayValue(value) {
  if (value == null || value === "") return "";
  if (typeof value?.toDate === "function") return value.toDate().toLocaleString();
  if (value instanceof Date) return value.toLocaleString();
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !hiddenField(key))
      .map(([key, nested]) => `${key}: ${displayValue(nested)}`)
      .filter((entry) => !entry.endsWith(": "))
      .join(" · ");
  }
  return String(value);
}

function findNestedValue(value, keys) {
  if (!value || typeof value !== "object" || value instanceof Date || typeof value.toDate === "function") {
    return "";
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      keys.includes(key) &&
      (typeof nested === "string" && nested.trim() ||
        typeof nested === "number" ||
        typeof nested === "boolean")
    ) {
      return String(nested).trim();
    }
  }
  for (const [key, nested] of Object.entries(value)) {
    if (!hiddenField(key) && nested && typeof nested === "object") {
      const match = findNestedValue(nested, keys);
      if (match) return match;
    }
  }
  return "";
}

function fieldValue(user, keys) {
  for (const key of keys) {
    const value = user[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return findNestedValue(user, keys);
}

function findField(value, keys) {
  if (!value || typeof value !== "object" || value instanceof Date || typeof value.toDate === "function") {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key)) return nested;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (!hiddenField(key) && nested && typeof nested === "object") {
      const match = findField(nested, keys);
      if (match !== undefined) return match;
    }
  }
  return undefined;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) {
      return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coordinates(value) {
  if (!value || typeof value !== "object") return null;
  const latitude = Number(value.lat ?? value.latitude);
  const longitude = Number(value.lng ?? value.longitude);
  return Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { lat: latitude, lng: longitude }
    : null;
}

function profilePresence(user) {
  const onlineValue = findField(user, ["is_online", "isOnline", "online"]);
  const seenAt = timestampMillis(findField(user, [
    "last_seen_at",
    "lastSeenAt",
    "last_seen",
    "lastSeen",
    "heartbeat_at",
    "heartbeatAt",
    "last_heartbeat_at",
    "lastHeartbeatAt",
  ]));
  const normalizedOnline = String(onlineValue ?? "").trim().toLowerCase();
  const explicitOnline = typeof onlineValue === "boolean"
    ? onlineValue
    : ["true", "1", "online", "active", "connected"].includes(normalizedOnline)
      ? true
      : ["false", "0", "offline", "inactive", "disconnected"].includes(normalizedOnline)
        ? false
        : null;
  const age = seenAt === null ? null : Date.now() - seenAt;
  const online = explicitOnline === false
    ? false
    : seenAt !== null
      ? age >= -30000 && age <= 120000
      : explicitOnline === true;

  const dutyValue = findField(user, [
    "is_on_duty",
    "isOnDuty",
    "on_duty",
    "onDuty",
    "is_on_shift",
    "isOnShift",
    "shift_status",
    "shiftStatus",
    "duty_status",
    "dutyStatus",
  ]);
  const normalizedDuty = String(dutyValue ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const onDuty = typeof dutyValue === "boolean"
    ? dutyValue
    : ["true", "1", "on_duty", "on_shift", "available", "active"].includes(normalizedDuty)
      ? true
      : ["false", "0", "off_duty", "off_shift", "inactive", "unavailable"].includes(normalizedDuty)
        ? false
        : null;
  return { online, onDuty, lastSeen: seenAt };
}

function profileLocation(user) {
  const locationKeys = [
    "last_known_location",
    "lastKnownLocation",
    "last_location",
    "lastLocation",
    "current_location",
    "currentLocation",
    "userLocation",
    "location",
    "coordinates",
    "position",
  ];
  for (const key of locationKeys) {
    const location = coordinates(user[key]);
    if (location) return location;
  }
  const direct = coordinates(user);
  if (direct) return direct;
  for (const [key, nested] of Object.entries(user)) {
    if (!hiddenField(key) && nested && typeof nested === "object") {
      const location = profileLocation(nested);
      if (location) return location;
    }
  }
  return null;
}

function onlineState(user) {
  const value = findField(user, [
    "isOnline",
    "is_online",
    "online",
    "connected",
    "onlineStatus",
    "online_status",
    "presenceStatus",
    "presence_status",
    "connectionState",
    "connection_state",
  ]) ?? user.presence?.status ??
    (["online", "offline"].includes(String(user.status || "").toLowerCase())
      ? user.status
      : undefined);
  const normalizedValue = String(value ?? "").trim().toLowerCase();
  const explicit = typeof value === "boolean"
    ? value
    : ["true", "1", "online", "connected", "active"].includes(normalizedValue)
      ? true
      : ["false", "0", "offline", "disconnected", "inactive"].includes(normalizedValue)
        ? false
        : null;
  const lastSeen = timestampMillis(
    findField(user, [
      "lastSeen",
      "last_seen",
      "lastSeenAt",
      "last_seen_at",
      "lastActiveAt",
      "last_active_at",
      "lastActivityAt",
      "last_activity_at",
      "lastOnlineAt",
      "last_online_at",
      "heartbeatAt",
      "heartbeat_at",
      "lastHeartbeatAt",
      "last_heartbeat_at",
    ])
  );
  const age = lastSeen === null ? null : Date.now() - lastSeen;
  const recentlySeen = age !== null && age >= -30000 && age <= 120000;
  return {
    online: explicit === false
      ? false
      : lastSeen !== null
        ? recentlySeen
        : explicit === true,
    lastSeen,
  };
}

function locationForUser(user) {
  const presence = profilePresence(user);
  const liveLocation = coordinates(user.current_location) ||
    coordinates(user.currentLocation) ||
    coordinates(user.location) ||
    coordinates(user);
  const lastKnownLocation = coordinates(user.last_known_location) ||
    coordinates(user.lastKnownLocation) ||
    coordinates(user.last_location) ||
    coordinates(user.lastLocation);
  const profile = presence.online && presence.onDuty === true
    ? liveLocation || profileLocation(user)
    : lastKnownLocation || profileLocation(user);
  const profileUpdatedAt = timestampMillis(
    findField(user, [
      "location_updated_at",
      "locationUpdatedAt",
      "last_location_updated_at",
      "lastLocationUpdatedAt",
      "locationTimestamp",
      "last_seen_at",
      "lastSeen",
      "updatedAt",
    ])
  );
  const fromSOS = sosLocations.get(user.id);
  if (fromSOS && (!profile || fromSOS.updatedAt > (profileUpdatedAt ?? -Infinity))) {
    return fromSOS;
  }
  return profile ? { ...profile, updatedAt: profileUpdatedAt, source: "profile" } : fromSOS || null;
}

function refreshSosLocations(requests = [], alerts = []) {
  const locations = [];
  requests.forEach((request) => {
    const location = coordinates(request.userLocation);
    if (request.userId && location) {
      locations.push({
        userId: request.userId,
        ...location,
        updatedAt: timestampMillis(request.timestamp) ?? 0,
        source: "SOS",
      });
    }
  });
  alerts.forEach((alert) => {
    const location = coordinates(alert.location) ||
      coordinates(alert.userLocation) ||
      coordinates({ lat: alert.latitude, lng: alert.longitude });
    if (alert.userId && location) {
      locations.push({
        userId: alert.userId,
        ...location,
        updatedAt: timestampMillis(alert.timestamp || alert.createdAt) ?? 0,
        source: "SOS",
      });
    }
  });
  sosLocations = new Map();
  locations
    .sort((first, second) => first.updatedAt - second.updatedAt)
    .forEach((location) => sosLocations.set(location.userId, location));
}

function userName(user) {
  const direct = fieldValue(user, ["displayName", "fullName", "name", "staffName"]);
  if (direct) return direct;
  const first = fieldValue(user, ["firstName", "firstname", "givenName"]);
  const last = fieldValue(user, ["lastName", "lastname", "surname", "familyName"]);
  return [first, last].filter(Boolean).join(" ") || "Name not provided";
}

function userCategory(user) {
  const role = [
    "role",
    "userRole",
    "user_role",
    "userType",
    "user_type",
    "accountType",
    "account_type",
    "category",
    "userCategory",
    "user_category",
    "type",
  ]
    .map((key) => fieldValue(user, [key]))
    .join(" ")
    .toLowerCase();

  const isStaff =
    user.isStaff === true ||
    user.isAdmin === true ||
    user.is_admin === true ||
    fieldValue(user, ["isStaff"]) === "true" ||
    fieldValue(user, ["isAdmin"]) === "true" ||
    fieldValue(user, ["is_admin"]) === "true" ||
    fieldValue(user, ["staffId", "staff_id", "employeeId", "employee_id", "staffSpecialty", "staff_specialty"]) ||
    /\b(staff|faculty|teacher|employee|admin|instructor|responder)\b/i.test(role);

  const isStudent =
    !isStaff && (
      user.isStudent === true ||
      fieldValue(user, ["isStudent"]) === "true" ||
      fieldValue(user, ["is_student"]) === "true" ||
      fieldValue(user, ["studentId", "student_id", "studentNumber", "student_number"]) ||
      /student/i.test(role)
    );

  if (isStaff) return "staff";
  if (isStudent) return "student";
  if (fieldValue(user, ["course", "program", "studentCourse"])) return "student";
  return "other";
}

function isActiveUser(user) {
  if (
    user.isActive === false ||
    user.active === false ||
    user.enabled === false ||
    ["false", "0"].includes(fieldValue(user, ["isActive", "active", "enabled"]).toLowerCase())
  ) {
    return false;
  }
  const status = fieldValue(user, ["accountStatus", "status"]).toLowerCase();
  return !["inactive", "disabled", "suspended", "deleted", "deactivated"].includes(status);
}

function activeUsers() {
  return users.filter(isActiveUser);
}

function searchText(user) {
  return [userName(user), ...Object.entries(user)
    .filter(([key]) => !hiddenField(key))
    .map(([, value]) => displayValue(value))]
    .join(" ")
    .toLowerCase();
}

function renderUsers() {
  const current = activeUsers();
  const students = current.filter((user) => userCategory(user) === "student");
  const staff = current.filter((user) => userCategory(user) === "staff");
  byId("users-student-count").textContent = String(students.length);
  byId("users-staff-count").textContent = String(staff.length);
  byId("users-student-tab-count").textContent = String(students.length);
  byId("users-staff-tab-count").textContent = String(staff.length);
  byId("users-all-count").textContent = String(current.length);

  const query = byId("users-search").value.trim().toLowerCase();
  const filtered = current.filter((user) => {
    const category = userCategory(user);
    return (selectedCategory === "all" || category === selectedCategory) &&
      searchText(user).includes(query);
  });

  byId("users-table-body").innerHTML = filtered.length
    ? filtered.map((user) => {
      const category = userCategory(user);
      const email = fieldValue(user, ["email", "emailAddress", "email_address"]);
      const phone = fieldValue(user, ["phone", "phoneNumber", "mobile", "mobileNumber", "staffPhone"]);
      const program = fieldValue(user, ["course", "program", "department", "college"]);
      const presence = onlineState(user);
      const location = locationForUser(user);
      const specialty = category === "staff"
        ? fieldValue(user, ["staffSpecialty", "staff_specialty", "specialization", "specialty", "staffRole", "jobTitle", "position", "role"])
        : "";
      return `<tr class="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors" data-user-row="${escapeHtml(user.id)}">
        <td class="t-main" data-user-details="${escapeHtml(user.id)}"><strong>${escapeHtml(userName(user))}</strong><span class="block text-xs t-muted">${escapeHtml(user.studentId || user.student_id || user.studentNumber || user.staffId || user.employeeId || user.id)}</span></td>
        <td data-user-details="${escapeHtml(user.id)}">${escapeHtml(category === "other" ? "Other / unspecified" : category === "student" ? "Student" : "Staff")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(email || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(phone || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(program || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(specialty || "—")}</td>
        <td data-user-details="${escapeHtml(user.id)}"><span class="badge ${presence.online ? "badge-ok" : "badge-muted"}" data-user-presence="${escapeHtml(user.id)}" title="${presence.lastSeen ? `Last seen ${escapeHtml(new Date(presence.lastSeen).toLocaleString())}` : "No recent presence update"}">${presence.online ? "Online" : "Offline"}</span></td>
        <td><button class="btn btn-sm ${location ? "btn-primary" : ""}" type="button" data-user-location="${escapeHtml(user.id)}" ${location ? "" : "disabled"} aria-label="${location ? `Show last known location of ${escapeHtml(userName(user))} on live map` : `No location available for ${escapeHtml(userName(user))}`}"><i data-lucide="map-pin" class="w-4 h-4"></i> ${location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "No location"}</button></td>
        <td><button class="btn btn-sm" type="button" data-user-details="${escapeHtml(user.id)}">View details</button></td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="9" class="t-muted">${
      current.length ? "No users match this category or search." : "No active user profiles found in Supabase."
    }</td></tr>`;
  if (window.lucide) window.lucide.createIcons();
  refreshPresenceBadges();

  if (selectedUserId) {
    const selected = current.find((user) => user.id === selectedUserId);
    if (selected) renderUserDetails(selected);
    else closeUserDetails();
  }
}

function refreshPresenceBadges() {
  document.querySelectorAll("[data-user-presence]").forEach((badge) => {
    const user = users.find((item) => item.id === badge.dataset.userPresence);
    if (!user) return;
    const presence = onlineState(user);
    badge.textContent = presence.online ? "Online" : "Offline";
    badge.classList.toggle("badge-ok", presence.online);
    badge.classList.toggle("badge-muted", !presence.online);
    badge.title = presence.lastSeen
      ? `Last seen ${new Date(presence.lastSeen).toLocaleString()}`
      : "No recent presence update";
  });
}

function flattenFields(value, prefix = "") {
  if (value == null || hiddenField(prefix)) return [];
  if (value && typeof value.toDate === "function") {
    return [[prefix, value.toDate().toLocaleString()]];
  }
  if (value instanceof Date) return [[prefix, value.toLocaleString()]];
  if (Array.isArray(value)) {
    if (!value.length) return [[prefix, "—"]];
    return value.flatMap((item, index) =>
      typeof item === "object" && item !== null
        ? flattenFields(item, `${prefix}[${index}]`)
        : [[`${prefix}[${index}]`, displayValue(item)]]
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => !hiddenField(key));
    return entries.flatMap(([key, nested]) =>
      flattenFields(nested, prefix ? `${prefix} · ${key}` : key)
    );
  }
  return [[prefix, displayValue(value)]];
}

function renderUserDetails(user) {
  selectedUserId = user.id;
  byId("user-detail-title").textContent = userName(user);
  byId("user-detail-subtitle").textContent =
    `${userCategory(user) === "other" ? "Other / unspecified" : userCategory(user)} · ${user.email || user.id}`;
  const fields = flattenFields(user)
    .filter(([key]) => key !== "id")
    .map(([key, value]) => `<div class="min-w-0"><dt class="text-xs t-muted">${escapeHtml(key)}</dt><dd class="text-sm t-main mt-1 break-words">${escapeHtml(value || "—")}</dd></div>`);
  byId("user-detail-fields").innerHTML = fields.length
    ? fields.join("")
    : '<div class="t-muted">No profile details are available.</div>';
  byId("user-detail-panel").hidden = false;
  byId("user-detail-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeUserDetails() {
  selectedUserId = null;
  byId("user-detail-panel").hidden = true;
  byId("user-detail-fields").replaceChildren();
}

function initializeUsers() {
  let lastResponderMapSignature = "";
  const publishResponderProfiles = (force = false) => {
    const responderProfiles = users.filter((user) =>
      isActiveUser(user) && userCategory(user) === "staff"
    );
    const studentCount = activeUsers().filter((user) =>
      userCategory(user) === "student"
    ).length;
    const signature = JSON.stringify([
      responderProfiles.map((user) => {
        const presence = profilePresence(user);
        const location = profileLocation(user);
        return [
          user.id,
          presence.online,
          presence.onDuty,
          presence.lastSeen,
          location?.lat,
          location?.lng,
        ];
      }),
      studentCount,
    ]);
    if (!force && signature === lastResponderMapSignature) return;
    lastResponderMapSignature = signature;
    window.dispatchEvent(new CustomEvent("safepateros:users-updated", {
      detail: { users: responderProfiles, studentCount },
    }));
  };

  byId("users-search").addEventListener("input", renderUsers);
  document.querySelectorAll("[data-user-category]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.userCategory;
      document.querySelectorAll("[data-user-category]").forEach((tab) => {
        tab.setAttribute("aria-pressed", String(tab === button));
      });
      renderUsers();
    });
  });
  byId("users-table-body").addEventListener("click", (event) => {
    const locationButton = event.target.closest("[data-user-location]");
    if (locationButton) {
      const user = activeUsers().find((item) => item.id === locationButton.dataset.userLocation);
      const location = user && locationForUser(user);
      if (!user || !location) return;
      const presence = onlineState(user);
      window.dispatchEvent(new CustomEvent("safepateros:show-user-location", {
        detail: {
          id: user.id,
          name: userName(user),
          lat: location.lat,
          lng: location.lng,
          online: presence.online,
          onDuty: profilePresence(user).onDuty,
          updatedAt: location.updatedAt,
          lastSeenAt: profilePresence(user).lastSeen,
          source: location.source,
        },
      }));
      return;
    }
    const detailsTrigger = event.target.closest("[data-user-details]") || event.target.closest("[data-user-row]");
    if (!detailsTrigger) return;
    const userId = detailsTrigger.dataset.userDetails || detailsTrigger.dataset.userRow;
    const user = activeUsers().find((item) => item.id === userId);
    if (user) renderUserDetails(user);
  });
  byId("user-detail-close").addEventListener("click", closeUserDetails);
  window.setInterval(() => {
    refreshPresenceBadges();
    publishResponderProfiles();
  }, 30000);
  const updateSosLocations = () => {
    refreshSosLocations(sosRequests, sosAlerts);
    renderUsers();
  };
  window.addEventListener("safepateros:emergency-requests-updated", (event) => {
    sosRequests = event.detail || [];
    updateSosLocations();
  });
  window.addEventListener("safepateros:alerts-updated", (event) => {
    sosAlerts = event.detail || [];
    updateSosLocations();
  });

  if (!isSupabaseConfigured) {
    byId("users-feed-status").textContent = "Supabase is not configured.";
  }

  window.addEventListener("safepateros:supabase-ready", (event) => {
    byId("users-feed-status").textContent = "Loading user profiles from AlertNest…";
    event.detail.subscribeToUsers(
      (nextUsers) => {
        users = nextUsers;
        byId("users-feed-status").textContent = "Live profiles from Supabase";
        renderUsers();
        publishResponderProfiles(true);
      },
      (error) => {
        console.error("AlertNest user profiles could not be loaded.", error);
        byId("users-feed-status").textContent = "Could not load user profiles. Check Supabase row-level security.";
        byId("users-table-body").innerHTML =
          '<tr><td colspan="9" class="t-danger">Supabase could not load user profiles. Check the console and row-level security.</td></tr>';
      }
    );
  });
  window.addEventListener("safepateros:supabase-error", (event) => {
    console.error("Supabase initialization failed for user profiles.", event.detail);
    byId("users-feed-status").textContent = "Supabase initialization failed.";
  });
}

initializeUsers();