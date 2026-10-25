/* ==========================================================
   SafePateros — app.js
   Sections:
     1. Config + sample data
     2. Style lookups
     3. Helpers
     4. State (saved in this browser)
     5. Mapbox
     6. Rendering
     7. Actions (dispatch, resolve, responders, broadcast ...)
     8. Dialogs (details, forms, confirmations)
     9. Views + routing
    10. Event handling
    11. Startup
   ========================================================== */
"use strict";

/* ---------- 1. CONFIG + SAMPLE DATA ---------- */
const STORAGE_KEY = "safepateros-state-v1";

const MAPBOX_ACCESS_TOKEN =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN) ||
  window.NEXT_PUBLIC_MAPBOX_TOKEN ||
  "pk.eyJ1IjoicGFvcGFvc2tpZXMiLCJhIjoiY212Z3JydHl3MDJtaDJ3cHh6azRueG1uZCJ9.3DvaMQuDVkc7FiRmkeiLOQ";
const DEFAULT_CENTER = [121.0689, 14.5525];
const DEFAULT_CAMPUS_CENTER = {
  lng: DEFAULT_CENTER[0],
  lat: DEFAULT_CENTER[1],
};
if (window.mapboxgl) window.mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
const WALK_M_PER_MIN = 84; // walking speed used for ETA estimates

// Building positions are offsets (in degrees, 0.0001 is roughly 11 m) from the campus center.
// They are rebuilt whenever the center changes, so the buildings always stay around the school.
const CAMPUS_OFFSETS = [
  ["ICT Building", 0.0, -0.0006],
  ["Academic Building", 0.0004, 0.0003],
  ["Main Gate Area", 0.0007, 0.0007],
  ["Canteen", -0.0004, 0.0004],
  ["Library", 0.0003, -0.001],
  ["Gymnasium", -0.0008, -0.0004],
  ["Admin Office", 0.0009, -0.0002],
  ["Parking Area", -0.001, 0.001],
];
const CAMPUS_LOCATIONS = [];
function rebuildLocations(center) {
  CAMPUS_LOCATIONS.length = 0;
  CAMPUS_OFFSETS.forEach(([name, dLat, dLng]) =>
    CAMPUS_LOCATIONS.push({
      name,
      lat: +(center.lat + dLat).toFixed(6),
      lng: +(center.lng + dLng).toFixed(6),
    })
  );
}
rebuildLocations(DEFAULT_CAMPUS_CENTER);
const locByName = (name) => CAMPUS_LOCATIONS.find((l) => l.name === name);

function seedState(center = DEFAULT_CAMPUS_CENTER) {
  rebuildLocations(center);
  const now = Date.now();
  const MIN = 60000;
  const DAY = 24 * 60 * MIN;
  const ict = locByName("ICT Building"),
    gate = locByName("Main Gate Area"),
    admin = locByName("Admin Office");

  return {
    v: 2,
    campus: {
      name: "Pateros Technological College",
      center: { ...center },
      zoom: 18,
      activeUsers: 0,
      facilityRadiusKm: 3, // how far to look for hospitals, police and fire stations
      customCenter: false, // true once the admin sets their own center in Settings
    },
    settings: { sound: true },
    alerts: [],
    responders: [
      {
        id: "RES-04",
        name: "R. Villanueva",
        initials: "RV",
        phone: "+63 912 345 6789",
        role: "Medical / EMT",
        status: "available",
        location: "ICT Building, 1st Floor",
        lat: ict.lat + 0.00005,
        lng: ict.lng + 0.00005,
      },
      {
        id: "RES-07",
        name: "M. Aquino",
        initials: "MA",
        phone: "+63 923 456 7890",
        role: "Security / SAR",
        status: "available",
        location: "Main Gate Area",
        lat: gate.lat,
        lng: gate.lng,
      },
      {
        id: "RES-09",
        name: "L. Dela Cruz",
        initials: "LD",
        phone: "+63 934 567 8901",
        role: "First aid / Nurse",
        status: "available",
        location: "Admin Office",
        lat: admin.lat,
        lng: admin.lng,
      },
      {
        id: "RES-11",
        name: "P. Ramos",
        initials: "PR",
        phone: "+63 945 678 9012",
        role: "Security / SAR",
        status: "offline",
        location: "Off campus",
        lat: null,
        lng: null,
      },
    ],
    broadcasts: [
      {
        id: "BC-01",
        message:
          "Fire drill is scheduled for tomorrow at 9:00 AM. Follow your marshals to the assembly area.",
        audience: "Everyone on campus",
        level: "info",
        sentAt: now - 1 * DAY,
      },
    ],
    activity: [],
  };
}

/* ---------- 2. STYLE LOOKUPS ---------- */
const TYPE_META = {
  medical: {
    label: "Medical",
    icon: "heart",
    tone: "danger",
    title: "Medical SOS",
    prefix: "SOS",
  },
  fire: {
    label: "Fire",
    icon: "flame",
    tone: "warn",
    title: "Fire alert",
    prefix: "FIRE",
  },
  security: {
    label: "Security",
    icon: "shield-alert",
    tone: "info",
    title: "Security concern",
    prefix: "SEC",
  },
  other: {
    label: "Other",
    icon: "alert-circle",
    tone: "muted",
    title: "Incident",
    prefix: "INC",
  },
};
const PRIORITY_DEFAULT = {
  medical: "critical",
  fire: "critical",
  security: "high",
  other: "normal",
};
const PRIORITY_META = {
  critical: { label: "Critical", badge: "badge-danger", weight: 0 },
  high: { label: "High", badge: "badge-warn", weight: 1 },
  normal: { label: "Normal", badge: "badge-muted", weight: 2 },
};
const ALERT_STATUS = {
  unassigned: {
    label: "Awaiting dispatch",
    badge: "badge-danger",
    card: "tone-danger",
  },
  responding: { label: "Responding", badge: "badge-warn", card: "tone-warn" },
  resolved: { label: "Resolved", badge: "badge-ok", card: "tone-muted" },
  false_alarm: {
    label: "False alarm",
    badge: "badge-muted",
    card: "tone-muted",
  },
  unknown: {
    label: "Unknown status",
    badge: "badge-muted",
    card: "tone-muted",
  },
};
const RESPONDER_STATUS = {
  available: { label: "Available", badge: "badge-ok" },
  responding: { label: "Responding", badge: "badge-info" },
  offline: { label: "Off duty", badge: "badge-muted" },
};
const LEVEL_META = {
  info: { label: "Notice", badge: "badge-info" },
  warning: { label: "Warning", badge: "badge-warn" },
  emergency: { label: "Emergency", badge: "badge-danger" },
};
const TOAST_STYLES = {
  info: { line: "var(--border)", dot: "#3b82f6" },
  success: { line: "var(--ok-line)", dot: "#22c55e" },
  error: { line: "var(--danger-line)", dot: "#ef4444" },
};
const BROADCAST_TEMPLATES = [
  {
    key: "evac",
    label: "Evacuate",
    level: "emergency",
    text: "Emergency: evacuate the building now using the nearest exit. Do not use elevators. Go to the assembly area and wait for instructions.",
  },
  {
    key: "shelter",
    label: "Shelter in place",
    level: "emergency",
    text: "Shelter in place. Stay inside, lock doors, and keep away from windows until you receive an all-clear.",
  },
  {
    key: "allclear",
    label: "All clear",
    level: "info",
    text: "All clear. The situation has been resolved and normal activities may resume.",
  },
  {
    key: "drill",
    label: "Drill notice",
    level: "info",
    text: "This is a scheduled safety drill. Follow your marshals and proceed to the assembly area.",
  },
];
const VIEWS = {
  dashboard: { title: "Command center", sub: "PTC Emergency Ops" },
  map: { title: "Live map", sub: "Incidents and responders on campus" },
  alerts: { title: "Active alerts", sub: "Incidents that need attention" },
  incidents: {
    title: "Incident reports",
    sub: "Every incident, with response times",
  },
  users: { title: "Users", sub: "Student and staff accounts from AlertNest" },
  responders: { title: "Responders", sub: "Manage teams and availability" },
  broadcast: { title: "Broadcast", sub: "Send a message to campus" },
  reports: { title: "Reports", sub: "How the team is performing" },
  settings: { title: "Settings", sub: "Map, campus and preferences" },
};

/* ---------- 3. HELPERS ---------- */
const $ = (id) => document.getElementById(id);
const icons = () => {
  if (window.lucide) window.lucide.createIcons();
};

// Escapes text before it goes into innerHTML (protects against injected HTML)
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const hasPos = (item) =>
  item && typeof item.lat === "number" && typeof item.lng === "number";
const isActive = (a) => a.status === "unassigned" || a.status === "responding";
const findAlert = (id) => state.alerts.find((a) => a.id === id);
const findResponder = (id) => state.responders.find((r) => r.id === id);
const alertOf = (r) =>
  state.alerts.find((a) => a.responderId === r.id && a.status === "responding");
const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, "")}`;

function fmtAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
function fmtDateTime(ts) {
  return new Date(ts).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const m = ms / 60000;
  if (m < 60) return `${m.toFixed(1).replace(/\.0$/, "")} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}
function fmtDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function distanceM(a, b) {
  const R = 6371000,
    rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const etaMin = (m) => Math.max(1, Math.round(m / WALK_M_PER_MIN));

// Available responders, closest first (responders without a position go last)
function isResponderAvailableForAssignment(responder) {
  return responder.status === "available" &&
    !state.alerts.some(
      (alert) =>
        isActive(alert) &&
        String(alert.responderId || "") === String(responder.id)
    );
}

function availableByDistance(alert) {
  return state.responders
    .filter(isResponderAvailableForAssignment)
    .map((r) => ({
      r,
      dist: hasPos(r) && hasPos(alert) ? distanceM(r, alert) : null,
    }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
}

window.safepaterosGetAvailableRespondersForAlert = (alert) => {
  return availableByDistance(alert).map(({ r, dist }) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    unit: r.id,
    specialty: r.role,
    location: r.location,
    distanceMeters: dist,
    etaMinutes: dist == null ? null : etaMin(dist),
  }));
};

window.safepaterosMarkResponderResponding = (responderId, location) => {
  const responder = findResponder(responderId);
  if (!responder || responder.status !== "available") return false;
  responder.status = "responding";
  responder.location = `En route to ${location}`;
  save();
  render();
  return true;
};

window.safepaterosMarkResponderAvailable = (responderId, location) => {
  const responder = findResponder(responderId);
  if (!responder || alertOf(responder)) return false;
  responder.status = "available";
  responder.location = location;
  save();
  render();
  return true;
};

function sortedActive() {
  return state.alerts
    .filter(isActive)
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "unassigned" ? -1 : 1) ||
        PRIORITY_META[a.priority].weight - PRIORITY_META[b.priority].weight ||
        a.createdAt - b.createdAt
    );
}

function nextId(prefix, list) {
  const max = list.reduce((m, item) => {
    const hit = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id);
    return hit ? Math.max(m, +hit[1]) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}
function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const mapsLink = (item) =>
  `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
function directionsLink(from, to) {
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}` +
    (hasPos(from) ? `&origin=${from.lat},${from.lng}` : "") +
    "&travelmode=walking"
  );
}
const badge = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;

/* ---------- 4. STATE (saved in this browser) ---------- */
// Moves every incident and responder by the same amount (used when the campus center changes)
function shiftPositions(target, dLat, dLng) {
  [...target.alerts, ...target.responders].forEach((item) => {
    if (hasPos(item)) {
      item.lat += dLat;
      item.lng += dLng;
    }
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      saved &&
      saved.v >= 1 &&
      Array.isArray(saved.alerts) &&
      Array.isArray(saved.responders)
    ) {
      const savedCenter =
        (saved.campus && saved.campus.center) || DEFAULT_CAMPUS_CENTER;
      // Unless the admin picked their own center, follow the school's position set in the code
      const center =
        saved.campus && saved.campus.customCenter
          ? savedCenter
          : { ...DEFAULT_CAMPUS_CENTER };
      const seed = seedState(center);
      const merged = {
        ...seed,
        ...saved,
        alerts: saved.alerts.filter(
          (alert) =>
            !alert.supabaseRequest &&
            !alert.supabaseAlert &&
            !alert.supabaseIncident &&
            !["SOS-01", "FIRE-01", "SEC-01", "INC-01", "SEC-02"].includes(alert.id)
        ),
        v: 2,
        campus: { ...seed.campus, ...saved.campus, center },
        settings: { ...seed.settings, ...saved.settings },
      };
      delete merged.settings.mapId; // no longer used
      delete merged.settings.mapsKey;
      const dLat = center.lat - savedCenter.lat,
        dLng = center.lng - savedCenter.lng;
      if (Math.abs(dLat) > 1e-7 || Math.abs(dLng) > 1e-7)
        shiftPositions(merged, dLat, dLng);
      rebuildLocations(center);
      return merged;
    }
  } catch (e) {
    /* fall through to sample data */
  }
  return seedState();
}
function save() {
  try {
    const localState = {
      ...state,
      alerts: state.alerts.filter(
        (alert) =>
          !alert.supabaseRequest &&
          !alert.supabaseAlert &&
          !alert.supabaseIncident
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localState));
  } catch (e) {
    /* storage full or blocked */
  }
}

const state = loadState();
state.campus.activeUsers = 0;
let supabaseDashboard = null;
let campusBroadcastUnsubscribe = null;
let registeredStaffProfiles = [];
let broadcastSending = false;
let supabaseEmergencyRequests = [];
let supabaseAlertRecords = [];
let supabaseIncidentRecords = [];
let previousEmergencyRequestIds = null;
let previousAlertRecordIds = null;
let previousIncidentIds = null;
const emergencyLocationWatchers = new Map();
const recentEmergencyRequestIds = new Set();
let selectedUserMapLocation = null;
let pendingRealtimeMapLocation = null;

function profileValue(profile, keys) {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  for (const [key, value] of Object.entries(profile)) {
    if (/password|token|secret|credential/i.test(key) || !value || typeof value !== "object") continue;
    const match = profileValue(value, keys);
    if (match) return match;
  }
  return "";
}

function profileField(profile, keys) {
  if (!profile || typeof profile !== "object") return undefined;
  for (const [key, value] of Object.entries(profile)) {
    if (keys.includes(key)) return value;
  }
  for (const [key, value] of Object.entries(profile)) {
    if (/password|token|secret|credential/i.test(key) || !value || typeof value !== "object") continue;
    const match = profileField(value, keys);
    if (match !== undefined) return match;
  }
  return undefined;
}

function profileTimestamp(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function staffResponderFromProfile(profile) {
  const id = `STAFF-${profile.id}`;
  const previous = state.responders.find((responder) => responder.id === id);
  const directName = profileValue(profile, ["displayName", "fullName", "name", "staffName"]);
  const name = directName || [
    profileValue(profile, ["firstName", "firstname", "givenName"]),
    profileValue(profile, ["lastName", "lastname", "surname", "familyName"]),
  ].filter(Boolean).join(" ") || "Name not provided";
  const phone = profileValue(profile, ["phone", "phoneNumber", "mobile", "mobileNumber", "staffPhone"]);
  const email = profileValue(profile, ["email", "emailAddress"]);
  const role = profileValue(profile, [
    "staffSpecialty", "specialization", "specialty", "staffRole", "jobTitle", "position", "role",
  ]) || "Staff";
  const location = profileValue(profile, [
    "locationName", "campusLocation", "baseLocation", "building", "location",
  ]) || (previous && previous.location) || "Location unavailable";
  const latitude = profileValue(profile, ["lat", "latitude"]);
  const longitude = profileValue(profile, ["lng", "longitude"]);
  const directPosition = locationFromRecord(profile);
  const livePosition =
    locationFromRecord(profileField(profile, ["current_location", "currentLocation", "live_location", "liveLocation"])) ||
    directPosition;
  const lastKnownPosition =
    locationFromRecord(profileField(profile, ["last_known_location", "lastKnownLocation", "last_location", "lastLocation"])) ||
    directPosition;
  const onlineValue = profileField(profile, ["is_online", "isOnline", "online"]);
  const normalizedOnline = String(onlineValue ?? "").trim().toLowerCase();
  const explicitOnline = typeof onlineValue === "boolean"
    ? onlineValue
    : ["true", "1", "online", "active", "connected"].includes(normalizedOnline)
      ? true
      : ["false", "0", "offline", "inactive", "disconnected"].includes(normalizedOnline)
        ? false
        : null;
  const lastSeenAt = profileTimestamp(profileField(profile, [
    "last_seen_at",
    "lastSeenAt",
    "last_seen",
    "lastSeen",
    "heartbeat_at",
    "heartbeatAt",
    "last_heartbeat_at",
    "lastHeartbeatAt",
  ]));
  const lastSeenAge = lastSeenAt === null ? null : Date.now() - lastSeenAt;
  const isOnline = explicitOnline === false
    ? false
    : lastSeenAge !== null
      ? lastSeenAge >= -30000 && lastSeenAge <= 120000
      : explicitOnline === true;
  const dutyValueRaw = profileField(profile, [
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
  const normalizedDuty = String(dutyValueRaw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const explicitOnDuty = typeof dutyValueRaw === "boolean"
    ? dutyValueRaw
    : ["true", "1", "on_duty", "on_shift", "available", "active", "responding"].includes(normalizedDuty)
      ? true
      : ["false", "0", "off_duty", "off_shift", "inactive", "unavailable"].includes(normalizedDuty)
        ? false
        : null;
  const profileAssignment = profileValue(profile, [
    "assignedAlertId",
    "activeAlertId",
    "assignedIncidentId",
    "currentAssignment",
    "assignmentId",
  ]);
  const hasProfileAssignment =
    Boolean(profileAssignment) &&
    !["false", "0", "none", "null", "undefined"].includes(
      profileAssignment.toLowerCase()
    );
  const assignedAlert = state.alerts.find(
    (alert) => isActive(alert) && String(alert.responderId || "") === id
  );
  const dutyValue = profileValue(profile, [
    "shiftStatus",
    "shift_status",
    "dutyStatus",
    "duty_status",
    "isOnDuty",
    "onDuty",
    "isOnShift",
    "onShift",
    "workStatus",
    "available",
    "availability",
  ]).toLowerCase().replace(/[_-]+/g, " ");
  const offDuty = [
    "false",
    "0",
    "off",
    "off duty",
    "offline",
    "inactive",
    "unavailable",
    "not available",
    "off shift",
    "not on duty",
  ].includes(dutyValue);
  const responding =
    Boolean(assignedAlert || hasProfileAssignment) ||
    ["responding", "assigned", "busy", "en route", "in progress"].includes(dutyValue);
  const isOnDuty = explicitOnDuty ?? (!offDuty && Boolean(dutyValue));
  const status = responding
    ? "responding"
    : isOnline && isOnDuty
      ? "available"
      : "offline";
  const position = isOnline && isOnDuty
    ? livePosition || lastKnownPosition
    : lastKnownPosition || livePosition;
  const lat = position?.lat ?? (latitude ? Number(latitude) : NaN);
  const lng = position?.lng ?? (longitude ? Number(longitude) : NaN);

  return {
    ...(previous || {}),
    id,
    name,
    initials: initialsOf(name),
    phone,
    email,
    role,
    status,
    isOnline,
    isOnDuty,
    lastSeenAt,
    location: status === "responding" && previous ? previous.location : location,
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90
      ? lat
      : previous && previous.lat,
    lng: Number.isFinite(lng) && lng >= -180 && lng <= 180
      ? lng
      : previous && previous.lng,
    staffUser: true,
  };
}

function syncRegisteredStaff(users) {
  registeredStaffProfiles = users;
  const staffResponders = users.map(staffResponderFromProfile);
  const currentIds = new Set(staffResponders.map((responder) => responder.id));
  state.responders = state.responders.filter((responder) =>
    !responder.staffUser ||
    currentIds.has(responder.id) ||
    Boolean(alertOf(responder))
  );
  const respondersById = new Map(state.responders.map((responder) => [responder.id, responder]));
  staffResponders.forEach((responder) => {
    respondersById.set(responder.id, responder);
  });
  state.responders = [...respondersById.values()];
}

const ui = {
  alertFilter: "active",
  alertQuery: "",
  incStatus: "all",
  incTypes: Object.keys(TYPE_META),
  incQuery: "",
  respQuery: "",
  respStatus: "all",
  layers: { alerts: true, responders: true, hospital: true, police: true, fire_station: true },
};
let currentView = "dashboard";

/* ---------- 5. MAPBOX ---------- */
let mapMode = "fallback";
let mapboxMap = null;
let mapboxReady = false;
let mapMarkers = [];
let gFitted = false;
let mapZoom = 1;
let mapsFailed = false;

// The map only shows our own pins plus these three kinds of emergency service.
const FACILITY_TYPES = {
  hospital: { label: "Hospital", plural: "Hospitals", letter: "H", icon: "heart", tone: "ok", badge: "badge-ok", searchCategory: "hospital" },
  police: { label: "Police station", plural: "Police stations", letter: "P", icon: "shield", tone: "info", badge: "badge-info", searchCategory: "police" },
  fire_station: { label: "Fire station", plural: "Fire stations", letter: "F", icon: "flame", tone: "warn", badge: "badge-warn", searchCategory: "fire_station" },
};
const FACILITIES_PER_TYPE = 6; // nearest few of each kind keeps the map readable
let facilities = []; // [{ id, type, name, address, lat, lng, dist }]
let facilitiesState = "idle"; // idle | loading | ready | error

function clearOverlays() {
  mapMarkers.forEach((marker) => marker.remove());
  mapMarkers = [];
  if (mapboxMap && mapboxMap.getLayer("responder-routes")) {
    mapboxMap.removeLayer("responder-routes");
    mapboxMap.removeSource("responder-routes");
  }
}

function initMapboxMap() {
  if (!window.mapboxgl) throw new Error("Mapbox GL JS did not load");
  window.mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
  const dark = document.documentElement.classList.contains("dark");
  const el = $("mapbox-map");
  el.hidden = false;
  $("map-canvas").hidden = true;
  mapboxReady = false;
  mapboxMap = new window.mapboxgl.Map({
    container: el,
    style: dark ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v12",
    center: [state.campus.center.lng, state.campus.center.lat],
    zoom: state.campus.zoom,
  });
  mapboxMap.on("zoom", updateZoomClass);
  mapboxMap.on("load", () => {
    mapMode = "mapbox";
    mapboxReady = true;
    mapsFailed = false;
    gFitted = false;
    setMapBanner("");
    updateMapsStatus();
    updateZoomClass();
    mapboxMap.getStyle().layers.forEach((layer) => {
      if (/poi|transit/.test(layer.id)) {
        mapboxMap.setLayoutProperty(layer.id, "visibility", "none");
      }
    });
    renderMap();
    refreshMapSize();
    flyToPendingRealtimeLocation();
    if (facilitiesState === "idle") loadFacilities();
  });
  mapboxMap.on("error", (event) => {
    console.error("Mapbox map reported an error.", event.error);
    if (
      mapMode !== "fallback" &&
      [401, 403].includes(event.error && event.error.status)
    ) {
      useFallback("Mapbox rejected the access token. Check its URL restrictions and enabled services.");
    }
  });
  mapMode = "mapbox";
  mapsFailed = false;
  gFitted = false;
  setMapBanner("");
  updateMapsStatus();
}

// Hide the small name labels on incident/responder pins when zoomed far out (they would overlap)
function updateZoomClass() {
  if (mapboxMap) $("map-host").toggleAttribute("data-far", mapboxMap.getZoom() < 16);
}

function useFallback(message) {
  mapMode = "fallback";
  mapboxReady = false;
  mapsFailed = true;
  clearOverlays();
  if (mapboxMap) mapboxMap.remove();
  mapboxMap = null;
  facilities = [];
  facilitiesState = "idle";
  const old = $("mapbox-map");
  const fresh = document.createElement("div");
  fresh.id = "mapbox-map";
  fresh.hidden = true;
  old.replaceWith(fresh);
  $("map-canvas").hidden = false;
  $("map-host").removeAttribute("data-far");
  setMapBanner(message);
  updateMapsStatus();
  renderMap();
  renderLiveList();
}

function startMaps() {
  try {
    initMapboxMap();
  } catch (error) {
    console.error("Mapbox could not be initialized.", error);
    useFallback("Could not load Mapbox. Check your internet connection and Mapbox access token.");
  }
}

function setMapBanner(message, title = "Simulated map") {
  const b = $("map-banner");
  if (!message) {
    b.hidden = true;
    b.innerHTML = "";
    return;
  }
  b.hidden = false;
  b.innerHTML = `<p class="font-semibold t-main">${esc(title)}</p><p class="mt-0.5">${esc(message)}</p>
    <button class="btn btn-sm mt-2" data-action="nav" data-view="settings">Open map settings</button>`;
}

function updateMapsStatus() {
  const el = $("maps-status");
  if (!el) return;
  const status =
    mapMode === "mapbox" && mapboxMap && mapboxReady
      ? "ok"
      : mapsFailed
      ? "error"
      : "pending";
  const map = {
    ok: ["badge badge-ok", "Connected"],
    error: ["badge badge-danger", "Not working"],
    pending: ["badge badge-warn", "Connecting"],
  }[status];
  el.className = map[0];
  el.textContent = map[1];
}

function rebuildMapboxMap() {
  if (mapMode !== "mapbox") return;
  clearOverlays();
  if (mapboxMap) mapboxMap.remove();
  mapboxMap = null;
  mapboxReady = false;
  const old = $("mapbox-map");
  const fresh = document.createElement("div");
  fresh.id = "mapbox-map";
  old.replaceWith(fresh);
  try {
    initMapboxMap();
  } catch (error) {
    console.error("Mapbox could not be reloaded.", error);
    useFallback("Could not reload Mapbox.");
  }
}

function mountMap(slotId) {
  const slot = $(slotId),
    host = $("map-host");
  if (slot && host.parentElement !== slot) slot.appendChild(host);
  refreshMapSize();
}
function refreshMapSize() {
  requestAnimationFrame(() => {
    if (mapMode === "mapbox" && mapboxMap) {
      mapboxMap.resize();
      if (!gFitted) fitMap();
    }
  });
}

function zoomMap(direction) {
  if (mapMode === "mapbox" && mapboxMap) {
    mapboxMap.zoomTo(mapboxMap.getZoom() + direction);
    return;
  }
  mapZoom = clamp(+(mapZoom + direction * 0.2).toFixed(1), 0.6, 2);
  $("map-canvas").style.transform = `scale(${mapZoom})`;
}

// --- Nearby hospitals, police stations and fire stations (Mapbox Search Box API) ---
async function loadFacilities() {
  if (facilitiesState === "loading" || mapMode !== "mapbox") return;
  facilitiesState = "loading";
  renderLiveList();
  try {
    const center = { ...state.campus.center };
    const radius = Math.round((state.campus.facilityRadiusKm || 3) * 1000);
    const settled = await Promise.allSettled(
      Object.keys(FACILITY_TYPES).map(async (type) => {
        const url = new URL(
          `https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(FACILITY_TYPES[type].searchCategory)}`
        );
        url.search = new URLSearchParams({
          access_token: MAPBOX_ACCESS_TOKEN,
          proximity: `${center.lng},${center.lat}`,
          limit: "20",
          language: "en",
        });
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `${FACILITY_TYPES[type].label} search returned ${response.status}`
          );
        }
        const data = await response.json();
        if (!Array.isArray(data.features)) {
          throw new Error(`${FACILITY_TYPES[type].label} search returned invalid data`);
        }
        return data.features.map((feature) => ({ type, feature }));
      })
    );
    if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;

    const failedCategories = settled.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ type: Object.keys(FACILITY_TYPES)[index], error: result.reason }]
        : []
    );
    if (failedCategories.length) {
      console.warn(
        "Some Mapbox nearby-service categories failed to load:",
        failedCategories
      );
    }

    const seen = new Set();
    const found = [];
    settled.forEach((r) => {
      if (r.status !== "fulfilled") return;
      r.value.forEach(({ type, feature }) => {
        const properties = feature.properties || {};
        const propertyCoordinates = properties.coordinates;
        const coordinates = Array.isArray(feature.geometry?.coordinates)
          ? feature.geometry.coordinates
          : [
              propertyCoordinates?.longitude ?? propertyCoordinates?.lng,
              propertyCoordinates?.latitude ?? propertyCoordinates?.lat,
            ];
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        const pos = {
          lng: Number(coordinates[0]),
          lat: Number(coordinates[1]),
        };
        const id = properties.mapbox_id || feature.id || `${type}:${pos.lat},${pos.lng}`;
        if (
          !Number.isFinite(pos.lat) ||
          pos.lat < -90 ||
          pos.lat > 90 ||
          !Number.isFinite(pos.lng) ||
          pos.lng < -180 ||
          pos.lng > 180 ||
          seen.has(id)
        ) return;
        if (distanceM(center, pos) > radius) return;
        seen.add(id);
        const categories = properties.poi_category;
        found.push({
          id,
          type,
          name: properties.name || FACILITY_TYPES[type].label,
          category: Array.isArray(categories)
            ? categories.join(", ")
            : categories || FACILITY_TYPES[type].label,
          address: properties.full_address || properties.place_formatted || "",
          ...pos,
          dist: distanceM(center, pos),
        });
      });
    });
    facilities = Object.keys(FACILITY_TYPES)
      .flatMap((type) =>
        found.filter((f) => f.type === type).sort((a, b) => a.dist - b.dist).slice(0, FACILITIES_PER_TYPE)
      )
      .sort((a, b) => a.dist - b.dist);
    facilitiesState = "ready";
    setMapBanner(
      failedCategories.length
        ? `Could not load: ${failedCategories.map(({ type }) => FACILITY_TYPES[type].plural.toLowerCase()).join(", ")}. Check Mapbox Search Box access for this token.`
        : "",
      "Nearby services partially loaded"
    );
    gFitted = false; // re-center so the school and the nearby services are all in view
  } catch (e) {
    console.warn("Nearby services failed to load:", e);
    facilities = [];
    facilitiesState = "error";
    setMapBanner(
      "Could not load nearby hospitals, police stations and fire stations. Check that your Mapbox token can use the Search Box API.",
      "Nearby services unavailable"
    );
  }
  renderMap();
  renderLiveList();
}

function nearestFacility(type, point) {
  if (!hasPos(point)) return null;
  return facilities
    .filter((f) => f.type === type)
    .map((f) => ({ f, d: distanceM(f, point) }))
    .sort((a, b) => a.d - b.d)[0];
}

// Everything that can be shown on the map except the school pin itself
function mapItems() {
  const items = [];
  if (ui.layers.alerts)
    state.alerts
      .filter(isActive)
      .forEach((a) => hasPos(a) && items.push({ kind: "alert", item: a }));
  if (ui.layers.responders)
    state.responders.forEach(
      (r) => hasPos(r) && items.push({ kind: "responder", item: r })
    );
  if (ui.layers.responders)
    state.alerts
      .filter(
        (alert) =>
          alert.supabaseRequest &&
          alert.status === "responding" &&
          hasPos(alert.responderLocation)
      )
      .forEach((alert) =>
        items.push({
          kind: "emergency-responder",
          item: {
            id: alert.id,
            name: alert.responderInfo.name,
            initials: initialsOf(alert.responderInfo.name),
            status: "responding",
            location: `Responding to ${alert.requestId}`,
            ...alert.responderLocation,
          },
        })
      );
  if (selectedUserMapLocation) {
    items.push({ kind: "user", item: selectedUserMapLocation });
  }
  facilities.forEach((f) => ui.layers[f.type] && items.push({ kind: "facility", item: f }));
  return items;
}
const schoolItem = () => ({ id: "school", name: state.campus.name, ...state.campus.center });

// The school stays in the middle: the view is widened evenly on every side until the
// farthest visible pin fits, so the map is always centered on the campus.
function fitMap() {
  if (mapMode !== "mapbox" || !mapboxMap) {
    mapZoom = 1;
    $("map-canvas").style.transform = "";
    return;
  }
  if (!$("map-host").offsetWidth) return; // map is on a hidden page; try again when it is shown
  gFitted = true;
  const c = state.campus.center;
  let dLat = 0.0006,
    dLng = 0.0006; // always show at least the campus itself
  mapItems().forEach(({ item }) => {
    dLat = Math.max(dLat, Math.abs(item.lat - c.lat));
    dLng = Math.max(dLng, Math.abs(item.lng - c.lng));
  });
  const bounds = new window.mapboxgl.LngLatBounds(
    [c.lng - dLng, c.lat - dLat],
    [c.lng + dLng, c.lat + dLat]
  );
  mapboxMap.fitBounds(bounds, { padding: 56, maxZoom: 19 });
}

function centerOnSchool() {
  if (mapMode === "mapbox" && mapboxMap) {
    mapboxMap.flyTo({
      center: [state.campus.center.lng, state.campus.center.lat],
      zoom: state.campus.zoom,
    });
  } else {
    mapZoom = 1;
    $("map-canvas").style.transform = "";
  }
}

function focusOn(item) {
  if (mapMode !== "mapbox" || !mapboxMap || !hasPos(item)) return;
  mapboxMap.flyTo({
    center: [item.lng, item.lat],
    zoom: Math.max(mapboxMap.getZoom(), 17),
  });
}

function updateMapPin(id, longitude, latitude, role, popupInfo = {}) {
  const lng = Number(longitude);
  const lat = Number(latitude);
  if (
    !id ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180 ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    console.warn("Cannot add an incident map pin with invalid data.", {
      id,
      longitude,
      latitude,
    });
    return false;
  }
  const record = {
    id: String(id),
    user_id: popupInfo.userId || "",
    latitude: lat,
    longitude: lng,
    status: "active",
    created_at: popupInfo.createdAt || new Date().toISOString(),
    user_role: role || "Student",
    users: { name: popupInfo.name || "Unknown user", role: role || "Student" },
    title: popupInfo.title || "SOS Emergency",
    displayTime: popupInfo.time || "",
  };
  const existingIndex = supabaseIncidentRecords.findIndex(
    (incident) => String(incident.id) === String(id)
  );
  if (existingIndex === -1) supabaseIncidentRecords.push(record);
  else supabaseIncidentRecords[existingIndex] = record;
  syncSupabaseAlerts({ renderDashboard: false });
  gFitted = false;
  render();
  return true;
}

function flyToLocation(longitude, latitude, zoom = 16, view = "map") {
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    console.warn("Realtime SOS has invalid coordinates.", { longitude, latitude });
    return;
  }
  pendingRealtimeMapLocation = { longitude, latitude, zoom };
  navigate(view);
  requestAnimationFrame(flyToPendingRealtimeLocation);
}

function flyToPendingRealtimeLocation() {
  if (!pendingRealtimeMapLocation || !mapboxMap || !mapboxReady) return;
  const { longitude, latitude, zoom } = pendingRealtimeMapLocation;
  pendingRealtimeMapLocation = null;
  mapboxMap.resize();
  mapboxMap.flyTo({ center: [longitude, latitude], zoom });
}

function collectNewPendingRecords(records, previousIds, getStatus) {
  const currentIds = new Set(records.map((record) => String(record.id)));
  const inserted =
    previousIds === null
      ? []
      : records.filter(
          (record) =>
            !previousIds.has(String(record.id)) &&
              ["pending", "active", "new", "unhandled"].includes(
              String(getStatus(record)).toLowerCase()
            )
        );
  return { currentIds, inserted };
}

function collectNewActiveIncidents(records, previousIds) {
  const currentIds = new Set(records.map((record) => String(record.id)));
  const inserted =
    previousIds === null
      ? []
      : records.filter(
          (record) =>
            !previousIds.has(String(record.id)) &&
            [
              "active",
              "pending",
              "accepted",
              "assigned",
              "dispatched",
              "responding",
              "en_route",
              "in_progress",
            ].includes(
              String(record.status || "").toLowerCase().replace(/[\s-]+/g, "_")
            )
        );
  return { currentIds, inserted };
}

function handleRealtimeSOS(alerts, { notifyUser = true } = {}) {
  if (!alerts.length) return;
  const located = alerts.filter(hasPos);
  if (located.length) {
    const latestAlert = located[located.length - 1];
    flyToLocation(latestAlert.lng, latestAlert.lat, 16, "dashboard");
  } else {
    navigate("dashboard");
    console.warn("New realtime SOS alert has no valid coordinates.", alerts);
  }
  if (notifyUser) {
    const name = alerts.length === 1
      ? alerts[0].userName || alerts[0].reportedBy || "Unknown user"
      : `${alerts.length} people`;
    notify(`New SOS received from ${name}.`, "error");
  }
}

// One pin look for both the Mapbox map and the simulated map
function pinHTML(kind, item) {
  if (kind === "school")
    return `<span class="pin pin-school">PTC<span class="pin-tag pin-tag-fixed">${esc(item.name)}</span></span>`;
  if (kind === "facility")
    return `<span class="pin pin-facility fac-${item.type}">${FACILITY_TYPES[item.type].letter}<span class="pin-tag pin-tag-fixed">${esc(item.name)}</span></span>`;
  if (kind === "alert") {
    const cls = item.status === "unassigned" ? "is-open" : "is-handled";
    const label = item.supabaseRequest || item.supabaseAlert || item.supabaseIncident
      ? item.userName || item.id
      : item.id;
    const role = item.supabaseIncident && item.userRole
      ? ` · ${esc(item.userRole)}`
      : "";
    return `<span class="pin pin-alert ${cls}">!<span class="pin-tag">${esc(label)}${role}</span></span>`;
  }
  if (kind === "user")
    return `<span class="pin pin-user ${item.online ? "is-online" : "is-offline"}"><i data-lucide="map-pin"></i><span class="pin-tag">${esc(item.name)}</span></span>`;
  const hasPresence = typeof item.isOnline === "boolean" || typeof item.isOnDuty === "boolean";
  const cls = hasPresence
    ? item.isOnline && item.isOnDuty ? "is-online" : "is-offline"
    : item.status === "offline" ? "is-offline" : item.status === "responding" ? "is-busy" : "";
  return `<span class="pin pin-resp ${cls}">${esc(item.initials)}<span class="pin-tag">${esc(item.name)}</span></span>`;
}
const pinLabel = (kind, item) =>
  kind === "school"
    ? `${item.name} (campus)`
    : kind === "facility"
    ? `${FACILITY_TYPES[item.type].label}: ${item.name}`
    : kind === "alert"
    ? `${item.supabaseRequest || item.supabaseAlert || item.supabaseIncident ? `SOS from ${item.userName || "registered user"}: ` : ""}${item.title}: ${item.location} (${ALERT_STATUS[item.status].label})${item.userRole ? ` · ${item.userRole}` : ""}${item.displayTime ? ` · Reported ${item.displayTime}` : item.createdAt ? ` · Reported ${fmtDateTime(item.createdAt)}` : ""}`
    : kind === "user"
    ? `Registered user ${item.name}, ${item.online ? "online" : "offline"}`
    : `Responder ${item.name}: ${item.location} (${RESPONDER_STATUS[item.status].label})${
        item.isOnline === false || item.isOnDuty === false
          ? ` · Last seen ${item.lastSeenAt ? fmtDateTime(item.lastSeenAt) : "time unavailable"}`
          : ""
      }`;

const SPAN = { lat: 0.003, lng: 0.0044 }; // area covered by the simulated map
function project(item) {
  const c = state.campus.center;
  return {
    x: clamp(50 + ((item.lng - c.lng) / SPAN.lng) * 100, 4, 96),
    y: clamp(50 - ((item.lat - c.lat) / SPAN.lat) * 100, 6, 94),
  };
}

function renderMap() {
  const items = [{ kind: "school", item: schoolItem() }, ...mapItems()];

  if (mapMode === "mapbox" && mapboxMap && mapboxReady) {
    clearOverlays();
    const zIndexOf = { school: 4, alert: 3, user: 3, responder: 2, "emergency-responder": 2, facility: 1 };
    items.forEach(({ kind, item }) => {
      const element = document.createElement("div");
      element.className = "mapbox-html-marker";
      element.style.zIndex = String(zIndexOf[kind]);
      element.innerHTML = pinHTML(kind, item);
      element.title = pinLabel(kind, item);
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", pinLabel(kind, item));
      const onClick = () => openFor(kind, item.id);
      element.addEventListener("click", onClick);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      });
      mapMarkers.push(
        new window.mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([item.lng, item.lat])
          .addTo(mapboxMap)
      );
    });

    // Draw a line from each responding responder to the incident they are heading to
    const routeFeatures = [];
    if (ui.layers.alerts && ui.layers.responders)
      state.alerts
        .filter(
          (a) =>
            !a.supabaseRequest && a.status === "responding" && hasPos(a)
        )
        .forEach((a) => {
          const r = findResponder(a.responderId);
          if (!r || !hasPos(r)) return;
          routeFeatures.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [[r.lng, r.lat], [a.lng, a.lat]],
            },
          });
        });
    if (ui.layers.alerts && ui.layers.responders)
      state.alerts
        .filter(
          (alert) =>
            alert.supabaseRequest &&
            alert.status === "responding" &&
            hasPos(alert) &&
            hasPos(alert.responderLocation)
        )
        .forEach((alert) =>
          routeFeatures.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [alert.responderLocation.lng, alert.responderLocation.lat],
                [alert.lng, alert.lat],
              ],
            },
          })
        );
    if (routeFeatures.length) {
      mapboxMap.addSource("responder-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: routeFeatures },
      });
      mapboxMap.addLayer({
        id: "responder-routes",
        type: "line",
        source: "responder-routes",
        paint: {
          "line-color": "#ea580c",
          "line-opacity": 0.9,
          "line-width": 3,
        },
      });
    }
    if (!gFitted) fitMap();
    return;
  }

  $("map-markers").innerHTML = items
    .map(({ kind, item }) => {
      const p = project(item);
      return `<button class="map-pin-btn" data-action="marker" data-kind="${kind}" data-id="${esc(item.id)}"
        style="left:${p.x}%;top:${p.y}%" aria-label="${esc(pinLabel(kind, item))}">${pinHTML(kind, item)}</button>`;
    })
    .join("");
}

/* ---------- 6. RENDERING ---------- */
function renderStats() {
  const active = state.alerts.filter(isActive);
  const waiting = active.filter((a) => a.status === "unassigned").length;
  const avail = state.responders.filter((r) => r.status === "available").length;
  const busy = state.responders.filter((r) => r.status === "responding").length;
  const off = state.responders.filter((r) => r.status === "offline").length;

  const pendingSosCount = Number.isInteger(window.alertNestPendingCount)
    ? window.alertNestPendingCount
    : waiting;
  $("stat-sos").textContent = pendingSosCount;
  $("stat-sos-sub").textContent = `${pendingSosCount} awaiting dispatch`;
  $("stat-sos-sub").className = `text-sm font-semibold mt-2 ${
    pendingSosCount ? "t-danger" : "t-muted"
  }`;

  $("stat-resp").textContent = state.responders.length;
  $("stat-resp-sub").textContent = `${avail} available, ${busy} responding${
    off ? `, ${off} off duty` : ""
  }`;

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const times = state.alerts
    .filter((a) => a.dispatchedAt && a.createdAt > weekAgo)
    .map((a) => a.dispatchedAt - a.createdAt);
  $("stat-avg").textContent = times.length
    ? fmtDuration(times.reduce((s, t) => s + t, 0) / times.length)
    : "—";
  $("stat-avg-sub").textContent = times.length
    ? `Alert to dispatch, last 7 days (${times.length} incidents)`
    : "No dispatches yet";

  $("stat-users").textContent = Number(
    state.campus.activeUsers
  ).toLocaleString();

  const navCount = $("nav-alert-count");
  navCount.hidden = pendingSosCount === 0;
  navCount.textContent = pendingSosCount;
}

function emergencyRequestCardHTML(a) {
  const pending = a.status === "unassigned";
  const accepted = a.status === "responding";
  const responder = a.responderInfo || {};
  const tracking = emergencyLocationWatchers.has(a.supabaseRecordId);
  const buttons = `
       <button data-action="dispatch-alert" data-id="${esc(
        a.id
      )}" class="btn btn-primary btn-sm" ${pending ? "" : "disabled"}>Dispatch nearest</button>
       <button data-action="assign-alert" data-id="${esc(
         a.id
       )}" class="btn btn-sm" ${pending ? "" : "disabled"}>Choose responder</button>
       <button data-action="cancel-sos" data-id="${esc(
         a.id
       )}" class="btn btn-danger-ghost btn-sm">Cancel SOS</button>
       <button data-action="alert-details" data-id="${esc(
         a.id
       )}" class="btn btn-sm">Details</button>
       ${!pending ? `<button data-action="${
        tracking ? "stop-emergency-location" : "start-emergency-location"
      }" data-id="${esc(a.supabaseRecordId)}" class="btn btn-sm">${
        tracking ? "Stop sharing location" : "Share my live location"
      }</button>
       <button data-action="resolve-emergency" data-id="${esc(
         a.supabaseRecordId
       )}" class="btn btn-ok btn-sm">Mark resolved</button>` : ""}`;
  const gps = hasPos(a)
    ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`
    : "GPS unavailable";

  return `<article class="alert-card ${
    pending ? "tone-danger emergency-alert-card" : "tone-warn emergency-alert-card"
  }${recentEmergencyRequestIds.has(a.supabaseRecordId) ? " is-new" : ""}">
    <div class="tile-icon tint-danger"><i data-lucide="alert-circle" class="w-5 h-5"></i></div>
    <div class="flex-1 min-w-0">
      <div class="flex items-start justify-between gap-2">
        <p class="text-[15px] font-bold t-main">${esc(a.title)}</p>
        ${badge(pending ? "badge-danger" : "badge-warn", pending ? "Pending" : "Responding")}
      </div>
      <p class="text-sm t-main mt-1">${esc(a.userName || "Name not provided")} · ${esc(gps)}</p>
      <div class="flex flex-wrap gap-x-3 text-xs t-muted mt-1">
        <span>Request ${esc(a.requestId)}</span>
        <span>Received ${esc(fmtAgo(a.createdAt))}</span>
        ${
          accepted
            ? `<span>Responder: ${esc(responder.name || responder.unit || "Assigned")}</span>`
            : ""
        }
      </div>
      <div class="alert-actions mt-3">
        ${buttons}
      </div>
    </div>
  </article>`;
}

function alertCardHTML(a) {
  if (a.supabaseRequest) return emergencyRequestCardHTML(a);
  if (a.supabaseAlert) {
    const location = hasPos(a) ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : "GPS unavailable";
    const pending = a.status === "unassigned";
    return `<article class="alert-card tone-danger">
      <div class="tile-icon tint-danger"><i data-lucide="alert-circle" class="w-5 h-5"></i></div>
      <div class="flex-1 min-w-0">
        <p class="text-[15px] font-bold t-main">${esc(a.title)}</p>
        <p class="text-sm t-main mt-1">${esc(a.userName)} · ${esc(location)}</p>
        <div class="alert-actions mt-3">
          <button data-action="dispatch-alert" data-id="${esc(a.id)}" class="btn btn-primary btn-sm" ${pending ? "" : "disabled"}>Dispatch nearest</button>
          <button data-action="assign-alert" data-id="${esc(a.id)}" class="btn btn-sm" ${pending ? "" : "disabled"}>Choose responder</button>
          <button data-action="cancel-sos" data-id="${esc(a.id)}" class="btn btn-danger-ghost btn-sm">Cancel SOS</button>
          <button data-action="alert-details" data-id="${esc(a.id)}" class="btn btn-sm">Details</button>
          ${hasPos(a) ? `<button data-action="locate" data-kind="alert" data-id="${esc(a.id)}" class="btn btn-sm">Show on map</button>` : ""}
        </div>
      </div>
    </article>`;
  }
  const t = TYPE_META[a.type] || TYPE_META.other;
  const s = ALERT_STATUS[a.status];
  const resp = findResponder(a.responderId);

  let responderLine = "";
  if (resp && a.status === "responding") {
    const d = hasPos(resp) && hasPos(a) ? distanceM(resp, a) : null;
    responderLine = `<p class="text-sm t-main mt-2">Responder: <strong>${esc(
      resp.name
    )}</strong>${
      d != null ? ` (about ${etaMin(d)} min away, ${fmtDistance(d)})` : ""
    }</p>`;
  }

  const pending = a.status === "unassigned";
  const buttons = `
                    <button data-action="dispatch-alert" data-id="${esc(
                a.id
              )}" class="btn btn-primary btn-sm" ${pending ? "" : "disabled"}>Dispatch nearest</button>
                    <button data-action="assign-alert" data-id="${esc(
                a.id
              )}" class="btn btn-sm" ${pending ? "" : "disabled"}>Choose responder</button>
                    <button data-action="cancel-sos" data-id="${esc(
                a.id
              )}" class="btn btn-danger-ghost btn-sm">Cancel SOS</button>
                    <button data-action="alert-details" data-id="${esc(
                a.id
              )}" class="btn btn-sm">Details</button>
                    ${!pending ? `<button data-action="resolve-alert" data-id="${esc(
                a.id
              )}" class="btn btn-ok btn-sm">Mark resolved</button>` : ""}`;

  return `
       <div class="alert-card ${s.card}">
           <div class="tile-icon tint-${t.tone}"><i data-lucide="${
    t.icon
  }" class="w-5 h-5"></i></div>
           <div class="flex-1 min-w-0">
               <div class="flex items-start justify-between gap-2">
                   <p class="text-[15px] font-bold t-main">${esc(a.title)}</p>
                   ${badge(s.badge, s.label)}
               </div>
               <p class="text-sm t-main mt-1">${esc(a.location)}</p>
               <div class="flex flex-wrap gap-x-3 text-xs t-muted mt-1">
                   <span>${esc(a.id)}</span>
                   <span>Reported <span data-since="${a.createdAt}">${fmtAgo(
    a.createdAt
  )}</span></span>
                   <span>via ${esc(a.reportedBy)}</span>
               </div>
               ${responderLine}
               <div class="alert-actions mt-3">
                   ${buttons}
               </div>
           </div>
       </div>`;
}

const emptyState = (title, hint) =>
  `<div class="p-6 text-center"><p class="font-semibold t-main">${esc(
    title
  )}</p><p class="text-sm t-muted mt-1">${esc(hint)}</p></div>`;

function renderAlerts() {
  const list = sortedActive();
  $("alerts-list").innerHTML = list.length
    ? list.map(alertCardHTML).join("")
    : emptyState(
        "No active alerts",
        "New SOS reports will appear here as soon as they come in."
      );
}

function renderEmergencyRequests() {
  const activeRequests = supabaseEmergencyRequests.filter(
    (request) => request.status === "pending" || request.status === "accepted"
  );
  const pendingCount = activeRequests.filter(
    (request) => request.status === "pending"
  ).length;
  $("emergency-feed-count").textContent = `${pendingCount} pending`;
  $("emergency-feed-list").innerHTML = activeRequests.length
    ? activeRequests
        .map((request) => emergencyRequestCardHTML(request.alert))
        .join("")
    : emptyState(
        "No active mobile SOS requests",
        "Incoming SOS alerts from the Android app will appear here in real time."
      );
}

const matchesQuery = (a, q) =>
  !q ||
  [
    a.id,
    a.requestId,
    a.userId,
    a.title,
    a.location,
    a.type,
    a.reportedBy,
    a.note,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q.toLowerCase());

function renderAlertsFull() {
  const active = state.alerts.filter(isActive);
  $("count-active").textContent = `(${active.length})`;
  $("count-unassigned").textContent = `(${
    active.filter((a) => a.status === "unassigned").length
  })`;
  $("count-responding").textContent = `(${
    active.filter((a) => a.status === "responding").length
  })`;
  document
    .querySelectorAll("#alert-filters .chip")
    .forEach((chip) =>
      chip.setAttribute(
        "aria-pressed",
        String(chip.dataset.value === ui.alertFilter)
      )
    );

  const list = sortedActive().filter(
    (a) =>
      (ui.alertFilter === "active" || a.status === ui.alertFilter) &&
      matchesQuery(a, ui.alertQuery)
  );
  $("alerts-full").innerHTML = list.length
    ? list.map(alertCardHTML).join("")
    : `<div class="xl:col-span-2 card">${emptyState(
        "No alerts match",
        "Try a different filter or clear the search."
      )}</div>`;
}

function filteredIncidents() {
  return [...state.alerts]
    .filter(
      (a) =>
        (ui.incStatus === "all" || a.status === ui.incStatus) &&
        ui.incTypes.includes(a.type) &&
        matchesQuery(a, ui.incQuery)
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

function renderIncidents() {
  const list = filteredIncidents();
  $(
    "incidents-count"
  ).textContent = `${list.length} of ${state.alerts.length} incidents`;
  $("incidents-body").innerHTML = list.length
    ? list
        .map((a) => {
          const t = TYPE_META[a.type] || TYPE_META.other;
          const s = ALERT_STATUS[a.status];
          const resp = a.supabaseRequest
            ? null
            : findResponder(a.responderId);
          return `
           <tr class="row-click" data-action="alert-details" data-id="${esc(
             a.id
           )}">
               <td>
                   <div class="flex items-center gap-3">
                       <div class="tile-icon tint-${
                         t.tone
                       }" style="width:2.25rem;height:2.25rem"><i data-lucide="${
            t.icon
          }" class="w-4 h-4"></i></div>
                       <div>
                           <button class="font-semibold t-main text-left focus-ring rounded" data-action="alert-details" data-id="${esc(
                             a.id
                           )}">${esc(a.title)}</button>
                           <p class="text-xs t-muted">${esc(a.id)}</p>
                       </div>
                   </div>
               </td>
               <td class="t-main">${esc(a.location)}</td>
               <td><p class="t-main">${fmtDateTime(
                 a.createdAt
               )}</p><p class="text-xs t-muted">${fmtAgo(a.createdAt)}</p></td>
               <td>${badge(s.badge, s.label)}</td>
               <td class="t-main">${
                 a.supabaseRequest && a.responderInfo.name
                   ? esc(a.responderInfo.name)
                   : resp
                   ? esc(resp.name)
                   : '<span class="t-faint">None</span>'
               }</td>
               <td class="t-main">${
                 a.dispatchedAt
                   ? fmtDuration(a.dispatchedAt - a.createdAt)
                   : '<span class="t-faint">Not dispatched</span>'
               }</td>
           </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">${emptyState(
        "No incidents found",
        "Change the filters or log a new incident."
      )}</td></tr>`;
}

function responderRowHTML(r, full) {
  const st = RESPONDER_STATUS[r.status];
  const inc = alertOf(r);
  const contact = r.phone
    ? `<a href="${telHref(r.phone)}" class="text-xs t-muted hover:underline">${esc(r.phone)}</a>`
    : r.email
    ? `<a href="mailto:${esc(r.email)}" class="text-xs t-muted hover:underline">${esc(r.email)}</a>`
    : '<span class="text-xs t-muted">Contact unavailable</span>';
  const statusControl = badge(st.badge, st.label);
  const canDispatch =
    r.status === "available" &&
    state.alerts.some((a) => a.status === "unassigned");
  const dispatchBtn = canDispatch
    ? `<button data-action="dispatch-responder" data-id="${esc(
        r.id
      )}" class="btn btn-primary btn-sm">Dispatch</button>`
    : "";
  const detailsBtn = `<button data-action="responder-details" data-id="${esc(
    r.id
  )}" class="btn btn-sm">Details</button>`;
  const extra = full
    ? `
           ${
             r.phone
               ? `<a href="${telHref(r.phone)}" class="icon-btn" aria-label="Call ${esc(
                   r.name
                 )}"><i data-lucide="phone" class="w-4 h-4"></i></a>`
               : r.email
               ? `<a href="mailto:${esc(r.email)}" class="icon-btn" aria-label="Email ${esc(
                   r.name
                 )}"><i data-lucide="mail" class="w-4 h-4"></i></a>`
               : ""
           }
           ${
             hasPos(r)
               ? `<button data-action="locate" data-kind="responder" data-id="${esc(
                   r.id
                 )}" class="icon-btn" aria-label="Show ${esc(
                   r.name
                 )} on the map"><i data-lucide="map-pin" class="w-4 h-4"></i></button>`
               : ""
           }
           <button data-action="edit-responder" data-id="${esc(
             r.id
           )}" class="icon-btn" aria-label="Edit ${esc(
        r.name
      )}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
           <button data-action="toggle-duty" data-id="${esc(
             r.id
           )}" class="icon-btn" aria-label="${
        r.status === "offline" ? "Put on duty" : "Take off duty"
      }: ${esc(r.name)}" title="${
        r.status === "offline" ? "Put on duty" : "Take off duty"
      }"><i data-lucide="power" class="w-4 h-4"></i></button>`
    : "";

  return `
       <tr>
           <td>
               <div class="flex items-center gap-3">
                   <div class="w-9 h-9 rounded-full surface-2 flex items-center justify-center font-bold text-xs t-main">${esc(
                     r.initials
                   )}</div>
                   <div>
                       <p class="font-semibold t-main">${esc(r.name)}</p>
                       ${contact}
                   </div>
               </div>
           </td>
           <td class="t-main">${esc(r.role)}</td>
           <td>${statusControl}</td>
           <td class="t-main">${esc(r.location)}${
    inc ? `<p class="text-xs t-muted">Handling ${esc(inc.id)}</p>` : ""
  }</td>
           <td><div class="flex items-center justify-end gap-2">${dispatchBtn}${
    full ? "" : detailsBtn
  }${full ? detailsBtn : ""}${extra}</div></td>
       </tr>`;
}

function renderRespondersTable() {
  $("responders-body").innerHTML = state.responders.length
    ? state.responders.map((r) => responderRowHTML(r, false)).join("")
    : `<tr><td colspan="5">${emptyState(
        "No responders yet",
        "Add your first responder from the Responders page."
      )}</td></tr>`;
}

function renderRespondersFull() {
  const q = ui.respQuery.toLowerCase();
  const list = state.responders.filter(
    (r) =>
      (ui.respStatus === "all" || r.status === ui.respStatus) &&
      (!q || `${r.name} ${r.role} ${r.location}`.toLowerCase().includes(q))
  );
  $("responders-full-body").innerHTML = list.length
    ? list.map((r) => responderRowHTML(r, true)).join("")
    : `<tr><td colspan="5">${emptyState(
        "No responders match",
        "Change the filters or add a responder."
      )}</td></tr>`;
}

function renderLiveList() {
  const card = ({ kind, item, title, sub, st }) => `
    <button data-action="focus" data-kind="${kind}" data-id="${esc(item.id)}" class="w-full text-left p-3 rounded-xl border line surface-2 focus-ring">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-sm t-main">${esc(title)}</span>${badge(st.badge, st.label)}
      </div>
      <p class="text-xs t-muted mt-1">${esc(sub)}</p>
      ${hasPos(item) ? "" : '<p class="text-xs t-faint mt-1">No position on the map</p>'}
    </button>`;
  const section = (title, rows, empty) =>
    `<p class="field-label pt-2">${title}</p>` +
    (rows.length ? rows.join("") : `<p class="text-xs t-muted pb-2">${empty}</p>`);

  const incidents = sortedActive().map((a) =>
    card({
      kind: "alert",
      item: a,
      title: a.userName && (a.supabaseRequest || a.supabaseAlert)
        ? `SOS · ${a.userName}`
        : a.title,
      sub: a.location,
      st: ALERT_STATUS[a.status],
    })
  );
  const crew = state.responders.map((r) =>
    card({ kind: "responder", item: r, title: r.name, sub: r.location, st: RESPONDER_STATUS[r.status] })
  );
  const services = facilities.map((f) =>
    card({
      kind: "facility",
      item: f,
      title: f.name,
      sub: `${fmtDistance(f.dist)} from campus`,
      st: { badge: FACILITY_TYPES[f.type].badge, label: FACILITY_TYPES[f.type].label },
    })
  );
  const servicesEmpty =
    mapMode !== "mapbox"
      ? "Mapbox is connecting to show nearby hospitals, police and fire stations."
      : facilitiesState === "loading"
      ? "Looking for nearby services…"
      : facilitiesState === "error"
      ? "Nearby services could not be loaded."
      : "None found within the search radius.";

  $("live-list").innerHTML =
    section("Incidents", incidents, "No active incidents.") +
    section("Responders", crew, "No responders yet.") +
    section("Nearby emergency services", services, servicesEmpty);
}

function renderBroadcastHistory() {
  const list = [...state.broadcasts].sort((a, b) => b.sentAt - a.sentAt);
  $("broadcast-history").innerHTML = list.length
    ? list
        .map(
          (b) => `
           <div class="p-4 rounded-xl border line surface-2">
               <div class="flex items-center justify-between gap-2">
                   ${badge(
                     LEVEL_META[b.level] ? LEVEL_META[b.level].badge : "badge-info",
                     LEVEL_META[b.level] ? LEVEL_META[b.level].label : "Notice"
                   )}
                   <span class="text-xs t-muted">${fmtDateTime(b.sentAt)}</span>
               </div>
               <p class="text-sm t-main mt-2">${esc(b.message)}</p>
               <p class="text-xs t-muted mt-2">Published to ${esc(b.audience)}</p>
           </div>`
        )
        .join("")
    : emptyState(
        "Nothing sent yet",
        "Broadcasts you send will be listed here."
      );
}

function formatBroadcastFromSupabase(broadcast) {
  const urgency = String(broadcast.urgency || "").toLowerCase();
  const level =
    urgency === "critical" || urgency === "emergency"
      ? "emergency"
      : urgency === "warning"
      ? "warning"
      : "info";
  const audience =
    broadcast.audience === "everyone"
      ? "Everyone on campus"
      : broadcast.audience === "responders"
      ? "Responders only"
      : broadcast.audience === "building"
      ? broadcast.building || "One building"
      : String(broadcast.audience || "Everyone on campus");
  const sentAt = timestampMillisFromRecord(broadcast.sentAt);

  return {
    id: broadcast.id,
    message: String(broadcast.message || ""),
    audience,
    level,
    sentAt,
  };
}

function timestampMillisFromRecord(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function locationFromRecord(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  return Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
    ? { lat, lng }
    : null;
}

function normalizeSOSLifecycleStatus(value) {
  if (value === false) return "cancelled";
  if (value === true) return "pending";
  const status = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return [
    "cancel",
    "withdrawn",
    "user_cancel",
    "user_cancelled",
    "user_canceled",
    "canceled_by_user",
    "cancelled_by_user",
    "canceled_by_student",
    "cancelled_by_student",
    "inactive",
  ].includes(status)
    ? "cancelled"
    : status;
}

function lifecycleStatusFromRecord(record) {
  if (
    record.is_active === false ||
    record.isActive === false ||
    record.active === false ||
    record.is_cancelled === true ||
    record.is_canceled === true ||
    record.cancelled === true ||
    record.canceled === true
  ) return false;
  return record.status ?? record.alertStatus ?? record.alert_status ??
    record.state ?? null;
}

function formatEmergencyRequestFromSupabase(request) {
  const status = normalizeSOSLifecycleStatus(lifecycleStatusFromRecord(request));
  const internalStatus = {
    pending: "unassigned",
    active: "unassigned",
    new: "unassigned",
    unhandled: "unassigned",
    accepted: "responding",
    assigned: "responding",
    dispatched: "responding",
    responding: "responding",
    en_route: "responding",
    in_progress: "responding",
    cancelled: "false_alarm",
    canceled: "false_alarm",
    cancel: "false_alarm",
    withdrawn: "false_alarm",
    user_cancelled: "false_alarm",
    user_canceled: "false_alarm",
    canceled_by_user: "false_alarm",
    cancelled_by_user: "false_alarm",
    declined: "false_alarm",
    false_alarm: "false_alarm",
    resolved: "resolved",
    closed: "resolved",
    completed: "resolved",
  }[status] || "unknown";
  const userLocation =
    locationFromRecord(request.userLocation) ||
    locationFromRecord(request.location) ||
    locationFromRecord({ lat: request.latitude, lng: request.longitude });
  const responderLocation = locationFromRecord(request.responderLocation);
  const responderInfo = request.responderInfo || {};
  const userInfo = request.userProfile || request.userInfo || {};
  const type = request.type || request.emergencyType ||
    request.emergency_type || request.alert_type || request.category;
  const typeKey = String(type || "").toLowerCase();
  const userName =
    userInfo.name ||
    request.userName ||
    request.name ||
    "";
  const createdAt = timestampMillisFromRecord(
    request.timestamp || request.createdAt || request.created_at
  );
  const alert = {
    id: `MOBILE-${request.id}`,
    requestId: String(request.requestId || request.id),
    supabaseRecordId: request.id,
    supabaseRequest: true,
    type: TYPE_META[typeKey] ? typeKey : "other",
    title: String(request.title || type || "Emergency SOS"),
    location: String(
      request.locationName ||
        (typeof request.location === "string" ? request.location : "") ||
        request.address ||
        (userLocation ? "Mobile user GPS location" : "Location unavailable")
    ),
    lat: userLocation ? userLocation.lat : null,
    lng: userLocation ? userLocation.lng : null,
    userLocation,
    responderLocation,
    responderInfo: {
      name: String(responderInfo.name || ""),
      phone: String(responderInfo.phone || ""),
      unit: String(responderInfo.unit || ""),
    },
    status: internalStatus,
    priority: "critical",
    reportedBy: String(userName || "Mobile app user"),
    userName: String(userName),
    userRole: String(
      request.userRole || request.user_role || userInfo.role || request.role || ""
    ),
    userPhone: String(
      request.userPhone || request.user_phone || userInfo.phone ||
      userInfo.contact_number || request.phone || request.contact_number || ""
    ),
    userId: String(request.userId || request.user_id || ""),
    note: String(request.description || request.message || request.note || request.details || ""),
    createdAt,
    dispatchedAt:
      status === "accepted" && request.acceptedAt
        ? timestampMillisFromRecord(request.acceptedAt)
        : null,
    resolvedAt:
      (status === "resolved" || status === "cancelled") && request.updatedAt
        ? timestampMillisFromRecord(request.updatedAt)
        : null,
    responderId: String(
      responderInfo.unit ||
      responderInfo.id ||
      request.responder_id ||
      request.responderId ||
      ""
    ),
  };

  return { id: request.id, status: ({
    pending: "pending",
    active: "pending",
    new: "pending",
    unhandled: "pending",
    accepted: "accepted",
    assigned: "accepted",
    dispatched: "accepted",
    responding: "accepted",
    en_route: "accepted",
    in_progress: "accepted",
    cancelled: "cancelled",
    canceled: "cancelled",
    cancel: "cancelled",
    withdrawn: "cancelled",
    user_cancelled: "cancelled",
    user_canceled: "cancelled",
    canceled_by_user: "cancelled",
    cancelled_by_user: "cancelled",
    declined: "cancelled",
    false_alarm: "cancelled",
    resolved: "resolved",
    closed: "resolved",
    completed: "resolved",
  })[status] || "unknown", alert };
}

function formatAlertFromSupabase(record) {
  const rawStatus = normalizeSOSLifecycleStatus(lifecycleStatusFromRecord(record));
  const userId = String(record.userId || record.user_id || record.uid || "");
  const mappedStatus = {
    pending: "unassigned",
    active: "unassigned",
    new: "unassigned",
    unhandled: "unassigned",
    accepted: "responding",
    assigned: "responding",
    dispatched: "responding",
    responding: "responding",
    en_route: "responding",
    in_progress: "responding",
    resolved: "resolved",
    declined: "false_alarm",
    cancelled: "false_alarm",
    canceled: "false_alarm",
    cancel: "false_alarm",
    withdrawn: "false_alarm",
    user_cancelled: "false_alarm",
    user_canceled: "false_alarm",
    canceled_by_user: "false_alarm",
    cancelled_by_user: "false_alarm",
    false_alarm: "false_alarm",
  }[rawStatus];
  const status = mappedStatus === "unassigned" && !userId
    ? "unknown"
    : mappedStatus || "unknown";
  const location = locationFromRecord(record.userLocation) ||
    locationFromRecord(record.location) ||
    locationFromRecord({
      lat: record.latitude ?? record.lat,
      lng: record.longitude ?? record.lng,
    });
  const userInfo = record.userProfile || record.userInfo || {};
  const type =
    record.type || record.emergencyType || record.emergency_type ||
    record.alert_type || record.alertType || record.category;
  const userName = String(
    userInfo.name || record.userName || record.name || "Name not provided"
  );
  return {
    id: `ALERT-${record.id}`,
    supabaseRecordId: record.id,
    supabaseAlert: true,
    type: TYPE_META[String(type || "").toLowerCase()]
      ? String(type).toLowerCase()
      : "other",
    title: String(record.title || type || "Emergency SOS"),
    location: String(
      record.locationName ||
        (typeof record.location === "string" ? record.location : "") ||
        record.address ||
        (location ? "User GPS location" : "Location unavailable")
    ),
    lat: location ? location.lat : null,
    lng: location ? location.lng : null,
    status,
    priority: "critical",
    reportedBy: userName,
    userName,
    userId,
    userRole: String(
      record.userRole || record.user_role || userInfo.role || record.role || ""
    ),
    userPhone: String(
      record.userPhone || record.user_phone || userInfo.phone ||
      userInfo.contact_number || record.phone || record.contact_number || ""
    ),
    note: String(record.description || record.message || record.note || record.details || ""),
    createdAt: timestampMillisFromRecord(
      record.timestamp || record.createdAt || record.created_at
    ),
    dispatchedAt: record.accepted_at || record.acceptedAt || record.dispatched_at
      ? timestampMillisFromRecord(
          record.accepted_at || record.acceptedAt || record.dispatched_at
        )
      : null,
    resolvedAt: record.resolved_at || record.resolvedAt
      ? timestampMillisFromRecord(record.resolved_at || record.resolvedAt)
      : null,
    responderId: String(
      record.responder_id ||
      record.assigned_responder_id ||
      record.assignedResponderId ||
      ""
    ),
    responderName: String(record.responder_name || record.responderName || ""),
    responderLatitude: Number(record.responder_latitude ?? record.responderLatitude),
    responderLongitude: Number(record.responder_longitude ?? record.responderLongitude),
  };
}

function formatIncidentFromSupabase(record) {
  const rawStatus = normalizeSOSLifecycleStatus(lifecycleStatusFromRecord(record));
  const location = locationFromRecord({
    lat: record.latitude ?? record.lat,
    lng: record.longitude ?? record.lng,
  });
  const profile = record.userProfile ||
    (Array.isArray(record.users) ? record.users[0] : record.users) ||
    record.userInfo;
  const userId = String(record.user_id || record.userId || "");
  const type =
    record.alert_type || record.emergency_type || record.emergencyType ||
    record.type || record.category;
  const userName = String(
    profile?.name ||
      record.userName ||
      record.name ||
      "Name not provided"
  );
  const createdAt = timestampMillisFromRecord(
    record.created_at || record.createdAt || record.timestamp
  );
  const mappedStatus = ({
      active: "unassigned",
      pending: "unassigned",
      new: "unassigned",
      unhandled: "unassigned",
      accepted: "responding",
      assigned: "responding",
      dispatched: "responding",
      responding: "responding",
      en_route: "responding",
      in_progress: "responding",
      resolved: "resolved",
      closed: "resolved",
      completed: "resolved",
      cancelled: "false_alarm",
      canceled: "false_alarm",
      cancel: "false_alarm",
      withdrawn: "false_alarm",
      user_cancelled: "false_alarm",
      user_canceled: "false_alarm",
      canceled_by_user: "false_alarm",
      cancelled_by_user: "false_alarm",
      declined: "false_alarm",
      rejected: "false_alarm",
      false_alarm: "false_alarm",
  })[rawStatus];
  const status = mappedStatus === "unassigned" && !userId
    ? "unknown"
    : mappedStatus || "unknown";
  return {
    id: `INCIDENT-${record.id}`,
    supabaseRecordId: String(record.id),
    supabaseIncident: true,
    type: TYPE_META[String(type || "").toLowerCase()]
      ? String(type).toLowerCase()
      : "other",
    title: String(record.title || type || "SOS Emergency"),
    location: String(
      record.locationName ||
        (typeof record.location === "string" ? record.location : "") ||
        record.address ||
        (location
          ? `${profile?.role || record.user_role || "Student"} GPS location`
          : "Location unavailable")
    ),
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    status,
    priority: "critical",
    reportedBy: userName,
    userName,
    userId,
    userRole: String(profile?.role || record.user_role || record.userRole || "Student"),
    userPhone: String(
      profile?.phone || profile?.contact_number || record.userPhone ||
      record.user_phone || record.phone || record.contact_number || ""
    ),
    note: String(record.description || record.message || record.note || record.details || ""),
    createdAt,
    displayTime: record.displayTime || "",
    responderId: String(
      record.responder_id ||
      record.responderId ||
      record.assigned_responder_id ||
      record.assignedResponderId ||
      record.assignedResponder?.id ||
      record.assigned_responder?.id ||
      ""
    ),
  };
}

function syncSupabaseAlerts({ renderDashboard = true } = {}) {
  const supabaseRecords = [
    ...supabaseEmergencyRequests.map(({ alert }) => alert),
    ...supabaseAlertRecords.map(formatAlertFromSupabase),
    ...supabaseIncidentRecords.map(formatIncidentFromSupabase),
  ];
  state.alerts = state.alerts.filter(
    (alert) =>
      !alert.supabaseRequest &&
      !alert.supabaseAlert &&
      !alert.supabaseIncident
  ).concat(supabaseRecords);
  if (registeredStaffProfiles.length) {
    syncRegisteredStaff(registeredStaffProfiles);
  }
  gFitted = false;
  if (renderDashboard) render();
}

function renderNotifications() {
  const unread = state.activity.filter((n) => !n.read).length;
  const b = $("notif-badge");
  b.hidden = !unread;
  b.textContent = unread > 9 ? "9+" : unread;
  $("notif-btn").setAttribute(
    "aria-label",
    unread ? `Notifications (${unread} unread)` : "Notifications"
  );

  const dot = { info: "#3b82f6", success: "#22c55e", error: "#ef4444" };
  $("notif-panel").innerHTML =
    `
           <div class="flex items-center justify-between px-4 py-3 border-b line">
               <p class="font-semibold t-main text-sm">Notifications</p>
               <button data-action="clear-notifications" class="text-xs font-semibold t-info hover:underline">Clear all</button>
           </div>` +
    (state.activity.length
      ? state.activity
          .map(
            (n) => `
           <div class="notif-item ${n.read ? "" : "unread"}">
               <div class="flex gap-2"><span class="mt-1.5 w-2 h-2 rounded-full shrink-0" style="background:${
                 dot[n.level] || dot.info
               }"></span>
               <div><p class="t-main">${esc(
                 n.text
               )}</p><p class="text-xs t-muted mt-0.5">${fmtAgo(
              n.at
            )}</p></div></div>
           </div>`
          )
          .join("")
      : '<p class="p-4 text-sm t-muted">No notifications yet.</p>');
}

function renderReports() {
  const all = state.alerts;
  const resolved = all.filter((a) => a.status === "resolved").length;
  const falseAlarms = all.filter((a) => a.status === "false_alarm").length;
  const activeN = all.filter(isActive).length;
  const resp = all
    .filter((a) => a.dispatchedAt)
    .map((a) => a.dispatchedAt - a.createdAt);
  const done = all
    .filter((a) => a.status === "resolved" && a.resolvedAt)
    .map((a) => a.resolvedAt - a.createdAt);
  const avg = (arr) =>
    arr.length ? arr.reduce((s, t) => s + t, 0) / arr.length : null;

  const tile = (label, value, sub) => `
           <div class="card stat-card"><p class="text-sm font-medium t-muted">${label}</p>
           <p class="stat-value t-main mt-2">${value}</p><p class="text-sm t-muted mt-2">${sub}</p></div>`;
  const bar = (label, value, max, note = "") => `
           <div>
               <div class="flex justify-between text-sm mb-1"><span class="t-main">${esc(
                 label
               )}</span><span class="t-muted">${value}${note}</span></div>
               <div class="bar-track"><div class="bar-fill" style="width:${
                 max ? Math.round((value / max) * 100) : 0
               }%"></div></div>
           </div>`;

  const byType = Object.keys(TYPE_META).map((k) => ({
    label: TYPE_META[k].label,
    n: all.filter((a) => a.type === k).length,
  }));
  const maxType = Math.max(1, ...byType.map((t) => t.n));

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i);
    const end = start.getTime() + 24 * 3600 * 1000;
    days.push({
      label: start.toLocaleDateString("en-PH", {
        weekday: "short",
        day: "numeric",
      }),
      n: all.filter((a) => a.createdAt >= start.getTime() && a.createdAt < end)
        .length,
    });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.n));

  const places = {};
  all.forEach((a) => {
    const k = a.location.split(",")[0].trim();
    places[k] = (places[k] || 0) + 1;
  });
  const topPlaces = Object.entries(places)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const workload = state.responders.map((r) => {
    const mine = all.filter((a) => a.responderId === r.id);
    const t = mine
      .filter((a) => a.dispatchedAt)
      .map((a) => a.dispatchedAt - a.createdAt);
    return { r, n: mine.length, avg: avg(t) };
  });

  $("reports-content").innerHTML = `
           <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
               ${tile("Total incidents", all.length, `${activeN} still active`)}
               ${tile("Resolved", resolved, `${falseAlarms} false alarms`)}
               ${tile(
                 "Avg dispatch time",
                 resp.length ? fmtDuration(avg(resp)) : "—",
                 "From alert to dispatch"
               )}
               ${tile(
                 "Avg time to resolve",
                 done.length ? fmtDuration(avg(done)) : "—",
                 "From alert to resolved"
               )}
           </div>
           <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
               <section class="card p-5 lg:p-6 space-y-4"><h2 class="card-title t-main">Incidents by type</h2>${byType
                 .map((t) => bar(t.label, t.n, maxType))
                 .join("")}</section>
               <section class="card p-5 lg:p-6 space-y-4"><h2 class="card-title t-main">Last 7 days</h2>${days
                 .map((d) => bar(d.label, d.n, maxDay))
                 .join("")}</section>
               <section class="card p-5 lg:p-6 space-y-4"><h2 class="card-title t-main">Where incidents happen</h2>
                   ${
                     topPlaces.length
                       ? topPlaces
                           .map(([p, n]) => bar(p, n, topPlaces[0][1]))
                           .join("")
                       : '<p class="text-sm t-muted">No incidents yet.</p>'
                   }</section>
               <section class="card overflow-hidden"><div class="card-head"><h2 class="card-title t-main">Responder workload</h2></div>
                   <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Responder</th><th>Incidents</th><th>Avg dispatch time</th></tr></thead><tbody>
                   ${workload
                     .map(
                       (w) =>
                         `<tr><td class="t-main">${esc(
                           w.r.name
                         )}</td><td class="t-main">${
                           w.n
                         }</td><td class="t-main">${
                           w.avg != null ? fmtDuration(w.avg) : "—"
                         }</td></tr>`
                     )
                     .join("")}
                   </tbody></table></div></section>
           </div>`;
}

// Re-draws everything from `state`. Call this after any change to the data.
function render() {
  renderStats();
  renderEmergencyRequests();
  renderAlerts();
  renderAlertsFull();
  renderIncidents();
  renderRespondersTable();
  renderRespondersFull();
  renderLiveList();
  renderBroadcastHistory();
  renderNotifications();
  if (currentView === "reports") renderReports();
  renderMap();
  icons();
}

/* ---------- 7. ACTIONS ---------- */
function logActivity(text, level = "info") {
  state.activity.unshift({
    id: `N-${Date.now()}`,
    text,
    level,
    at: Date.now(),
    read: false,
  });
  state.activity = state.activity.slice(0, 50);
}

function beep() {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = () => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
      setTimeout(() => ctx.close(), 500);
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => ctx.close());
    } else {
      play();
    }
  } catch (e) {
    /* sound is optional */
  }
}

// --- New incidents ---
// receiveAlert() is the one place new alerts enter the system. Call it from your real feed
// (WebSocket, polling, etc.) with { type, location, lat, lng, note, reportedBy }.
function receiveAlert(data, { manual = false } = {}) {
  const type = TYPE_META[data.type] ? data.type : "other";
  const meta = TYPE_META[type];
  const alert = {
    id: nextId(meta.prefix, state.alerts),
    type,
    title: data.title || meta.title,
    location: data.location,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    status: "unassigned",
    priority: data.priority || PRIORITY_DEFAULT[type],
    reportedBy: data.reportedBy || "Student app",
    note: data.note || "",
    createdAt: Date.now(),
    dispatchedAt: null,
    resolvedAt: null,
    responderId: null,
  };
  state.alerts.push(alert);
  logActivity(`New ${meta.title}: ${alert.location} (${alert.id})`, "error");
  save();
  render();
  if (!manual) beep();
  notify(
    manual
      ? `Incident ${alert.id} logged`
      : `New ${meta.title} reported at ${alert.location}`,
    manual ? "success" : "error"
  );
  return alert;
}

// --- Dispatch ---
function assign(alert, responder) {
  if (!isResponderAvailableForAssignment(responder)) {
    notify(`${responder.name} is no longer available for assignment.`, "error");
    return;
  }
  alert.status = "responding";
  alert.responderId = responder.id;
  alert.dispatchedAt = Date.now();
  responder.status = "responding";
  responder.location = `En route to ${alert.location}`;
  logActivity(
    `${responder.name} dispatched to ${alert.location} (${alert.id})`,
    "success"
  );
  save();
  render();
  const d =
    hasPos(responder) && hasPos(alert) ? distanceM(responder, alert) : null;
  notify(
    `${responder.name} dispatched to ${alert.location}${
      d != null ? `, about ${etaMin(d)} min away` : ""
    }`,
    "success"
  );
}

function dispatchAlert(alertId, responderId = null) {
  const alert = findAlert(alertId);
  if (!alert || alert.status !== "unassigned") return;
  if (alert.supabaseAlert || alert.supabaseIncident) {
    if (!supabaseDashboard?.dispatchSOSRecord) {
      return notify("Supabase dispatch is unavailable. Reload the dashboard and try again.", "error");
    }
    const responder = responderId
      ? findResponder(responderId)
      : (availableByDistance(alert)[0] || {}).r;
    if (!responder || !isResponderAvailableForAssignment(responder)) {
      return notify("No responders are available right now", "error");
    }
    const table = alert.supabaseIncident ? "incidents" : "alerts";
    void supabaseDashboard.dispatchSOSRecord(table, alert.supabaseRecordId, {
      id: responder.id,
      name: responder.name,
      phone: responder.phone,
      unit: responder.id,
      specialty: responder.role,
      etaMinutes: hasPos(responder) && hasPos(alert)
        ? etaMin(distanceM(responder, alert))
        : null,
    }).then(() => {
      window.safepaterosMarkResponderResponding?.(responder.id, alert.location);
      notify(`${responder.name} dispatched to ${alert.location}.`, "success");
    }).catch((error) => {
      console.error("SOS dispatch could not be saved.", error);
      notify(`SOS could not be dispatched: ${error.message || "Supabase error"}`, "error");
    });
    return;
  }
  const responder = responderId
    ? findResponder(responderId)
    : (availableByDistance(alert)[0] || {}).r;
  if (!responder || !isResponderAvailableForAssignment(responder))
    return notify("No responders are available right now", "error");
  if (alert.supabaseRequest) {
    void commitEmergencyAcceptance(alert.supabaseRecordId, {
      name: responder.name,
      phone: responder.phone,
      unit: responder.id,
    });
    return;
  }
  assign(alert, responder);
}

function dispatchResponder(responderId) {
  const responder = findResponder(responderId);
  if (!responder || !isResponderAvailableForAssignment(responder)) return;
  const waiting = sortedActive().filter((a) => a.status === "unassigned");
  if (!waiting.length)
    return notify("No alerts are waiting for a responder", "info");
  // Send them to the most urgent waiting alert
  assign(waiting[0], responder);
}

async function commitEmergencyAcceptance(requestId, responderInfo) {
  if (!supabaseDashboard) {
    notify("Supabase is not connected. The SOS request was not accepted.", "error");
    return;
  }
  const actionButton = $("modal-actions").querySelector(".btn-primary");
  if (actionButton) actionButton.disabled = true;
  try {
    await supabaseDashboard.acceptEmergencyRequest(
      requestId,
      responderInfo,
      supabaseDashboard.adminId
    );
    closeModal();
    notify("SOS accepted. The mobile user will be notified through Supabase.", "success");
  } catch (error) {
    console.error("Emergency request acceptance failed.", error);
    notify(
      `SOS could not be accepted: ${error.message || "Supabase error"}`,
      "error"
    );
  } finally {
    if (actionButton && modalOpen()) actionButton.disabled = false;
  }
}

function rejectEmergencyRequest(requestId) {
  const request = supabaseEmergencyRequests.find(
    (item) => item.id === requestId
  );
  if (!request || request.status !== "pending") {
    notify("Only pending SOS requests can be rejected.", "error");
    return;
  }
  confirmDialog({
    title: `Reject ${request.alert.requestId}?`,
    message:
      "This will mark the mobile SOS request as cancelled in Supabase. The user will see the updated status.",
    confirmLabel: "Reject request",
    onConfirm: () => {
      void commitEmergencyRejection(requestId);
    },
  });
}

async function commitEmergencyRejection(requestId) {
  if (!supabaseDashboard) {
    notify("Supabase is not connected. The SOS request was not changed.", "error");
    return;
  }
  try {
    await supabaseDashboard.cancelEmergencyRequest(
      requestId,
      supabaseDashboard.adminId
    );
    notify("SOS request rejected and marked cancelled.", "success");
  } catch (error) {
    console.error("Emergency request rejection failed.", error);
    notify(
      `SOS could not be rejected: ${error.message || "Supabase error"}`,
      "error"
    );
  }
}

function resolveEmergencyRequest(requestId) {
  const request = supabaseEmergencyRequests.find(
    (item) => item.id === requestId
  );
  if (!request || request.status !== "accepted") {
    notify("Only accepted SOS requests can be resolved.", "error");
    return;
  }
  confirmDialog({
    title: `Resolve ${request.alert.requestId}?`,
    message: "This will close the emergency request in Supabase.",
    confirmLabel: "Mark resolved",
    onConfirm: () => {
      void commitEmergencyResolution(requestId);
    },
  });
}

async function commitEmergencyResolution(requestId) {
  if (!supabaseDashboard) {
    notify("Supabase is not connected. The SOS request was not changed.", "error");
    return;
  }
  try {
    await supabaseDashboard.resolveEmergencyRequest(
      requestId,
      supabaseDashboard.adminId
    );
    notify("SOS request marked resolved.", "success");
  } catch (error) {
    console.error("Emergency request resolution failed.", error);
    notify(
      `SOS could not be resolved: ${error.message || "Supabase error"}`,
      "error"
    );
  }
}

function startEmergencyLocationSharing(requestId) {
  const request = supabaseEmergencyRequests.find(
    (item) => item.id === requestId
  );
  if (!request || request.status !== "accepted") {
    notify("Accept the SOS before sharing responder location.", "error");
    return;
  }
  if (!navigator.geolocation) {
    notify("This browser does not provide GPS location sharing.", "error");
    return;
  }
  if (!supabaseDashboard) {
    notify("Supabase is not connected. Responder location was not shared.", "error");
    return;
  }

  const watchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await supabaseDashboard.updateEmergencyResponderLocation(requestId, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      } catch (error) {
        console.error("Responder location update failed.", error);
        stopEmergencyLocationSharing(requestId, false);
        notify(
          `Responder location could not be updated: ${
            error.message || "Supabase error"
          }`,
          "error"
        );
      }
    },
    (error) => {
      console.error("Responder GPS access failed.", error);
      stopEmergencyLocationSharing(requestId, false);
      const message =
        error.code === error.PERMISSION_DENIED
          ? "Allow location access in the browser to share responder GPS."
          : error.code === error.TIMEOUT
          ? "Timed out while reading responder GPS. Try again."
          : "Responder GPS is unavailable. Check the device location settings.";
      notify(message, "error");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  emergencyLocationWatchers.set(requestId, watchId);
  render();
  notify("Sharing this device's live GPS location with the SOS requester.", "info");
}

function stopEmergencyLocationSharing(requestId, showMessage = true) {
  if (!emergencyLocationWatchers.has(requestId)) return;
  navigator.geolocation.clearWatch(emergencyLocationWatchers.get(requestId));
  emergencyLocationWatchers.delete(requestId);
  render();
  if (showMessage) notify("Responder location sharing stopped.", "info");
}

function closeAlert(alertId, outcome) {
  const alert = findAlert(alertId);
  if (!alert || !isActive(alert)) return;
  if (alert.supabaseAlert || alert.supabaseIncident) {
    if (outcome === "false_alarm") return void classifySupabaseSOS(alertId);
    return void cancelSupabaseSOS(alertId);
  }
  const responder = findResponder(alert.responderId);
  alert.status = outcome;
  alert.resolvedAt = Date.now();
  if (responder) {
    responder.status = "available";
    responder.location = alert.location;
    if (hasPos(alert)) {
      responder.lat = alert.lat;
      responder.lng = alert.lng;
    }
  }
  logActivity(
    `${alert.id} marked ${
      outcome === "resolved" ? "resolved" : "as a false alarm"
    }`,
    "info"
  );
  save();
  render();
  notify(
    `${alert.id} marked ${
      outcome === "resolved" ? "resolved" : "as a false alarm"
    }${responder ? `. ${responder.name} is available again` : ""}`,
    "success"
  );
}

async function cancelSupabaseSOS(alertId) {
  const alert = findAlert(alertId);
  if (!alert || !isActive(alert)) return;
  if (!alert.supabaseRequest && !alert.supabaseAlert && !alert.supabaseIncident) {
    closeAlert(alertId, "false_alarm");
    return;
  }
  const confirmed = await window.safepaterosConfirm({
    title: "Cancel SOS?",
    message: `Cancel the SOS reported by ${alert.userName || "this user"}? It will remain in incident history as a false alarm.`,
    confirmLabel: "Cancel SOS",
  });
  if (!confirmed) return;
  if (!supabaseDashboard?.updateSOSRecordStatus) {
    notify("Supabase status updates are unavailable. The SOS was not changed.", "error");
    return;
  }
  const table = alert.supabaseRequest
    ? "emergency_requests"
    : alert.supabaseIncident
      ? "incidents"
      : "alerts";
  void supabaseDashboard.updateSOSRecordStatus(
    table,
    alert.supabaseRecordId,
    "Declined"
  ).then(() => {
    alert.status = "false_alarm";
    alert.resolvedAt = Date.now();
    render();
    notify("SOS cancelled and retained in incident history as a false alarm.", "success");
  }).catch((error) => {
    console.error("SOS cancellation could not be saved.", error);
    notify(`SOS could not be cancelled: ${error.message || "Supabase error"}`, "error");
  });
}

async function classifySupabaseSOS(alertId) {
  const alert = findAlert(alertId);
  if (!alert || (!alert.supabaseAlert && !alert.supabaseIncident)) return;
  const confirmed = await window.safepaterosConfirm({
    title: "Classify as False Alarm?",
    message: "This incident will remain in history and be categorized as a false alarm.",
    confirmLabel: "Classify incident",
  });
  if (!confirmed) return;
  if (!supabaseDashboard?.updateSOSRecordStatus) {
    notify("Supabase status updates are unavailable. The incident was not changed.", "error");
    return;
  }
  const table = alert.supabaseIncident ? "incidents" : "alerts";
  void supabaseDashboard.updateSOSRecordStatus(
    table,
    alert.supabaseRecordId,
    "False Alarm"
  ).then(() => {
    alert.status = "false_alarm";
    alert.resolvedAt = Date.now();
    render();
    notify("Incident classified as a false alarm.", "success");
  }).catch((error) => {
    console.error("SOS false-alarm classification could not be saved.", error);
    notify(`Could not classify incident: ${error.message || "Supabase error"}`, "error");
  });
}

// --- Responders ---
function toggleDuty(id) {
  const r = findResponder(id);
  if (!r) return;
  if (r.status === "responding")
    return notify(
      `${r.name} is handling an incident. Resolve it first.`,
      "error"
    );
  r.status = r.status === "offline" ? "available" : "offline";
  logActivity(
    `${r.name} is now ${r.status === "offline" ? "off duty" : "available"}`,
    "info"
  );
  save();
  render();
  notify(
    `${r.name} is now ${r.status === "offline" ? "off duty" : "available"}`,
    "info"
  );
}

function setResponderStatus(id, status) {
  const responder = findResponder(id);
  if (
    !responder ||
    !Object.prototype.hasOwnProperty.call(RESPONDER_STATUS, status)
  ) return;
  if (alertOf(responder) && status !== "responding") {
    notify(`${responder.name} is handling an incident. Resolve it first.`, "error");
    render();
    return;
  }
  responder.status = status;
  save();
  render();
  notify(`${responder.name} is now ${RESPONDER_STATUS[status].label.toLowerCase()}`, "info");
}

function deleteResponder(id) {
  const r = findResponder(id);
  if (!r) return;
  if (r.staffUser)
    return notify("Registered staff stay in the responder roster. Set them off duty instead.", "error");
  if (r.status === "responding")
    return notify(
      `${r.name} is handling an incident. Resolve it first.`,
      "error"
    );
  state.responders = state.responders.filter((x) => x.id !== id);
  save();
  render();
  notify(`${r.name} removed`, "success");
}

// --- Broadcast ---
function audienceText() {
  const a = $("bc-audience").value;
  return a === "responders"
    ? "Responders only"
    : a === "building"
    ? $("bc-building").value
    : "Everyone on campus";
}
function recipientsText() {
  const a = $("bc-audience").value;
  const crew = state.responders.filter((r) => r.status !== "offline").length;
  if (a === "responders") return `About ${crew} responders on duty`;
  if (a === "building") return `People near ${$("bc-building").value}`;
  return `About ${(
    Number(state.campus.activeUsers) + crew
  ).toLocaleString()} people`;
}
function updateBroadcastMeta() {
  $("bc-building-wrap").hidden = $("bc-audience").value !== "building";
  $("bc-recipients").textContent = recipientsText();
  $("bc-count").textContent = `${$("bc-message").value.length} / 320`;
}
function sendBroadcast() {
  const message = $("bc-message").value.trim();
  const level = $("bc-level").value;
  if (message.length < 5) {
    notify("Write a message before sending", "error");
    $("bc-message").focus();
    return;
  }

  const send = async () => {
    if (!supabaseDashboard) {
      notify(
        "Supabase is not connected. The broadcast was not sent.",
        "error"
      );
      return;
    }
    if (broadcastSending) return;

    broadcastSending = true;
    const submitButton = $("broadcast-form").querySelector(
      'button[type="submit"]'
    );
    submitButton.disabled = true;

    const audience = $("bc-audience").value;
    const building = audience === "building" ? $("bc-building").value : "";
    const urgency = {
      info: "Notice",
      warning: "Warning",
      emergency: "Critical",
    }[level];
    const quickType =
      BROADCAST_TEMPLATES.find((template) => template.text === message)?.label ||
      "Custom";

    try {
      const result = await supabaseDashboard.sendBroadcast({
        message,
        quickType,
        urgency,
        audience: audience === "all" ? "everyone" : audience,
        building,
        adminName: "Admin",
      });
      const id = result.id;
      const sentAt = Date.now();
      state.broadcasts = [
        {
          id,
          message,
          audience: audienceText(),
          level,
          sentAt,
        },
        ...state.broadcasts.filter((broadcast) => broadcast.id !== id),
      ];
      logActivity(
        `${LEVEL_META[level].label} broadcast published to ${audienceText()}`,
        "success"
      );
      save();
      render();
      $("bc-message").value = "";
      updateBroadcastMeta();
      notify(`Broadcast published to Supabase for ${audienceText()}`, "success");
    } catch (error) {
      console.error("Supabase broadcast send failed.", error);
      const status = $("supabase-connection-status");
      const savedButNotDelivered = Boolean(error.persistedId);
      status.textContent = savedButNotDelivered
        ? "Broadcast saved to history, but live Realtime delivery failed."
        : "Supabase write failed. Check the project configuration and row-level security policies.";
      notify(
        savedButNotDelivered
          ? `${error.message} Retry live delivery separately; do not resend the announcement.`
          : `Broadcast could not be sent: ${error.message || "Supabase error"}`,
        "error"
      );
    } finally {
      broadcastSending = false;
      submitButton.disabled = false;
    }
  };
  if (level === "emergency") {
    confirmDialog({
      title: "Send emergency broadcast?",
      message: `Publish this message to Supabase for the mobile app to receive?\n\n${recipientsText()}:\n"${message}"`,
      confirmLabel: "Send now",
      onConfirm: () => {
        void send();
      },
    });
  } else {
    void send();
  }
}

// --- Data export ---
function exportCSV() {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = [
    "ID",
    "Type",
    "Title",
    "Location",
    "Priority",
    "Status",
    "Reported by",
    "Reported at",
    "Dispatched at",
    "Resolved at",
    "Responder",
    "Minutes to dispatch",
    "Details",
  ];
  const rows = filteredIncidents().map((a) => [
    a.id,
    TYPE_META[a.type].label,
    a.title,
    a.location,
    PRIORITY_META[a.priority].label,
    ALERT_STATUS[a.status].label,
    a.reportedBy,
    stamp(a.createdAt),
    stamp(a.dispatchedAt),
    stamp(a.resolvedAt),
    (findResponder(a.responderId) || {}).name || "",
    a.dispatchedAt ? ((a.dispatchedAt - a.createdAt) / 60000).toFixed(1) : "",
    a.note,
  ]);
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `safepateros-incidents-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`Exported ${rows.length} incidents`, "success");
}

// --- Toasts ---
function notify(message, type = "info") {
  const style = TOAST_STYLES[type] || TOAST_STYLES.info;
  const toast = document.createElement("div");
  toast.className =
    "toast card p-4 flex items-center gap-4 min-w-[280px] max-w-[90vw]";
  toast.style.borderColor = style.line;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
           <div class="w-2 h-2 rounded-full shrink-0" style="background:${style.dot}"></div>
           <p class="text-sm font-medium t-main flex-1"></p>
           <button class="icon-btn" aria-label="Dismiss notification"><i data-lucide="x" class="w-4 h-4"></i></button>`;
  toast.querySelector("p").textContent = message; // textContent = safe
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  $("toast-container").appendChild(toast);
  icons();
  setTimeout(() => toast.remove(), 5000);
}

/* ---------- 8. DIALOGS ---------- */
let lastFocused = null,
  modalToken = 0;
let pendingConfirmResolve = null;
const modalOpen = () => !$("modal-overlay").classList.contains("hidden");

// actions: [{ label, kind: 'primary' | 'ok' | undefined, onClick }]
// onClick may return false to keep the dialog open (e.g. when a form is invalid).
function openModal({
  title,
  subtitle = "",
  icon = "info",
  tone = "muted",
  body = "",
  actions = [],
}) {
  if (!modalOpen()) lastFocused = document.activeElement;
  const token = ++modalToken;

  $("modal-title").textContent = title;
  $("modal-sub").textContent = subtitle;
  // Rebuild the icon each time (Lucide replaces <i> tags with <svg>, so it can't be re-pointed)
  $("modal-icon-wrap").className = `tile-icon tint-${tone}`;
  $(
    "modal-icon-wrap"
  ).innerHTML = `<i data-lucide="${icon}" class="w-6 h-6"></i>`;
  $("modal-body").innerHTML = body;

  const bar = $("modal-actions");
  bar.innerHTML = "";
  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${
      a.kind === "primary" ? "btn-primary" : a.kind === "ok" ? "btn-ok" : ""
    }`;
    btn.style.flex = "1 1 auto";
    btn.style.padding = "0.7rem 1rem";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      const result = a.onClick ? a.onClick() : undefined;
      if (result !== false && token === modalToken) closeModal();
    });
    bar.appendChild(btn);
  });

  const form = $("modal-form");
  if (form)
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = bar.querySelector(".btn-primary");
      if (p) p.click();
    });

  $("modal-overlay").classList.remove("hidden");
  icons();
  const first = $("modal-body").querySelector("input, select, textarea");
  (first || $("modal-close")).focus();
}

function closeModal() {
  if (pendingConfirmResolve) {
    const resolve = pendingConfirmResolve;
    pendingConfirmResolve = null;
    resolve(false);
  }
  $("modal-overlay").classList.add("hidden");
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}

function confirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
}) {
  openModal({
    title,
    icon: "alert-circle",
    tone: "warn",
    body: `<p class="text-sm t-main whitespace-pre-line">${esc(message)}</p>`,
    actions: [
      {
        label: confirmLabel,
        kind: "primary",
        onClick: () => {
          onConfirm();
        },
      },
      { label: "Cancel" },
    ],
  });
}

window.safepaterosConfirm = ({ title, message, confirmLabel = "Confirm" }) =>
  new Promise((resolve) => {
    pendingConfirmResolve = resolve;
    openModal({
      title,
      icon: "alert-circle",
      tone: "warn",
      body: `<p class="text-sm t-main whitespace-pre-line">${esc(message)}</p>`,
      actions: [
        {
          label: confirmLabel,
          kind: "primary",
          onClick: () => {
            const finish = pendingConfirmResolve;
            pendingConfirmResolve = null;
            finish?.(true);
          },
        },
        {
          label: "Cancel",
          onClick: () => {
            const finish = pendingConfirmResolve;
            pendingConfirmResolve = null;
            finish?.(false);
          },
        },
      ],
    });
  });

const detailRows = (rows) =>
  `<dl class="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">${rows
    .filter(Boolean)
    .map(
      ([k, v]) =>
        `<dt class="t-muted">${k}</dt><dd class="col-span-2 t-main">${v}</dd>`
    )
    .join("")}</dl>`;
const linkOut = (href, text) =>
  `<a href="${esc(
    href
  )}" target="_blank" rel="noopener" class="t-info font-semibold hover:underline">${text}</a>`;

function openFor(kind, id) {
  if (kind === "alert") openAlertModal(id);
  else if (kind === "emergency-responder") openAlertModal(id);
  else if (kind === "facility") openFacilityModal(id);
  else if (kind === "school") centerOnSchool();
  else if (kind === "user" && selectedUserMapLocation) {
    const user = selectedUserMapLocation;
    openModal({
      title: user.name,
      subtitle: user.online ? "Online" : "Offline — showing last known location",
      icon: "map-pin",
      tone: "info",
      body: `<p class="text-sm t-main">${user.updatedAt ? `Location updated ${esc(fmtDateTime(user.updatedAt))}` : "Location update time unavailable."}</p><p class="text-sm t-muted mt-2">${user.lat.toFixed(6)}, ${user.lng.toFixed(6)}</p>`,
      actions: [{ label: "Close" }],
    });
  }
  else openResponderModal(id);
}

function openFacilityModal(id) {
  const f = facilities.find((x) => x.id === id);
  if (!f) return;
  const t = FACILITY_TYPES[f.type];
  const c = state.campus.center;
  const body =
    detailRows([
      ["Type", badge(t.badge, t.label)],
      f.address && ["Address", esc(f.address)],
      ["From campus", `${fmtDistance(f.dist)} away`],
    ]) +
    `<p class="text-sm flex flex-wrap gap-x-5 gap-y-1">
      ${linkOut(`https://www.mapbox.com/directions/?origin=${c.lng},${c.lat}&destination=${f.lng},${f.lat}&profile=mapbox/driving`, "Directions from campus")}
    </p>`;
  openModal({
    title: f.name,
    subtitle: t.label,
    icon: t.icon,
    tone: t.tone,
    body,
    actions: [
      { label: "Show on map", onClick: () => { locateOn("facility", f.id); } },
      { label: "Close" },
    ],
  });
}

// For a medical alert, the closest hospital; for fire, the closest fire station; for security, the closest police station
function nearbyServiceRow(a) {
  const type = { medical: "hospital", fire: "fire_station", security: "police" }[a.type];
  const hit = type && nearestFacility(type, a);
  return hit && [`Nearest ${FACILITY_TYPES[type].label.toLowerCase()}`, `${esc(hit.f.name)} (${fmtDistance(hit.d)})`];
}

function openAlertModal(id) {
  const a = findAlert(id);
  if (!a) return;
  const t = TYPE_META[a.type] || TYPE_META.other;
  const s = ALERT_STATUS[a.status];
  const resp = a.supabaseRequest ? null : findResponder(a.responderId);
  const supabaseResponder = a.supabaseRequest ? a.responderInfo : null;
  const d = resp && hasPos(resp) && hasPos(a) ? distanceM(resp, a) : null;

  const body =
    detailRows([
      ["Status", badge(s.badge, s.label)],
      [
        "Priority",
        badge(PRIORITY_META[a.priority].badge, PRIORITY_META[a.priority].label),
      ],
      ["Type / category", a.status === "false_alarm" ? "False Alarm" : t.label],
      ["Location", esc(a.location)],
      ["Reporter role / category", esc(a.userRole || "Not provided")],
      [
        "Reporter phone",
        a.userPhone
          ? `<a href="${telHref(a.userPhone)}" class="t-info font-semibold hover:underline">${esc(a.userPhone)}</a>`
          : "Not provided",
      ],
      nearbyServiceRow(a),
      ["Reported", `${fmtDateTime(a.createdAt)} (${fmtAgo(a.createdAt)})`],
      ["Reported by", esc(a.reportedBy)],
      (a.supabaseRequest || a.supabaseAlert || a.supabaseIncident) && ["User ID", esc(a.userId || "Not provided")],
      (a.supabaseRequest || a.supabaseAlert || a.supabaseIncident) &&
        hasPos(a) && [
          "Precise coordinates",
          `${a.lat.toFixed(6)}, ${a.lng.toFixed(6)}`,
        ],
      ["What happened", esc(a.note || "No details provided.")],
      supabaseResponder &&
        supabaseResponder.name && [
          "Responder",
          `${esc(supabaseResponder.name)} (${esc(
            supabaseResponder.unit || "Unit not provided"
          )})<br>${
            supabaseResponder.phone
              ? `<a href="${telHref(
                  supabaseResponder.phone
                )}" class="t-info font-semibold hover:underline">${esc(
                  supabaseResponder.phone
                )}</a>`
              : "No contact number provided"
          }`,
        ],
      a.supabaseRequest &&
        hasPos(a.responderLocation) && [
          "Responder GPS",
          `${a.responderLocation.lat.toFixed(6)}, ${a.responderLocation.lng.toFixed(6)}`,
        ],
      resp && [
        "Responder",
        `${esc(resp.name)}, ${esc(resp.role)}<br><a href="${telHref(
          resp.phone
        )}" class="t-info font-semibold hover:underline">${esc(
          resp.phone
        )}</a>`,
      ],
      resp &&
        a.status === "responding" &&
        d != null && [
          "Distance",
          `${fmtDistance(d)}, about ${etaMin(d)} min on foot`,
        ],
      a.dispatchedAt && [
        "Dispatched",
        `${fmtDateTime(a.dispatchedAt)} (${fmtDuration(
          a.dispatchedAt - a.createdAt
        )} after the alert)`,
      ],
      a.resolvedAt && ["Closed", fmtDateTime(a.resolvedAt)],
    ]) +
    (hasPos(a)
      ? `<p class="text-sm flex flex-wrap gap-x-5 gap-y-1">
           ${linkOut(mapsLink(a), "Open in Google Maps")}
           ${
             resp && hasPos(resp) && a.status === "responding"
               ? linkOut(
                   directionsLink(resp, a),
                   `Walking directions for ${esc(resp.name)}`
                 )
               : ""
           }</p>`
      : "");

  const actions = [];
  if (a.supabaseRequest && a.status === "unassigned") {
    actions.push({
      label: "Dispatch nearest",
      kind: "primary",
      onClick: () => dispatchAlert(a.id),
    });
    actions.push({
      label: "Choose responder",
      onClick: () => openAssignModal(a.id),
    });
    actions.push({
      label: "Reject / cancel",
      onClick: () => rejectEmergencyRequest(a.supabaseRecordId),
    });
  } else if (a.supabaseRequest && a.status === "responding") {
    actions.push({
      label: "Mark resolved",
      kind: "ok",
      onClick: () => resolveEmergencyRequest(a.supabaseRecordId),
    });
    actions.push({
      label: emergencyLocationWatchers.has(a.supabaseRecordId)
        ? "Stop sharing location"
        : "Share my live location",
      onClick: () =>
        emergencyLocationWatchers.has(a.supabaseRecordId)
          ? stopEmergencyLocationSharing(a.supabaseRecordId)
          : startEmergencyLocationSharing(a.supabaseRecordId),
    });
  } else if ((a.supabaseAlert || a.supabaseIncident) && a.status === "unassigned") {
    actions.push({
      label: "Dispatch nearest",
      kind: "primary",
      onClick: () => dispatchAlert(a.id),
    });
    actions.push({
      label: "Choose responder",
      onClick: () => openAssignModal(a.id),
    });
  } else if (!a.supabaseAlert && !a.supabaseIncident && !a.supabaseRequest && a.status === "unassigned") {
    actions.push({
      label: "Dispatch nearest",
      kind: "primary",
      onClick: () => {
        dispatchAlert(a.id);
      },
    });
    actions.push({
      label: "Choose responder",
      onClick: () => {
        openAssignModal(a.id);
      },
    });
  }
  if (!a.supabaseAlert && !a.supabaseIncident && !a.supabaseRequest && a.status === "responding")
    actions.push({
      label: "Mark resolved",
      kind: "ok",
      onClick: () => {
        closeAlert(a.id, "resolved");
      },
    });
  if (!a.supabaseAlert && !a.supabaseIncident && !a.supabaseRequest && isActive(a))
    actions.push({
      label: "False alarm",
      onClick: () => {
        closeAlert(a.id, "false_alarm");
      },
    });
  if ((a.supabaseAlert || a.supabaseIncident) && isActive(a)) {
    actions.push({
      label: "Cancel SOS",
      onClick: () => cancelSupabaseSOS(a.id),
    });
  }
  if ((a.supabaseAlert || a.supabaseIncident) && a.status !== "false_alarm") {
    actions.push({
      label: "Classify as False Alarm",
      onClick: () => classifySupabaseSOS(a.id),
    });
  }
  if (hasPos(a) && isActive(a))
    actions.push({
      label: "Show on map",
      onClick: () => {
        locateOn("alert", a.id);
      },
    });
  actions.push({ label: "Close" });

  openModal({
    title: a.title,
    subtitle: `${a.id}, ${t.label}`,
    icon: t.icon,
    tone: t.tone,
    body,
    actions,
  });
}

function openAssignModal(alertId) {
  const a = findAlert(alertId);
  if (!a || a.status !== "unassigned") return;
  const list = availableByDistance(a);
  const body = list.length
    ? `<fieldset class="space-y-2"><legend class="field-label">Available responders, closest first</legend>
           ${list
             .map(
               ({ r, dist }, i) => `
           <label class="flex items-center gap-3 p-3 rounded-xl border line surface-2 cursor-pointer">
               <input type="radio" name="assign-resp" value="${esc(r.id)}" ${
                 i === 0 ? "checked" : ""
               } />
               <span class="flex-1"><span class="font-semibold t-main block">${esc(
                 r.name
               )}</span>
               <span class="text-xs t-muted">${esc(r.role)}, ${esc(
                 r.location
               )}</span></span>
               <span class="text-sm t-main text-right">${
                 dist != null
                   ? `${fmtDistance(
                       dist
                     )}<br><span class="text-xs t-muted">about ${etaMin(
                       dist
                     )} min</span>`
                   : '<span class="t-muted">Distance unknown</span>'
               }</span>
           </label>`
             )
             .join("")}</fieldset>`
    : '<p class="text-sm t-muted">Nobody is available right now. Put a responder on duty or wait for a team to finish.</p>';

  openModal({
    title: `Choose responder for ${a.id}`,
    subtitle: a.location,
    icon: "users",
    tone: "info",
    body,
    actions: list.length
      ? [
          {
            label: "Dispatch selected",
            kind: "primary",
            onClick: () => {
              const pick = document.querySelector(
                'input[name="assign-resp"]:checked'
              );
              if (!pick) return false;
              const responder = findResponder(pick.value);
              if (!responder || !isResponderAvailableForAssignment(responder)) {
                notify("This responder is no longer available for assignment.", "error");
                return false;
              }
              if (a.supabaseRequest) {
                void commitEmergencyAcceptance(a.supabaseRecordId, {
                  name: responder.name,
                  phone: responder.phone,
                  unit: responder.id,
                });
                return false;
              }
              dispatchAlert(a.id, pick.value);
            },
          },
          { label: "Cancel" },
        ]
      : [{ label: "Close" }],
  });
}

function openResponderModal(id) {
  const r = findResponder(id);
  if (!r) return;
  const st = RESPONDER_STATUS[r.status];
  const inc = alertOf(r);
  const handled = state.alerts.filter((a) => a.responderId === r.id).length;
  const waiting = state.alerts.some((a) => a.status === "unassigned");

  const body =
    detailRows([
      ["Status", badge(st.badge, st.label)],
      ["Specialization", esc(r.role)],
      [
        "Mobile",
        `<a href="${telHref(
          r.phone
        )}" class="t-info font-semibold hover:underline">${esc(r.phone)}</a>`,
      ],
      ["Location", esc(r.location)],
      inc && [
        "Handling",
        `${esc(inc.id)}, ${esc(inc.title)} at ${esc(inc.location)}`,
      ],
      ["Incidents handled", String(handled)],
    ]) +
    (hasPos(r)
      ? `<p class="text-sm">${linkOut(
          mapsLink(r),
          "Open position in Google Maps"
        )}</p>`
      : "");

  const actions = [];
  if (r.status === "available" && waiting)
    actions.push({
      label: "Dispatch",
      kind: "primary",
      onClick: () => {
        dispatchResponder(r.id);
      },
    });
  if (inc)
    actions.push({
      label: "Mark resolved",
      kind: "ok",
      onClick: () => {
        closeAlert(inc.id, "resolved");
      },
    });
  if (hasPos(r))
    actions.push({
      label: "Show on map",
      onClick: () => {
        locateOn("responder", r.id);
      },
    });
  actions.push({
    label: "Edit",
    onClick: () => {
      openResponderForm(r.id);
    },
  });
  actions.push({ label: "Close" });

  openModal({
    title: r.name,
    subtitle: r.id,
    icon: "shield",
    tone: "info",
    body,
    actions,
  });
}

function openResponderForm(id = null) {
  const r = id ? findResponder(id) : null;
  const busy = !!r && r.status === "responding";
  const roles = [
    "Medical / EMT",
    "Security / SAR",
    "First aid / Nurse",
    "Fire safety",
  ];
  const body = `
       <form id="modal-form" class="space-y-4">
           <div><label class="field-label" for="f-name">Full name</label>
               <input id="f-name" class="input" required maxlength="40" autocomplete="off" value="${esc(
                 r ? r.name : ""
               )}" /></div>
           <div><label class="field-label" for="f-phone">Mobile number</label>
               <input id="f-phone" type="tel" class="input" required maxlength="20" placeholder="+63 9xx xxx xxxx" value="${esc(
                 r ? r.phone : ""
               )}" /></div>
           <div><label class="field-label" for="f-role">Specialization</label>
               <input id="f-role" class="input" list="role-list" required maxlength="40" value="${esc(
                 r ? r.role : ""
               )}" />
               <datalist id="role-list">${roles
                 .map((x) => `<option value="${esc(x)}"></option>`)
                 .join("")}</datalist></div>
           <div><label class="field-label" for="f-loc">Base location</label>
               <select id="f-loc" class="input" ${busy ? "disabled" : ""}>
                   ${r ? '<option value="">Keep current location</option>' : ""}
                   ${CAMPUS_LOCATIONS.map(
                     (l) =>
                       `<option value="${esc(l.name)}">${esc(l.name)}</option>`
                   ).join("")}
               </select>
               ${
                 busy
                   ? '<p class="field-hint">Location updates automatically while this responder is on an incident.</p>'
                   : ""
               }</div>
       </form>`;

  const actions = [
    {
      label: r ? "Save changes" : "Add responder",
      kind: "primary",
      onClick: () => {
        if (!$("modal-form").reportValidity()) return false;
        const name = $("f-name").value.trim(),
          phone = $("f-phone").value.trim(),
          role = $("f-role").value.trim();
        if (!/^[0-9+()\s-]{7,20}$/.test(phone)) {
          notify("Enter a valid mobile number", "error");
          $("f-phone").focus();
          return false;
        }
        const loc = locByName($("f-loc").value);

        if (r) {
          Object.assign(r, { name, initials: initialsOf(name), phone, role });
          if (loc && !busy)
            Object.assign(r, {
              location: loc.name,
              lat: loc.lat,
              lng: loc.lng,
            });
          logActivity(`${name}'s details were updated`, "info");
          notify(`${name} updated`, "success");
        } else {
          const base = loc || CAMPUS_LOCATIONS[0];
          state.responders.push({
            id: nextId("RES", state.responders),
            name,
            initials: initialsOf(name),
            phone,
            role,
            status: "available",
            location: base.name,
            lat: base.lat,
            lng: base.lng,
          });
          logActivity(`${name} added to the response team`, "success");
          notify(`${name} added to the team`, "success");
        }
        save();
        render();
      },
    },
  ];
  if (r && !r.staffUser)
    actions.push({
      label: "Remove",
      onClick: () => {
        confirmDialog({
          title: `Remove ${r.name}?`,
          message:
            "This removes the responder from the team. Past incidents keep their record.",
          confirmLabel: "Remove responder",
          onConfirm: () => deleteResponder(r.id),
        });
      },
    });
  actions.push({ label: "Cancel" });

  openModal({
    title: r ? `Edit ${r.name}` : "Add responder",
    subtitle: r ? r.id : "New team member",
    icon: r ? "pencil" : "user-plus",
    tone: "info",
    body,
    actions,
  });
}

function openIncidentForm() {
  const body = `
       <form id="modal-form" class="space-y-4">
           <div class="grid grid-cols-2 gap-4">
               <div><label class="field-label" for="f-type">Type</label>
                   <select id="f-type" class="input">${Object.entries(TYPE_META)
                     .map(
                       ([k, t]) => `<option value="${k}">${t.label}</option>`
                     )
                     .join("")}</select></div>
               <div><label class="field-label" for="f-priority">Priority</label>
                   <select id="f-priority" class="input">${Object.entries(
                     PRIORITY_META
                   )
                     .map(
                       ([k, p]) =>
                         `<option value="${k}" ${
                           k === "critical" ? "selected" : ""
                         }>${p.label}</option>`
                     )
                     .join("")}</select></div>
           </div>
           <div><label class="field-label" for="f-building">Building</label>
               <select id="f-building" class="input">${CAMPUS_LOCATIONS.map(
                 (l) => `<option value="${esc(l.name)}">${esc(l.name)}</option>`
               ).join("")}</select></div>
           <div><label class="field-label" for="f-room">Room or floor (optional)</label>
               <input id="f-room" class="input" maxlength="60" placeholder="e.g. Room 402" autocomplete="off" /></div>
           <div><label class="field-label" for="f-note">What happened?</label>
               <textarea id="f-note" class="input" required maxlength="300" placeholder="Who needs help and what is the situation?"></textarea></div>
       </form>`;

  openModal({
    title: "Log incident",
    subtitle: "Add an incident reported by phone or in person",
    icon: "siren",
    tone: "danger",
    body,
    actions: [
      {
        label: "Log incident",
        kind: "primary",
        onClick: () => {
          if (!$("modal-form").reportValidity()) return false;
          const building = locByName($("f-building").value);
          const room = $("f-room").value.trim();
          const jitter = () => (Math.random() - 0.5) * 0.00008; // keeps pins in one building from stacking exactly
          receiveAlert(
            {
              type: $("f-type").value,
              priority: $("f-priority").value,
              location: room ? `${building.name}, ${room}` : building.name,
              lat: building.lat + jitter(),
              lng: building.lng + jitter(),
              note: $("f-note").value.trim(),
              reportedBy: "Admin (manual)",
            },
            { manual: true }
          );
        },
      },
      { label: "Cancel" },
    ],
  });
  $("f-type").addEventListener("change", (e) => {
    $("f-priority").value = PRIORITY_DEFAULT[e.target.value];
  });
  $("f-priority").value = PRIORITY_DEFAULT[$("f-type").value];
}

function locateOn(kind, id) {
  const item =
    kind === "alert"
      ? findAlert(id)
      : kind === "emergency-responder"
      ? findAlert(id)?.responderLocation
      : kind === "facility"
      ? facilities.find((f) => f.id === id)
      : findResponder(id);
  if (!item) return;
  navigate("map");
  setTimeout(() => focusOn(item), 250);
}

/* ---------- 9. VIEWS + ROUTING ---------- */
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("mobile-overlay").classList.add("hidden");
}
function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("mobile-overlay").classList.toggle(
    "hidden",
    !$("sidebar").classList.contains("open")
  );
}

function markAllRead() {
  if (state.activity.some((n) => !n.read)) {
    state.activity.forEach((n) => {
      n.read = true;
    });
    save();
    renderNotifications();
  }
}
function toggleNotifications(force) {
  const panel = $("notif-panel");
  const open = typeof force === "boolean" ? force : panel.hidden;
  if (open === !panel.hidden) return;
  panel.hidden = !open;
  $("notif-btn").setAttribute("aria-expanded", String(open));
  if (open) renderNotifications();
  else markAllRead();
}

let broadcastReady = false;
function initBroadcast() {
  if (!broadcastReady) {
    $("bc-templates").innerHTML = BROADCAST_TEMPLATES.map(
      (t) =>
        `<button type="button" class="chip" data-action="bc-template" data-key="${
          t.key
        }">${esc(t.label)}</button>`
    ).join("");
    $("bc-building").innerHTML = CAMPUS_LOCATIONS.map(
      (l) => `<option value="${esc(l.name)}">${esc(l.name)}</option>`
    ).join("");
    broadcastReady = true;
  }
  updateBroadcastMeta();
}

// Moves the school and everything placed around it (buildings, responders, incidents)
function setCampusCenter(center) {
  const dLat = center.lat - state.campus.center.lat,
    dLng = center.lng - state.campus.center.lng;
  shiftPositions(state, dLat, dLng);
  state.campus.center = { ...center };
  rebuildLocations(center);
}

function fillSettings() {
  $("set-name").value = state.campus.name;
  $("set-lat").value = state.campus.center.lat;
  $("set-lng").value = state.campus.center.lng;
  $("set-zoom").value = state.campus.zoom;
  $("set-radius").value = state.campus.facilityRadiusKm;
  $("set-sound").checked = !!state.settings.sound;
  updateMapsStatus();
}

function showView(name) {
  currentView = name;
  document.querySelectorAll("#view-scroll > [data-view]").forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
  document.querySelectorAll("[data-nav]").forEach((l) => {
    if (l.dataset.nav === name) l.setAttribute("aria-current", "page");
    else l.removeAttribute("aria-current");
  });
  $("view-title").textContent = VIEWS[name].title;
  $("view-sub").textContent = VIEWS[name].sub;
  document.title = `${VIEWS[name].title} — SafePateros`;
  $("view-scroll").scrollTop = 0;

  if (name === "dashboard") mountMap("map-slot-dashboard");
  if (name === "map") mountMap("map-slot-live");
  if (name === "reports") renderReports();
  if (name === "settings") fillSettings();
  if (name === "broadcast") initBroadcast();

  closeSidebar();
  toggleNotifications(false);
  icons();
}

function route() {
  const name = location.hash.replace(/^#\/?/, "") || "dashboard";
  showView(VIEWS[name] ? name : "dashboard");
}
function navigate(name) {
  if (location.hash === `#/${name}`) route();
  else location.hash = `#/${name}`;
}

// Lighter re-render used while typing in filters (does not touch the map)
function renderLists() {
  renderAlertsFull();
  renderIncidents();
  renderRespondersFull();
  icons();
}

async function refreshDashboardData() {
  const buttons = [...document.querySelectorAll('[data-action="refresh-data"]')];
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  try {
    if (typeof supabaseDashboard?.refreshDashboardData !== "function") {
      throw new Error("Supabase refresh is not available yet.");
    }
    const snapshot = await supabaseDashboard.refreshDashboardData();
    supabaseEmergencyRequests = snapshot.emergencyRequests.map(
      formatEmergencyRequestFromSupabase
    );
    supabaseAlertRecords = snapshot.alerts;
    supabaseIncidentRecords = snapshot.incidents;
    previousEmergencyRequestIds = new Set(
      snapshot.emergencyRequests.map((record) => String(record.id))
    );
    previousAlertRecordIds = new Set(
      snapshot.alerts.map((record) => String(record.id))
    );
    previousIncidentIds = new Set(
      snapshot.incidents.map((record) => String(record.id))
    );
    window.dispatchEvent(new CustomEvent("safepateros:emergency-requests-updated", {
      detail: snapshot.emergencyRequests,
    }));
    window.dispatchEvent(new CustomEvent("safepateros:alerts-updated", {
      detail: snapshot.alerts,
    }));
    window.dispatchEvent(new CustomEvent("safepateros:sos-records-refreshed", {
      detail: snapshot.sosRecords,
    }));
    syncSupabaseAlerts({ renderDashboard: false });
    render();
    notify("Dashboard data refreshed from Supabase.", "success");
  } catch (error) {
    console.error("Dashboard data could not be refreshed.", error);
    notify(`Could not refresh dashboard data: ${error.message || "Supabase error"}`, "error");
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
  }
}

/* ---------- 10. EVENT HANDLING ---------- */
// One click listener for the whole page. Buttons declare what they do with data-action.
const actions = {
  nav: (el) => navigate(el.dataset.view),
  "toggle-sidebar": () => toggleSidebar(),
  "zoom-in": () => zoomMap(1),
  "zoom-out": () => zoomMap(-1),
  "map-fit": () => fitMap(),
  "map-center": () => centerOnSchool(),
  "refresh-data": () => refreshDashboardData(),
  "toggle-layer": (el) => {
    ui.layers[el.dataset.layer] = !ui.layers[el.dataset.layer];
    document
      .querySelectorAll(
        `[data-action="toggle-layer"][data-layer="${el.dataset.layer}"]`
      )
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(ui.layers[el.dataset.layer]))
      );
    renderMap();
  },
  "set-filter": (el) => {
    ui[el.dataset.key] = el.dataset.value;
    renderLists();
  },
  "new-incident": () => openIncidentForm(),
  "dispatch-alert": (el) => dispatchAlert(el.dataset.id),
  "assign-alert": (el) => openAssignModal(el.dataset.id),
  "resolve-emergency": (el) => resolveEmergencyRequest(el.dataset.id),
  "cancel-sos": (el) => cancelSupabaseSOS(el.dataset.id),
  "start-emergency-location": (el) =>
    startEmergencyLocationSharing(el.dataset.id),
  "stop-emergency-location": (el) =>
    stopEmergencyLocationSharing(el.dataset.id),
  "resolve-alert": (el) => closeAlert(el.dataset.id, "resolved"),
  "alert-details": (el) => openAlertModal(el.dataset.id),
  "dispatch-responder": (el) => dispatchResponder(el.dataset.id),
  "responder-details": (el) => openResponderModal(el.dataset.id),
  "add-responder": () => openResponderForm(),
  "edit-responder": (el) => openResponderForm(el.dataset.id),
  "toggle-duty": (el) => toggleDuty(el.dataset.id),
  locate: (el) => locateOn(el.dataset.kind, el.dataset.id),
  focus: (el) => {
    const item =
      el.dataset.kind === "alert"
        ? findAlert(el.dataset.id)
        : el.dataset.kind === "emergency-responder"
        ? findAlert(el.dataset.id)?.responderLocation
        : findResponder(el.dataset.id);
    if (mapMode === "mapbox" && hasPos(item)) focusOn(item);
    else openFor(el.dataset.kind, el.dataset.id);
  },
  marker: (el) => openFor(el.dataset.kind, el.dataset.id),
  "export-csv": () => exportCSV(),
  "toggle-notifications": () => toggleNotifications(),
  "clear-notifications": () => {
    state.activity = [];
    save();
    renderNotifications();
  },
  "bc-template": (el) => {
    const t = BROADCAST_TEMPLATES.find((x) => x.key === el.dataset.key);
    if (!t) return;
    $("bc-message").value = t.text;
    $("bc-level").value = t.level;
    updateBroadcastMeta();
    $("bc-message").focus();
  },
  logout: async () => {
    if (!supabaseDashboard || typeof supabaseDashboard.signOut !== "function") {
      notify("Supabase authentication is not ready. Please try again.", "error");
      return;
    }
    try {
      await supabaseDashboard.signOut();
      sessionStorage.removeItem("safepateros-admin-welcome");
      window.location.replace("login.html");
    } catch (error) {
      console.error("Supabase sign-out failed.", error);
      notify(
        `Could not sign out: ${error.message || "Supabase authentication error"}`,
        "error"
      );
    }
  },
  "reset-data": () =>
    confirmDialog({
      title: "Reset demo data?",
      message:
        "All incidents, responders and broadcasts go back to the sample data. Your map settings are kept.",
      confirmLabel: "Reset data",
      onConfirm: () => {
        const fresh = seedState(state.campus.center);
        fresh.settings = { ...state.settings };
        fresh.campus.customCenter = state.campus.customCenter;
        fresh.campus.facilityRadiusKm = state.campus.facilityRadiusKm;
        fresh.campus.activeUsers = state.campus.activeUsers;
        Object.keys(state).forEach((k) => delete state[k]);
        Object.assign(state, fresh);
        syncRegisteredStaff(registeredStaffProfiles);
        save();
        render();
        notify("Demo data restored", "success");
      },
    }),
  "close-modal": () => closeModal(),
};

document.addEventListener("click", (event) => {
  if (event.target.closest(".nav-link")) closeSidebar();
  if (
    !$("notif-panel").hidden &&
    !event.target.closest("#notif-panel, #notif-btn")
  )
    toggleNotifications(false);

  const el = event.target.closest("[data-action]");
  if (!el) return;

  // Clicking the dark backdrop closes the modal; clicking inside the dialog does not
  if (el.dataset.action === "close-modal-backdrop") {
    if (event.target === el) closeModal();
    return;
  }
  const handler = actions[el.dataset.action];
  if (handler) handler(el);
});

// Search boxes and filter dropdowns
function onFieldChange(event) {
  const el = event.target;
  if (event.type === "change" && el.matches("[data-incident-category]")) {
    const categories = Object.keys(TYPE_META);
    if (el.dataset.incidentCategory === "all") {
      ui.incTypes = el.checked ? categories : [];
    } else if (el.checked) {
      ui.incTypes = [...new Set([...ui.incTypes, el.dataset.incidentCategory])];
    } else {
      ui.incTypes = ui.incTypes.filter(
        (category) => category !== el.dataset.incidentCategory
      );
    }
    const selectAll = document.querySelector('[data-incident-category="all"]');
    selectAll.checked = ui.incTypes.length === categories.length;
    document.querySelectorAll("[data-incident-category]").forEach((checkbox) => {
      if (checkbox.dataset.incidentCategory !== "all") {
        checkbox.checked = ui.incTypes.includes(checkbox.dataset.incidentCategory);
      }
    });
    renderLists();
    return;
  }
  if (event.type === "change" && el.matches("[data-responder-status]")) {
    setResponderStatus(el.dataset.id, el.value);
    return;
  }
  if (el.dataset && el.dataset.bind) {
    ui[el.dataset.bind] = el.value;
    renderLists();
  }
  if (
    el.id === "bc-message" ||
    el.id === "bc-audience" ||
    el.id === "bc-building"
  )
    updateBroadcastMeta();
  if (el.id === "set-sound") {
    state.settings.sound = el.checked;
    save();
  }
}
document.addEventListener("input", onFieldChange);
document.addEventListener("change", onFieldChange);

document.addEventListener("submit", (event) => {
  const id = event.target.id;
  if (id === "broadcast-form") {
    event.preventDefault();
    sendBroadcast();
  }

  if (id === "campus-form") {
    event.preventDefault();
    const lat = parseFloat($("set-lat").value),
      lng = parseFloat($("set-lng").value);
    const zoom = parseInt($("set-zoom").value, 10);
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      return notify(
        "Enter a valid latitude (-90 to 90) and longitude (-180 to 180)",
        "error"
      );
    }
    const radius = parseFloat($("set-radius").value);
    const oldCenter = state.campus.center,
      oldRadius = state.campus.facilityRadiusKm;
    const moved = Math.abs(lat - oldCenter.lat) > 1e-7 || Math.abs(lng - oldCenter.lng) > 1e-7;
    setCampusCenter({ lat, lng }); // buildings, responders and incidents move with the school
    state.campus = {
      ...state.campus,
      name: $("set-name").value.trim() || state.campus.name,
      zoom: clamp(Number.isFinite(zoom) ? zoom : 18, 1, 21),
      facilityRadiusKm: clamp(Number.isFinite(radius) ? radius : 3, 0.5, 10),
      customCenter:
        Math.abs(lat - DEFAULT_CAMPUS_CENTER.lat) > 1e-7 ||
        Math.abs(lng - DEFAULT_CAMPUS_CENTER.lng) > 1e-7,
    };
    save();
    if (mapMode === "mapbox" && mapboxMap) {
      mapboxMap.flyTo({
        center: [state.campus.center.lng, state.campus.center.lat],
        zoom: state.campus.zoom,
      });
      if (moved || oldRadius !== state.campus.facilityRadiusKm) {
        facilitiesState = "idle"; // look for services around the new spot
        facilities = [];
        gFitted = false;
        loadFacilities();
      }
    }
    render();
    notify("Campus settings saved", "success");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (modalOpen()) closeModal();
    else if (!$("notif-panel").hidden) toggleNotifications(false);
    else closeSidebar();
  }
  // Keep keyboard focus inside an open dialog
  if (event.key === "Tab" && modalOpen()) {
    const focusable = [
      ...$("modal-overlay").querySelectorAll(
        "button, [href], input, select, textarea"
      ),
    ].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => {
  if (!navigator.geolocation) return;
  emergencyLocationWatchers.forEach((watchId) =>
    navigator.geolocation.clearWatch(watchId)
  );
});
window.addEventListener("safepateros:supabase-ready", (event) => {
  supabaseDashboard = event.detail;

  $("supabase-connection-status").textContent =
    "Supabase initialized; checking database connection…";

  if (typeof supabaseDashboard.subscribeToEmergencyRequests === "function") {
    supabaseDashboard.subscribeToEmergencyRequests(
      (requests) => {
        supabaseEmergencyRequests = requests.map(formatEmergencyRequestFromSupabase);
        const changes = collectNewPendingRecords(
          supabaseEmergencyRequests,
          previousEmergencyRequestIds,
          (request) => request.status
        );
        previousEmergencyRequestIds = changes.currentIds;
        const newAlerts = changes.inserted.map(({ alert }) => alert);
        window.dispatchEvent(new CustomEvent("safepateros:emergency-requests-updated", {
          detail: requests,
        }));
        syncSupabaseAlerts();
        handleRealtimeSOS(newAlerts);
      },
      (error) => {
        console.error("Supabase emergency request subscription failed.", error);
        $("supabase-connection-status").textContent =
          "Could not read SOS requests from Supabase. Check row-level security policies.";
        notify(
          `Could not load mobile SOS requests: ${error.message || "Supabase error"}`,
          "error"
        );
      }
    );
  }

  if (typeof supabaseDashboard.subscribeToAlerts === "function") {
    supabaseDashboard.subscribeToAlerts(
      (records) => {
        supabaseAlertRecords = records;
        const changes = collectNewPendingRecords(
          records,
          previousAlertRecordIds,
          (record) => record.status
        );
        previousAlertRecordIds = changes.currentIds;
        const newAlerts = changes.inserted
          .map(formatAlertFromSupabase)
          .filter((alert) => alert.status === "unassigned");
        window.dispatchEvent(new CustomEvent("safepateros:alerts-updated", {
          detail: records,
        }));
        syncSupabaseAlerts();
        handleRealtimeSOS(newAlerts, { notifyUser: false });
      },
      (error) => {
        console.error("Supabase SOS alert subscription failed.", error);
        $("supabase-connection-status").textContent =
          "Could not read SOS alerts from Supabase. Check row-level security policies.";
        notify(
          `Could not load SOS alert locations: ${error.message || "Supabase error"}`,
          "error"
        );
      }
    );
  }

  if (typeof supabaseDashboard.subscribeToIncidents === "function") {
    supabaseDashboard.subscribeToIncidents(
      (records) => {
        const changes = collectNewActiveIncidents(records, previousIncidentIds);
        previousIncidentIds = changes.currentIds;
        supabaseIncidentRecords = records;
        syncSupabaseAlerts();

        const newIncidents = changes.inserted
          .map(formatIncidentFromSupabase)
          .filter((incident) => incident.status === "unassigned");
        newIncidents.forEach((incident) => {
          if (!hasPos(incident)) {
            console.warn("Realtime incident has invalid coordinates.", incident);
            return;
          }
          const reportedAt = incident.createdAt
            ? new Date(incident.createdAt).toLocaleTimeString()
            : new Date().toLocaleTimeString();
          updateMapPin(
            incident.supabaseRecordId,
            incident.lng,
            incident.lat,
            incident.userRole,
            {
              title: incident.title,
              name: incident.userName,
              userId: incident.userId,
              createdAt: new Date(incident.createdAt).toISOString(),
              time: reportedAt,
            }
          );
          flyToLocation(incident.lng, incident.lat, 16, "dashboard");
        });
        if (newIncidents.length) {
          notify(
            newIncidents.length === 1
              ? `New SOS from ${newIncidents[0].userName} (${newIncidents[0].userRole}).`
              : `${newIncidents.length} new SOS incidents received.`,
            "error"
          );
        }
      },
      (error) => {
        console.error("Supabase incident subscription failed.", error);
        $("supabase-connection-status").textContent =
          "Could not read incidents from Supabase. Check row-level security and the incidents table schema.";
        notify(
          `Could not load realtime incidents: ${error.message || "Supabase error"}`,
          "error"
        );
      }
    );
  }

  supabaseDashboard.subscribeToBroadcasts(
    (broadcasts) => {
      state.broadcasts = broadcasts.map(formatBroadcastFromSupabase);
      renderBroadcastHistory();
      $("supabase-connection-status").textContent =
        "Connected to Supabase. Broadcast history is synced.";
    },
    (error) => {
      console.error("Supabase broadcast subscription failed.", error);
      $("supabase-connection-status").textContent =
        "Could not read broadcasts from Supabase. Check row-level security policies.";
      notify(
        `Could not load broadcasts from Supabase: ${
          error.message || "Supabase error"
        }`,
        "error"
      );
    }
  );

  if (typeof supabaseDashboard.subscribeToCampusBroadcasts === "function") {
    campusBroadcastUnsubscribe?.();
    campusBroadcastUnsubscribe = supabaseDashboard.subscribeToCampusBroadcasts(
      (broadcast) => {
        if (!broadcast || typeof broadcast.message !== "string") {
          console.warn("Ignored malformed campus broadcast payload.", broadcast);
          return;
        }
        const severity = String(broadcast.severity || "info").toLowerCase();
        notify(
          `${broadcast.title || "Campus announcement"}: ${broadcast.message}`,
          severity === "danger" ? "error" : "info"
        );
      },
      (error) => {
        console.error("Campus broadcast Realtime subscription failed.", error);
        $("supabase-connection-status").textContent =
          "Broadcast history is connected, but live Realtime announcements are unavailable.";
        notify(
          `Could not subscribe to live campus announcements: ${error.message || "Supabase Realtime error"}`,
          "error"
        );
      }
    );
  }
});
window.addEventListener("pagehide", () => {
  campusBroadcastUnsubscribe?.();
  campusBroadcastUnsubscribe = null;
}, { once: true });
window.addEventListener("safepateros:show-user-location", (event) => {
  const location = event.detail;
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    location.lat < -90 ||
    location.lat > 90 ||
    !Number.isFinite(location.lng) ||
    location.lng < -180 ||
    location.lng > 180
  ) {
    notify("This user's last known location is unavailable or invalid.", "error");
    return;
  }
  selectedUserMapLocation = {
    ...location,
    id: `USER-${location.id}`,
  };
  gFitted = false;
  renderMap();
  icons();
  navigate("map");
  window.setTimeout(() => focusOn(selectedUserMapLocation), 300);
});
window.addEventListener("safepateros:users-updated", (event) => {
  const { users, studentCount } = event.detail || {};
  if (Array.isArray(users)) syncRegisteredStaff(users);
  if (Number.isFinite(studentCount)) {
    state.campus.activeUsers = studentCount;
    save();
  }
  render();
});
window.addEventListener("safepateros:supabase-error", (event) => {
  const error = event.detail;
  $("supabase-connection-status").textContent =
    "Supabase could not initialize. Check the project URL, anon key and internet connection.";
  notify(
    `Supabase could not initialize: ${
      error && error.message ? error.message : "SDK loading failed"
    }`,
    "error"
  );
});

function updateNetStatus() {
  const online = navigator.onLine;
  const el = $("net-status");
  el.className = `hidden sm:flex badge ${online ? "badge-ok" : "badge-danger"}`;
  $("net-status-text").textContent = online ? "System online" : "No internet";
}
window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);

new MutationObserver(rebuildMapboxMap).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});

/* ---------- 11. STARTUP ---------- */
render();
route();
startMaps();
updateNetStatus();

// Keep "3 min ago" labels and averages fresh
setInterval(() => {
  document.querySelectorAll("[data-since]").forEach((el) => {
    el.textContent = fmtAgo(Number(el.dataset.since));
  });
  renderStats();
}, 30000);  