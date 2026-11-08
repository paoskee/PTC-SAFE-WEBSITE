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
let dashboardService = null;

function toast(message, isError = false) {
  const container = byId("toast-container");
  if (!container) return;
  const item = document.createElement("div");
  item.className = "toast card px-4 py-3 text-sm t-main flex items-center gap-3";
  item.setAttribute("role", isError ? "alert" : "status");
  item.innerHTML = `<span class="w-2 h-2 rounded-full shrink-0 ${isError ? 'bg-red-500' : 'bg-emerald-500'}"></span><span class="flex-1">${escapeHtml(message)}</span>`;
  container.appendChild(item);
  setTimeout(() => item.remove(), 5000);
}

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

function timeAgoText(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "Time unavailable";
  const seconds = Math.floor((Date.now() - millis) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openStudentLocationModal(user) {
  const profileLat = user.last_known_lat;
  const profileLng = user.last_known_lng;
  const profileUpdatedAt = user.location_updated_at;
  const profileAccuracy = user.location_accuracy_m;

  const hasProfileLoc = isValidCoordinate(profileLat) && isValidCoordinate(profileLng);
  let lat, lng, updatedAt, accuracy, sourceLabel;

  const fromSOS = sosLocations.get(user.id);
  if (hasProfileLoc) {
    lat = Number(profileLat);
    lng = Number(profileLng);
    updatedAt = profileUpdatedAt;
    accuracy = profileAccuracy;
    sourceLabel = "Profile location";
  } else if (fromSOS) {
    lat = fromSOS.lat;
    lng = fromSOS.lng;
    updatedAt = fromSOS.updatedAt;
    accuracy = fromSOS.accuracy;
    sourceLabel = "From last SOS";
  } else {
    lat = null;
    lng = null;
    updatedAt = null;
    accuracy = null;
    sourceLabel = "No location recorded yet";
  }

  const hasLocation = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const fullTimestamp = updatedAt !== null && updatedAt !== undefined ? new Date(timestampMillis(updatedAt) ?? updatedAt).toLocaleString() : "Time unavailable";
  const agoText = updatedAt !== null && updatedAt !== undefined ? timeAgoText(updatedAt) : "Time unavailable";
  const accuracyText = accuracy !== null && accuracy !== undefined && Number.isFinite(Number(accuracy)) ? `${Number(accuracy)} meters` : "Unavailable";

  const modalBody = hasLocation
    ? `<div class="space-y-4">
        <div id="student-location-map" class="w-full h-72 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden" aria-label="Student location map"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div class="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
            <span class="text-xs t-muted block">Coordinates</span>
            <strong class="t-main">${escapeHtml(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)}</strong>
            <span class="text-xs t-muted block mt-1">Source: ${escapeHtml(sourceLabel)}</span>
          </div>
          <div class="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
            <span class="text-xs t-muted block">Location Updated At</span>
            <strong class="t-main">${escapeHtml(agoText)}</strong>
            <span class="text-xs t-muted block mt-1">${escapeHtml(fullTimestamp)}</span>
          </div>
          <div class="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg sm:col-span-2">
            <span class="text-xs t-muted block">Accuracy</span>
            <strong class="t-main">${escapeHtml(accuracyText)}</strong>
          </div>
        </div>
      </div>`
    : `<div class="p-6 text-center space-y-2">
        <p class="text-lg font-semibold t-main">No location recorded yet</p>
        <p class="text-sm t-muted">This student has no recorded location in their profile or SOS history.</p>
      </div>`;

  openModal({
    title: `Last known location: ${userName(user)}`,
    subtitle: `${userCategory(user) === "student" ? "Student" : userCategory(user)} · ${user.email || user.id}`,
    icon: "map-pin",
    tone: hasLocation ? "primary" : "muted",
    body: modalBody,
    actions: [{ label: "Close" }],
  });

  if (hasLocation && window.mapboxgl) {
    window.setTimeout(() => {
      const mapEl = byId("student-location-map");
      if (!mapEl) return;
      const dark = document.documentElement.classList.contains("dark");
      const FALLBACK_TOKEN = "pk.eyJ1IjoicGFvcGFvc2tpZXMiLCJhIjoiY212Z3JydHl3MDJtaDJ3cHh6azRueG1uZCJ9.3DvaMQuDVkc7FiRmkeiLOQ";
      const token = window.mapboxgl.accessToken || window.MAPBOX_ACCESS_TOKEN || FALLBACK_TOKEN;
      window.mapboxgl.accessToken = token;

      try {
        const studentMap = new window.mapboxgl.Map({
          container: mapEl,
          style: dark ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v12",
          center: [lng, lat],
          zoom: 16,
        });

        new window.mapboxgl.Marker({ color: "#2563eb" })
          .setLngLat([lng, lat])
          .setPopup(
            new window.mapboxgl.Popup({ offset: 25 }).setHTML(
              `<div style="font-weight:600">${escapeHtml(userName(user))}</div><div style="font-size:0.8rem;color:#666">${escapeHtml(sourceLabel)}</div>`
            )
          )
          .addTo(studentMap);

        const overlay = byId("modal-overlay");
        const destroyMap = (e) => {
          if (e.target.closest("[data-action='close-modal']") || e.target.dataset.action === "close-modal-backdrop" || (e.type === "keydown" && e.key === "Escape")) {
            try {
              studentMap.remove();
            } catch (err) {}
            overlay.removeEventListener("click", destroyMap);
            document.removeEventListener("keydown", destroyMap);
          }
        };
        overlay.addEventListener("click", destroyMap);
        document.addEventListener("keydown", destroyMap);
      } catch (err) {
        console.error("Could not initialize student location map:", err);
      }
    }, 100);
  }
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

const RESPONDER_SPECIALTIES = ["Medical / EMT", "Security / SAR", "First aid / Nurse", "Fire / Rescue", "Responder"];

function isResponderUser(user) {
  const isAdminUser = user.isAdmin === true || user.is_admin === true;
  const specialty = String(user.staffSpecialty ?? user.staff_specialty ?? "").trim();
  return !isAdminUser && specialty.length > 0;
}

function askResponderSpecialty(name) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4";
    overlay.innerHTML = `<div class="card p-5 w-full max-w-sm space-y-4" role="dialog" aria-modal="true" aria-label="Make responder">
      <h2 class="card-title t-main">Make ${escapeHtml(name)} a responder?</h2>
      <p class="field-hint">They will see the responder screen the next time they log in, and appear on the Responders page.</p>
      <label class="block text-sm t-main">Specialization
        <select class="input mt-1 w-full" data-specialty>${RESPONDER_SPECIALTIES.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select>
      </label>
      <div class="flex justify-end gap-2">
        <button class="btn btn-sm" type="button" data-cancel>Cancel</button>
        <button class="btn btn-sm btn-primary" type="button" data-confirm>Make responder</button>
      </div></div>`;
    const done = (value) => { overlay.remove(); resolve(value); };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-cancel]")) done(null);
      if (event.target.closest("[data-confirm]")) done(overlay.querySelector("[data-specialty]").value);
    });
    document.body.appendChild(overlay);
  });
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
  const responders = current.filter(isResponderUser);
  const pendingStaff = [];

  byId("users-student-count").textContent = String(students.length);
  byId("users-staff-count").textContent = String(staff.length);
  if (byId("users-pending-approvals-count")) {
    byId("users-pending-approvals-count").textContent = String(responders.length);
  }
  const navUsersCount = byId("nav-users-count");
  if (navUsersCount) {
    navUsersCount.textContent = String(pendingStaff.length);
    navUsersCount.hidden = pendingStaff.length === 0;
  }

  byId("users-student-tab-count").textContent = String(students.length);
  byId("users-staff-tab-count").textContent = String(staff.length);
  byId("users-all-count").textContent = String(current.length);

  const pendingSection = byId("pending-staff-section");
  const pendingTableBody = byId("pending-staff-table-body");
  if (pendingSection && pendingTableBody) {
    pendingSection.hidden = pendingStaff.length === 0;
    pendingTableBody.innerHTML = pendingStaff.map((user) => {
      const specialty = fieldValue(user, ["staffSpecialty", "staff_specialty", "specialization", "specialty"]);
      const email = fieldValue(user, ["email", "emailAddress", "email_address"]);
      return `<tr>
        <td class="t-main"><strong>${escapeHtml(userName(user))}</strong></td>
        <td class="t-main">${escapeHtml(email || "—")}</td>
        <td class="t-main">${escapeHtml(specialty || "—")}</td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-primary" type="button" data-approve-staff="${escapeHtml(user.id)}">Approve</button>
            <button class="btn btn-sm btn-danger-ghost" type="button" data-revoke-staff="${escapeHtml(user.id)}">Revoke</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

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
      const responder = isResponderUser(user);
      const isAdminUser = user.isAdmin === true || user.is_admin === true;
      const statusBadge = responder ? '<span class="badge badge-ok ml-2">Responder</span>' : "";
      return `<tr class="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors" data-user-row="${escapeHtml(user.id)}">
        <td class="t-main" data-user-details="${escapeHtml(user.id)}"><strong>${escapeHtml(userName(user))}</strong><span class="block text-xs t-muted">${escapeHtml(user.studentId || user.student_id || user.studentNumber || user.staffId || user.employeeId || user.id)}</span></td>
        <td data-user-details="${escapeHtml(user.id)}">${escapeHtml(category === "other" ? "Other / unspecified" : category === "student" ? "Student" : "Staff")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(email || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(phone || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(program || "—")}</td>
        <td class="t-main" data-user-details="${escapeHtml(user.id)}">${escapeHtml(specialty || "—")}${statusBadge}</td>
        <td data-user-details="${escapeHtml(user.id)}"><span class="badge ${presence.online ? "badge-ok" : "badge-muted"}" data-user-presence="${escapeHtml(user.id)}" title="${presence.lastSeen ? `Last seen ${escapeHtml(new Date(presence.lastSeen).toLocaleString())}` : "No recent presence update"}">${presence.online ? "Online" : "Offline"}</span></td>
        <td><button class="btn btn-sm ${location ? "btn-primary" : ""}" type="button" data-user-location="${escapeHtml(user.id)}" ${location ? "" : "disabled"} aria-label="View last known location of ${escapeHtml(userName(user))}"><i data-lucide="map-pin" class="w-4 h-4"></i> View last known location</button></td>
        <td>
          <div class="flex items-center gap-1">
            <button class="btn btn-sm" type="button" data-user-details="${escapeHtml(user.id)}">View</button>
            ${isAdminUser ? "" : responder
              ? `<button class="btn btn-sm btn-danger-ghost" type="button" data-demote-responder="${escapeHtml(user.id)}">Remove responder</button>`
              : `<button class="btn btn-sm btn-primary" type="button" data-promote-responder="${escapeHtml(user.id)}">Make responder</button>`}
          </div>
        </td>
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
  const handleResponderChange = async (userId, promote) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    if (!dashboardService || typeof dashboardService.promoteToResponder !== "function") {
      toast("Supabase admin service is not connected.", true);
      return;
    }
    try {
      if (promote) {
        const specialty = await askResponderSpecialty(userName(target));
        if (!specialty) return;
        await dashboardService.promoteToResponder(userId, specialty);
        Object.assign(target, { role: "Responder", staff_specialty: specialty, staffSpecialty: specialty, is_on_duty: true, isOnDuty: true });
        toast(`${userName(target)} is now a responder (${specialty}).`);
      } else {
        if (!window.confirm(`Remove ${userName(target)} as a responder? They will become a regular student account.`)) return;
        await dashboardService.demoteResponder(userId);
        Object.assign(target, { role: "Student", staff_specialty: null, staffSpecialty: null, is_on_duty: false, isOnDuty: false });
        toast(`${userName(target)} is no longer a responder.`);
      }
      renderUsers();
      publishResponderProfiles(true);
    } catch (error) {
      console.error("Could not update responder status:", error);
      toast(`Could not update responder: ${error.message || "Supabase update failed"}`, true);
    }
  };

  const handleTableStaffAction = (event) => {
    const promoteBtn = event.target.closest("[data-promote-responder]");
    const demoteBtn = event.target.closest("[data-demote-responder]");
    if (promoteBtn) {
      event.stopPropagation();
      handleResponderChange(promoteBtn.dataset.promoteResponder, true);
    } else if (demoteBtn) {
      event.stopPropagation();
      handleResponderChange(demoteBtn.dataset.demoteResponder, false);
    }
  };

  const pendingTableEl = byId("pending-staff-table-body");
  if (pendingTableEl) {
    pendingTableEl.addEventListener("click", handleTableStaffAction);
  }

  byId("users-table-body").addEventListener("click", (event) => {
    handleTableStaffAction(event);
    const locationButton = event.target.closest("[data-user-location]");
    if (locationButton) {
      const user = activeUsers().find((item) => item.id === locationButton.dataset.userLocation);
      if (user) openStudentLocationModal(user);
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
    dashboardService = event.detail;
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