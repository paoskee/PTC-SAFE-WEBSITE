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
const timestampMillis = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Math.abs(value) < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) {
      return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const dateText = (value) => {
  const millis = timestampMillis(value);
  return millis === null ? "Time unavailable" : new Date(millis).toLocaleString();
};
const estimatedArrivalText = (value) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0
    ? `About ${Math.max(1, Math.round(minutes))} min`
    : "Unavailable";
};
const normalizedStatus = (value) => {
  if (value === false) return "Cancelled";
  if (value === true) return "Pending";
  const status = String(value || "").trim();
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  const known = {
    pending: "Pending",
    active: "Pending",
    new: "Pending",
    unhandled: "Pending",
    unassigned: "Pending",
    accepted: "Accepted",
    pending_acceptance: "Pending acceptance",
    assigned: "Responding",
    dispatched: "Responding",
    responding: "Responding",
    en_route: "Responding",
    in_progress: "Responding",
    resolved: "Resolved",
    closed: "Resolved",
    completed: "Resolved",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    cancel: "Cancelled",
    withdrawn: "Cancelled",
    user_cancelled: "Cancelled",
    user_canceled: "Cancelled",
    user_cancel: "Cancelled",
    canceled_by_student: "Cancelled",
    cancelled_by_student: "Cancelled",
    canceled_by_user: "Cancelled",
    cancelled_by_user: "Cancelled",
    inactive: "Cancelled",
    false: "Cancelled",
    declined: "Cancelled",
    rejected: "Cancelled",
    false_alarm: "False Alarm",
    fake_alarm: "Fake Alarm",
  };
  return known[key] ||
    (status ? status.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown");
};
const dateKey = (millis) => {
  const date = new Date(millis);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const locationOf = (alert) => {
  const location = alert.userLocation || alert.coordinates ||
    (alert.location && typeof alert.location === "object" ? alert.location : {});
  const latitude = Number(alert.latitude ?? alert.lat ?? location.latitude ?? location.lat);
  const longitude = Number(alert.longitude ?? alert.lng ?? location.longitude ?? location.lng);
  return Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : null;
};
const mapsLinkOf = (alert) => {
  const location = locationOf(alert);
  return location
    ? `https://www.mapbox.com/directions/?destination=${location.longitude},${location.latitude}&profile=mapbox/walking`
    : null;
};
const userNameOf = (alert) =>
  alert.userProfile?.name || alert.userInfo?.name ||
  alert.users?.name || alert.name || "Name not provided";
const roleOf = (alert) =>
  alert.userRole || alert.userProfile?.role || alert.userInfo?.role ||
  alert.users?.role || alert.role || "Not provided";
const phoneOf = (alert) =>
  alert.userPhone || alert.userProfile?.phone || alert.userInfo?.phone ||
  alert.users?.phone || alert.phone || "Not provided";
const typeOf = (alert) => {
  if (["Cancelled", "False Alarm"].includes(normalizedStatus(alert.status))) {
    return "False Alarm";
  }
  const type = String(
    alert.emergencyType || alert.emergency_type || alert.alert_type ||
    alert.alertType || alert.category || alert.type || "Emergency"
  ).trim();
  const known = {
    medical: "Medical",
    fire: "Fire",
    security: "Security",
    accident: "Accident",
    general: "General",
    emergency: "Emergency",
  };
  return known[type.toLowerCase()] ||
    type.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};
const addressOf = (alert) => {
  const structuredAddress =
    alert.address && typeof alert.address === "object" ? alert.address : {};
  const userAddress =
    alert.userInfo && typeof alert.userInfo === "object" ? alert.userInfo : {};
  const savedAddress = [
    alert.locationAddress,
    alert.streetAddress,
    alert.addressLine,
    alert.locationName,
    alert.location_name,
    alert.full_address,
    alert.placeFormatted,
    alert.location?.address,
    alert.location?.name,
    userAddress.locationAddress,
    userAddress.address,
    typeof alert.location === "string" ? alert.location : "",
    [structuredAddress.streetNumber, structuredAddress.street, structuredAddress.barangay, structuredAddress.city, structuredAddress.province]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", "),
    [alert.street || userAddress.street, alert.barangay || userAddress.barangay, alert.city || alert.municipality || userAddress.city, alert.province || userAddress.province]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", "),
    typeof alert.address === "string" ? alert.address : "",
  ].find((part) => typeof part === "string" && part.trim());
  if (savedAddress) return savedAddress.trim();
  const location = locationOf(alert);
  return location
    ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
    : "Location unavailable";
};
function normalizeSOSRecord(source) {
  const record =
    source.alert && typeof source.alert === "object"
      ? { ...source, ...source.alert }
      : source;
  const profile = record.userProfile || record.userInfo || record.users || {};
  const coordinates = record.location && typeof record.location === "object"
    ? record.location
    : {};
  const userId = String(record.user_id || record.userId || record.uid || "");
  const createdAt =
    record.created_at || record.createdAt || record.timestamp ||
    record.sentAt || record.sent_at || record.reportedAt ||
    record.reported_at || record.time || record.date || null;
  const rawStatus =
    record.is_active === false ||
    record.isActive === false ||
    record.active === false ||
    record.is_cancelled === true ||
    record.is_canceled === true ||
    record.cancelled === true ||
    record.canceled === true
      ? false
      : record.status ?? record.alertStatus ?? record.alert_status ?? record.state;
  const status = normalizedStatus(rawStatus);
  const type =
    record.emergencyType || record.emergency_type || record.alert_type ||
    record.alertType || record.category || record.type || "Emergency";
  const rawId = String(record.id || record.requestId || record.request_id || "");
  return {
    ...record,
    id: `${record._sourceTable || "sos"}:${rawId}`,
    sourceRecordId: rawId,
    sourceTable: record._sourceTable || "alerts",
    userId,
    user_id: userId,
    userProfile: profile,
    userName:
      profile.name || record.userName || record.user_name ||
      record.name || "",
    userRole:
      record.userRole || record.user_role || profile.role ||
      record.role || "",
    userPhone:
      record.userPhone || record.user_phone || profile.phone ||
      profile.contact_number || record.phone || "",
    latitude:
      record.latitude ?? record.lat ??
      coordinates.latitude ?? coordinates.lat,
    longitude:
      record.longitude ?? record.lng ??
      coordinates.longitude ?? coordinates.lng,
    timestamp: createdAt,
    type,
    status,
    responderName:
      record.responderName || record.responder_name ||
      record.assignedResponder?.name || record.responderInfo?.name || "",
    assignedResponderId:
      record.assigned_responder_id || record.responder_id ||
      record.assignedResponderId || "",
    responderStatus:
      record.responder_status || record.responderStatus || "",
    resolutionReport:
      record.resolution_report ?? record.resolutionReport ?? null,
    responderPhone:
      record.responderPhone || record.responder_phone ||
      record.assignedResponder?.phone || record.responderInfo?.phone || "",
    responderUnit:
      record.responder_unit || record.responderUnit ||
      record.assignedResponder?.unit || "",
    responderSpecialty:
      record.responder_specialty || record.responderSpecialty ||
      record.assignedResponder?.specialty || "",
    responderEtaMinutes:
      record.responderEtaMinutes ?? record.responder_eta_minutes ??
      record.assignedResponder?.etaMinutes ?? record.responderInfo?.etaMinutes,
    adminNote: record.admin_note || record.adminNote || "",
    acceptedAt: record.accepted_at || record.acceptedAt || null,
    resolvedAt: record.resolved_at || record.resolvedAt || null,
    responderLocationUpdatedAt:
      record.responder_location_updated_at ||
      record.responderLocationUpdatedAt || null,
    responderLatitude:
      record.responder_latitude ?? record.responderLatitude ??
      record.responderLocation?.latitude ??
      record.responderLocation?.lat ?? record.responder_location?.latitude,
    responderLongitude:
      record.responder_longitude ?? record.responderLongitude ??
      record.responderLocation?.longitude ??
      record.responderLocation?.lng ?? record.responder_location?.longitude,
  };
}
const isMobileSOSRecord = (alert) =>
  alert.sourceTable === "emergency_requests" ||
  Boolean(alert.userId || alert.user_id || alert.uid);
const statusClass = (status) =>
  ({
    Pending: "sos-status-pending",
    Accepted: "sos-status-accepted",
    Responding: "sos-status-responding",
    Resolved: "sos-status-resolved",
    Declined: "sos-status-declined",
    Cancelled: "sos-status-declined",
    "False Alarm": "sos-status-declined",
  })[normalizedStatus(status)] || "sos-status-unknown";
const displayStatus = (status) =>
  normalizedStatus(status);

let dashboard;
let alerts = [];
let selectedAlertId = null;
const dispatchingAlertIds = new Set();
let map;
let sosMapReady = false;
let victimMarker;
let responderMarker;
let routeLine;
let audioContext;
let alarmOscillator;
let alarmGain;
let alarmPulseTimer;
let alarmStarting = false;
let alarmBlocked = false;
let firstSnapshot = true;
let previousStatuses = new Map();
const selectedHistoryIds = new Set();

function toast(message, isError = false) {
  const container = byId("toast-container");
  const item = document.createElement("div");
  item.className = "toast card px-4 py-3 text-sm t-main";
  item.setAttribute("role", isError ? "alert" : "status");
  item.textContent = message;
  container.append(item);
  window.setTimeout(() => item.remove(), 5000);
}

function scheduleAlarmPulse() {
  if (!audioContext || !alarmGain) return;
  const start = audioContext.currentTime;
  const gain = alarmGain.gain;
  gain.cancelScheduledValues(start);
  gain.setValueAtTime(0.0001, start);
  [0, 0.34, 0.68].forEach((offset) => {
    gain.setValueAtTime(0.0001, start + offset);
    gain.exponentialRampToValueAtTime(0.16, start + offset + 0.025);
    gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
  });
}

function stopAlarm() {
  window.clearInterval(alarmPulseTimer);
  alarmPulseTimer = undefined;
  if (alarmOscillator) {
    try {
      alarmOscillator.stop();
      alarmOscillator.disconnect();
      alarmGain?.disconnect();
    } catch (error) {
      console.warn("SOS alarm audio could not be stopped cleanly.", error);
    }
  }
  alarmOscillator = null;
  alarmGain = null;
}

async function startAlarm() {
  if (
    !alerts.some((alert) => alert.status === "Pending") ||
    alarmOscillator ||
    alarmBlocked ||
    alarmStarting
  ) return;
  alarmStarting = true;
  try {
    audioContext ||= new window.AudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    if (!alerts.some((alert) => alert.status === "Pending")) return;
    alarmOscillator = audioContext.createOscillator();
    alarmGain = audioContext.createGain();
    alarmOscillator.type = "sawtooth";
    alarmOscillator.frequency.value = 880;
    alarmGain.gain.value = 0.0001;
    alarmOscillator.connect(alarmGain);
    alarmGain.connect(audioContext.destination);
    alarmOscillator.start();
    scheduleAlarmPulse();
    alarmPulseTimer = window.setInterval(scheduleAlarmPulse, 1200);
  } catch (error) {
    alarmBlocked = true;
    console.error("SOS alarm audio could not be played.", error);
    toast("The browser blocked SOS alarm audio. Interact with the page to enable it.", true);
  } finally {
    alarmStarting = false;
  }
}

function syncAlarm() {
  const pending = alerts.some((alert) =>
    isMobileSOSRecord(alert) && alert.status === "Pending"
  );
  if (pending) void startAlarm();
  else stopAlarm();
  const button = byId("alertnest-audio-enable");
  if (button) {
    button.textContent =
      audioContext?.state === "running" ? "Alarm audio enabled" : "Enable alarm audio";
  }
}

function resumeAlarmFromGesture() {
  if (alerts.some((alert) =>
    isMobileSOSRecord(alert) && alert.status === "Pending"
  )) {
    alarmBlocked = false;
    if (!audioContext) {
      void startAlarm();
    } else if (audioContext.state === "suspended") {
      void audioContext.resume().then(() => {
        void startAlarm();
      }).catch((error) => {
        console.error("SOS alarm audio could not be resumed.", error);
      });
    } else {
      void startAlarm();
    }
  }
}

document.addEventListener("pointerdown", resumeAlarmFromGesture);
document.addEventListener("keydown", resumeAlarmFromGesture);

function updatePendingCount() {
  const count = alerts.filter((alert) =>
    isMobileSOSRecord(alert) && alert.status === "Pending"
  ).length;
  window.alertNestPendingCount = count;
  byId("alertnest-pending-count").textContent = `${count} pending`;
  const navCount = byId("nav-alert-count");
  navCount.textContent = String(count);
  navCount.hidden = count === 0;
  byId("stat-sos").textContent = String(count);
  byId("stat-sos-sub").textContent = `${count} awaiting dispatch`;
}

function elapsedText(timestamp) {
  const sentAt = timestampMillis(timestamp);
  if (sentAt === null) return "Elapsed time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - sentAt) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min elapsed`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m elapsed`;
}

function renderAlertCards() {
  const list = byId("alertnest-alert-list");
  const pendingAlerts = alerts.filter((alert) =>
    isMobileSOSRecord(alert) && alert.status === "Pending"
  );
  if (!pendingAlerts.length) {
    list.innerHTML = '<div class="p-5 text-sm t-muted">No pending mobile SOS requests. Alerts appear here after a mobile user sends an SOS.</div>';
    return;
  }
  list.innerHTML = pendingAlerts.map((alert) => `
    <article class="sos-alert-item" id="alert-card-${escapeHtml(alert.id)}">
      <button class="sos-alert-card" type="button" data-open-alert="${escapeHtml(alert.id)}">
        <div class="sos-alert-card-head">
          <strong>${escapeHtml(userNameOf(alert))}</strong>
          <span class="sos-status ${statusClass(alert.status)}">${escapeHtml(
            alert.responderStatus
              ? normalizedStatus(alert.responderStatus)
              : "Pending"
          )}</span>
        </div>
        <div class="sos-alert-meta">
          <span>${escapeHtml(roleOf(alert))}</span><span>${escapeHtml(phoneOf(alert))}</span>
          <span>${escapeHtml(typeOf(alert))}</span><span>${escapeHtml(dateText(alert.timestamp))}</span>
        </div>
        <div class="sos-alert-location">${escapeHtml(addressOf(alert))}</div>
        ${alert.responderName ? `<span class="field-hint block px-4">Assigned to ${escapeHtml(alert.responderName)} · awaiting acceptance</span>` : ""}
        <span class="field-hint">${escapeHtml(elapsedText(alert.timestamp))}</span>
      </button>
      ${mapsLinkOf(alert) ? `<a class="field-hint inline-block px-4 pb-2" href="${mapsLinkOf(alert)}" target="_blank" rel="noopener noreferrer">Open precise location in Mapbox</a>` : ""}
      <div class="alert-actions px-4 pb-4">
        ${alert.assignedResponderId ? "" : `<button class="btn btn-primary btn-sm" type="button" data-dispatch-nearest="${escapeHtml(alert.id)}">Assign nearest</button>
        <button class="btn btn-sm" type="button" data-choose-responder="${escapeHtml(alert.id)}">Assign responder</button>`}
        <button class="btn btn-danger-ghost btn-sm" type="button" data-cancel-alert="${escapeHtml(alert.id)}">Cancel SOS</button>
      </div>
    </article>`).join("");
}

function resolutionReportText(alert) {
  const report = alert.resolutionReport;
  if (report == null || report === "") return "—";
  if (typeof report === "string") return report;
  if (typeof report !== "object") return String(report);
  return Object.entries(report)
    .map(([key, value]) => {
      const rendered = value && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");
      return rendered ? `${key}: ${rendered}` : "";
    })
    .filter(Boolean)
    .join(" · ") || "—";
}

function filteredAlerts() {
  const date = byId("alertnest-filter-date").value;
  const type = byId("alertnest-filter-type").value;
  const status = byId("alertnest-filter-status").value;
  return alerts.filter((alert) => {
    const millis = timestampMillis(alert.timestamp);
    const alertDate = millis === null ? "" : dateKey(millis);
    return (!date || alertDate === date) &&
      (!type || typeOf(alert) === type) &&
      (!status ||
        alert.status === normalizedStatus(status) ||
        (normalizedStatus(status) === "False Alarm" && alert.status === "Cancelled"));
  });
}

function renderHistory() {
  const rows = filteredAlerts();
  const visibleIds = new Set(rows.map((alert) => alert.id));
  selectedHistoryIds.forEach((id) => {
    if (!visibleIds.has(id)) selectedHistoryIds.delete(id);
  });
  byId("alertnest-classify-selected").disabled = selectedHistoryIds.size === 0;
  byId("alertnest-export-selected").disabled = selectedHistoryIds.size === 0;
  byId("alertnest-delete-selected").disabled = selectedHistoryIds.size === 0;
  const selectAll = byId("alertnest-history-select-all");
  const selectedVisibleCount = rows.filter((alert) =>
    selectedHistoryIds.has(alert.id)
  ).length;
  selectAll.checked = rows.length > 0 && selectedVisibleCount === rows.length;
  selectAll.indeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < rows.length;
  selectAll.disabled = rows.length === 0;
  byId("alertnest-history-body").innerHTML = rows.length
    ? rows.map((alert) => `
      <tr class="sos-history-row">
        <td><input type="checkbox" data-select-alert="${escapeHtml(alert.id)}" aria-label="Select SOS record for ${escapeHtml(userNameOf(alert))}" ${selectedHistoryIds.has(alert.id) ? "checked" : ""}></td>
        <td>${escapeHtml(dateText(alert.timestamp))}</td>
        <td>${escapeHtml(userNameOf(alert))}</td>
        <td>${escapeHtml(typeOf(alert))}</td>
        <td>${escapeHtml(addressOf(alert))}</td>
        <td>${escapeHtml(alert.responderName || "—")}${alert.responderName ? `<span class="block text-xs t-muted">ETA: ${escapeHtml(estimatedArrivalText(alert.responderEtaMinutes))}</span>` : ""}</td>
        <td><span class="sos-status ${statusClass(alert.status)}">${escapeHtml(displayStatus(alert.status))}</span></td>
        <td>${escapeHtml(alert.responderStatus ? normalizedStatus(alert.responderStatus) : "—")}</td>
        <td class="max-w-sm whitespace-normal">${escapeHtml(resolutionReportText(alert))}</td>
      </tr>`).join("")
    : '<tr><td colspan="9" class="t-muted">No alerts match these filters.</td></tr>';
}

function renderAll() {
  updatePendingCount();
  syncAlarm();
  renderAlertCards();
  renderHistory();
  if (selectedAlertId) {
    const selected = alerts.find((alert) => alert.id === selectedAlertId);
    if (selected) renderSelectedAlert(selected);
    else closeDetail();
  }
}

function showDetail() {
  byId("sos-detail-overlay").hidden = false;
  document.body.classList.add("sos-detail-open");
  window.setTimeout(() => {
    if (map) map.resize();
  }, 80);
}

function closeDetail() {
  byId("sos-detail-overlay").hidden = true;
  document.body.classList.remove("sos-detail-open");
  byId("sos-dispatch-form").hidden = true;
  selectedAlertId = null;
}

function setupMap() {
  if (map || !window.mapboxgl) return;
  map = new window.mapboxgl.Map({
    container: "sos-detail-map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: [121.0689, 14.5525],
    zoom: 14,
  });
  map.on("load", () => {
    sosMapReady = true;
    const alert = alerts.find((item) => item.id === selectedAlertId);
    if (alert) renderMap(alert);
  });
  map.on("error", (event) => {
    console.error("SOS detail Mapbox map reported an error.", event.error);
  });
}

function renderMap(alert) {
  const victim = locationOf(alert);
  const responderLatitude = Number(alert.responderLatitude);
  const responderLongitude = Number(alert.responderLongitude);
  const hasResponderLocation =
    Number.isFinite(responderLatitude) &&
    responderLatitude >= -90 &&
    responderLatitude <= 90 &&
    Number.isFinite(responderLongitude) &&
    responderLongitude >= -180 &&
    responderLongitude <= 180;
  setupMap();
  if (!map) {
    byId("sos-detail-map").textContent = "Mapbox service is unavailable.";
    return;
  }
  if (!sosMapReady) return;
  if (victimMarker) victimMarker.remove();
  if (responderMarker) responderMarker.remove();
  victimMarker = null;
  responderMarker = null;
  if (routeLine && map.getLayer("sos-responder-route")) {
    map.removeLayer("sos-responder-route");
    map.removeSource("sos-responder-route");
  }
  routeLine = null;
  if (!victim) {
    byId("sos-responder-live").textContent =
      "Victim coordinates are unavailable; the map cannot show this alert.";
    map.flyTo({ center: [121.0689, 14.5525], zoom: 14 });
    return;
  }

    const victimPosition = [victim.longitude, victim.latitude];
    victimMarker = new window.mapboxgl.Marker({ color: "#dc2626" })
      .setLngLat(victimPosition)
      .setPopup(
        new window.mapboxgl.Popup({ offset: 25 }).setText(
          `SOS location: ${addressOf(alert)}`
        )
      )
      .addTo(map);

    let routeDrawn = false;
    if (hasResponderLocation) {
      const responderPosition = [responderLongitude, responderLatitude];
      responderMarker = new window.mapboxgl.Marker({ color: "#2563eb" })
        .setLngLat(responderPosition)
        .setPopup(
          new window.mapboxgl.Popup({ offset: 25 }).setText(
            `Responder: ${alert.responderName || "Assigned responder"}`
          )
        )
        .addTo(map);

      // Fetch Mapbox Directions API for street-by-street routing
      try {
        const token = window.mapboxgl.accessToken || MAPBOX_ACCESS_TOKEN || "pk.eyJ1IjoicGFvcGFvc2tpZXMiLCJhIjoiY212Z3JydHl3MDJtaDJ3cHh6azRueG1uZCJ9.3DvaMQuDVkc7FiRmkeiLOQ";
        const dirUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${responderLongitude},${responderLatitude};${victim.longitude},${victim.latitude}?geometries=geojson&access_token=${token}`;
        const MAPBOX_ACCESS_TOKEN = window.MAPBOX_ACCESS_TOKEN || "pk.eyJ1IjoicGFvcGFvc2tpZXMiLCJhIjoiY212Z3JydHl3MDJtaDJ3cHh6azRueG1uZCJ9.3DvaMQuDVkc7FiRmkeiLOQ";

        const res = await fetch(dirUrl);
        const data = await res.json();
        if (data && data.routes && data.routes[0] && data.routes[0].geometry) {
          const routeGeoJson = {
            type: "Feature",
            properties: {},
            geometry: data.routes[0].geometry,
          };
          map.addSource("sos-responder-route", {
            type: "geojson",
            data: routeGeoJson,
          });
          map.addLayer({
            id: "sos-responder-route",
            type: "line",
            source: "sos-responder-route",
            paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.85 },
          });
          routeLine = true;
          routeDrawn = true;
        }
      } catch (e) {
        console.warn("Mapbox Directions API routing failed, falling back to straight line:", e);
      }

      if (!routeDrawn) {
        map.addSource("sos-responder-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [victimPosition, responderPosition],
            },
          },
        });
        map.addLayer({
          id: "sos-responder-route",
          type: "line",
          source: "sos-responder-route",
          paint: { "line-color": "#2563eb", "line-width": 4 },
        });
        routeLine = true;
      }
      map.fitBounds([victimPosition, responderPosition], { padding: 36, maxZoom: 16 });
    } else {
      map.flyTo({ center: victimPosition, zoom: 16 });
    }
  window.setTimeout(() => map.resize(), 80);
}

function renderSelectedAlert(alert) {
  byId("sos-detail-title").textContent = `${typeOf(alert)} SOS`;
  byId("sos-detail-subtitle").textContent = `${dateText(alert.timestamp)} · ${elapsedText(alert.timestamp)}`;
  const mapsLink = mapsLinkOf(alert);
  byId("sos-detail-facts").innerHTML = `
    <div><span>Name</span><strong>${escapeHtml(userNameOf(alert))}</strong></div>
    <div><span>Role</span><strong>${escapeHtml(roleOf(alert))}</strong></div>
    <div><span>Phone</span><strong>${escapeHtml(phoneOf(alert))}</strong></div>
    <div><span>Precise coordinates</span><strong>${escapeHtml(locationOf(alert) ? `${locationOf(alert).latitude.toFixed(6)}, ${locationOf(alert).longitude.toFixed(6)}` : "Unavailable")}</strong></div>
    <div><span>Location</span><strong>${escapeHtml(addressOf(alert))}${mapsLink ? `<br><a class="t-info underline underline-offset-2" href="${mapsLink}" target="_blank" rel="noopener noreferrer">Open precise location in Mapbox</a>` : ""}</strong></div>
    <div><span>Reported</span><strong>${escapeHtml(dateText(alert.timestamp))}</strong></div>
    <div><span>Emergency details</span><strong>${escapeHtml(alert.description || alert.message || alert.note || alert.details || "No additional details provided.")}</strong></div>
    <div><span>Status</span><strong class="sos-status ${statusClass(alert.status)}">${escapeHtml(displayStatus(alert.status))}</strong></div>
    <div><span>Responder status</span><strong>${escapeHtml(alert.responderStatus ? normalizedStatus(alert.responderStatus) : "—")}</strong></div>
    <div><span>Responder</span><strong>${escapeHtml(alert.responderName || "Not assigned")}</strong></div>
    <div><span>Estimated arrival</span><strong>${escapeHtml(alert.responderName ? estimatedArrivalText(alert.responderEtaMinutes) : "Not assigned")}</strong></div>
    <div><span>Resolution report</span><strong>${escapeHtml(resolutionReportText(alert))}</strong></div>`;
  byId("sos-responder-live").textContent = alert.responderName
    ? `Assigned responder: ${alert.responderName}${alert.responderPhone ? ` · ${alert.responderPhone}` : ""} · Estimated arrival: ${estimatedArrivalText(alert.responderEtaMinutes)}${alert.responderLocationUpdatedAt ? ` · Location updated ${dateText(alert.responderLocationUpdatedAt)}` : ""}`
    : "No responder assigned yet.";

  const actions = byId("sos-detail-actions");
  actions.replaceChildren();
  byId("sos-dispatch-form").hidden = true;
  if (alert.status === "Pending") {
    if (!alert.assignedResponderId) {
      addAction(actions, "Assign nearest", "btn btn-primary", () => dispatchNearest(alert.id));
      addAction(actions, "Assign responder", "btn", () => startDispatch(alert));
    }
    addAction(actions, "Cancel SOS", "btn btn-danger-ghost", () => changeStatus(alert, "Declined"));
  } else if (alert.status === "Accepted") {
    addAction(actions, "Mark Responding / En route", "btn btn-primary", () => changeStatus(alert, "Responding"));
    addAction(actions, "Mark Resolved", "btn", () => changeStatus(alert, "Resolved"));
    addAction(actions, "Simulate responder movement", "btn", () => simulateMovement(alert));
  } else if (alert.status === "Responding") {
    addAction(actions, "Mark Resolved", "btn", () => changeStatus(alert, "Resolved"));
    addAction(actions, "Simulate responder movement", "btn", () => simulateMovement(alert));
  }
  renderMap(alert);
}

function addAction(container, label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  container.append(button);
}

async function openAlert(alertId) {
  const alert = alerts.find((item) => item.id === alertId);
  if (!alert) return;
  selectedAlertId = alertId;
  showDetail();
  renderSelectedAlert(alert);
}

function startDispatch(alert) {
  const available = getAvailableResponders(alert);
  if (!available.length) {
    toast("No available responders were found for this incident.", true);
    return;
  }
  const form = byId("sos-dispatch-form");
  form.hidden = false;
  byId("sos-detail-actions").replaceChildren();
  renderResponderOptions(available);
}

function getAvailableResponders(alert) {
  if (typeof window.safepaterosGetAvailableRespondersForAlert !== "function") {
    toast("The available responder list is not ready. Reload the dashboard and try again.", true);
    return [];
  }
  const location = locationOf(alert);
  return window.safepaterosGetAvailableRespondersForAlert({
    lat: location?.latitude,
    lng: location?.longitude,
  });
}

function renderResponderOptions(available) {
  byId("sos-responder-options").innerHTML = available
    .map((responder, index) => `
      <label class="flex items-center gap-3 p-3 rounded-xl border line surface-2 cursor-pointer">
        <input type="radio" name="sos-responder" value="${escapeHtml(responder.id)}" ${index === 0 ? "checked" : ""} />
        <span class="flex-1 min-w-0">
          <span class="font-semibold t-main block">${escapeHtml(responder.name)}</span>
          <span class="text-xs t-muted">${escapeHtml(responder.specialty)} · ${escapeHtml(responder.phone)} · ${escapeHtml(responder.location)}</span>
        </span>
        <span class="text-sm t-main text-right">${responder.distanceMeters == null ? '<span class="t-muted">Distance unknown<br>ETA unavailable</span>' : `${Math.round(responder.distanceMeters)} m<br><span class="text-xs t-muted">ETA: ${escapeHtml(estimatedArrivalText(responder.etaMinutes))}</span>`}</span>
      </label>`)
    .join("");
}

async function dispatchNearest(alertId) {
  if (!selectedAlertId || selectedAlertId !== alertId) {
    selectedAlertId = alertId;
  }
  const alert = alerts.find((item) => item.id === alertId);
  if (!alert) return;
  const responder = getAvailableResponders(alert)[0];
  if (!responder) {
    toast("No available responders were found for this incident.", true);
    return;
  }
  await dispatchToResponder(alert, responder);
}

async function handleDispatchSubmit(event) {
  event.preventDefault();
  const alert = alerts.find((item) => item.id === selectedAlertId);
  const selectedResponder = byId("sos-responder-options").querySelector(
    'input[name="sos-responder"]:checked'
  );
  const responder = alert && getAvailableResponders(alert).find(
    (item) => item.id === selectedResponder?.value
  );
  if (!alert || alert.status !== "Pending") {
    toast("This alert is no longer pending.", true);
    return;
  }
  if (!responder) {
    toast("Choose an available responder before dispatching.", true);
    return;
  }
  await dispatchToResponder(alert, responder);
}

async function dispatchToResponder(alert, responder) {
  if (!dashboard) {
    toast("Supabase is not connected. The SOS was not dispatched.", true);
    return;
  }
  const availableResponder = getAvailableResponders(alert).find(
    (item) => item.id === responder.id
  );
  if (!availableResponder) {
    toast("This responder is no longer available for assignment.", true);
    return;
  }
  if (alert.status !== "Pending" || dispatchingAlertIds.has(alert.id)) {
    toast("This alert is no longer pending or is already being dispatched.", true);
    return;
  }
  if (alert.assignedResponderId) {
    toast("This alert already has an assigned responder.", true);
    return;
  }
  dispatchingAlertIds.add(alert.id);
  try {
    const selectedResponder = {
      id: responder.id,
      name: responder.name,
      phone: responder.phone,
      unit: responder.unit,
      specialty: responder.specialty,
      etaMinutes: responder.etaMinutes,
    };
    if (typeof dashboard.dispatchSOSRecord === "function") {
      await dashboard.dispatchSOSRecord(
        alert.sourceTable,
        alert.sourceRecordId,
        selectedResponder
      );
    } else {
      await dashboard.acceptAndDispatchAlert(alert.sourceRecordId, selectedResponder);
    }
    Object.assign(alert, {
      status: alert.sourceTable === "alerts" ? "Pending" : "Accepted",
      assignedResponderId: responder.id,
      responderStatus: alert.sourceTable === "alerts" ? "pending_acceptance" : "accepted",
      responderName: responder.name,
      responderPhone: responder.phone,
      responderUnit: responder.unit,
      responderSpecialty: responder.specialty,
      responderEtaMinutes: responder.etaMinutes,
      ...(alert.sourceTable === "alerts" ? {} : { acceptedAt: Date.now() }),
    });
    byId("sos-dispatch-form").hidden = true;
    renderAll();
    closeDetail();
    toast(alert.sourceTable === "alerts"
      ? `${responder.name} assigned. Waiting for responder acceptance.`
      : `${responder.name} dispatched. You can now mark the incident resolved.`);
  } catch (error) {
    console.error("SOS dispatch could not be saved.", error);
    toast(`Dispatch failed: ${error.message || "Supabase update failed"}`, true);
  } finally {
    dispatchingAlertIds.delete(alert.id);
  }
}

async function changeStatus(alert, status) {
  const confirmation = {
    Declined: {
      title: "Cancel SOS?",
      message: "Cancel this SOS alert? It will remain in the incident history.",
      confirmLabel: "Cancel SOS",
    },
    Resolved: {
      title: "Resolve SOS?",
      message: "Mark this SOS incident as resolved?",
      confirmLabel: "Mark resolved",
    },
    "False Alarm": {
      title: "Classify as False Alarm?",
      message: "This incident will remain in history and be categorized as a false alarm.",
      confirmLabel: "Classify incident",
    },
  }[status];
  if (confirmation) {
    if (typeof window.safepaterosConfirm !== "function") {
      toast("The dashboard confirmation dialog is unavailable. No changes were made.", true);
      return;
    }
    if (!await window.safepaterosConfirm(confirmation)) return;
  }
  try {
    if (typeof dashboard.updateSOSRecordStatus === "function") {
      await dashboard.updateSOSRecordStatus(
        alert.sourceTable,
        alert.sourceRecordId,
        status
      );
    } else {
      await dashboard.updateAlertStatus(alert.sourceRecordId, status);
    }
    if (status === "Resolved") releaseResponderForAlert(alert);
    Object.assign(alert, {
      status,
      ...(status === "Resolved" ? { resolvedAt: Date.now() } : {}),
      ...(status === "Declined" || status === "False Alarm" ? { cancelledAt: Date.now() } : {}),
    });
    if (status === "Declined" || status === "Resolved") closeDetail();
    renderAll();
    toast(status === "Declined" ? "SOS alert cancelled." : `Alert marked ${status.toLowerCase()}.`);
  } catch (error) {
    console.error(`SOS status could not be changed to ${status}.`, error);
    toast(`Could not update alert status: ${error.message || "Supabase update failed"}`, true);
  }
}

function releaseResponderForAlert(alert) {
  const responderId = alert.assignedResponderId;
  if (!responderId) return;
  const hasOtherActiveAlert = alerts.some(
    (item) =>
      item.id !== alert.id &&
      item.assignedResponderId === responderId &&
      ["Accepted", "Responding"].includes(item.status)
  );
  if (!hasOtherActiveAlert) {
    window.safepaterosMarkResponderAvailable?.(responderId, addressOf(alert));
  }
}

async function simulateMovement(alert) {
  const victim = locationOf(alert);
  if (!victim) {
    toast("Cannot simulate movement because victim coordinates are unavailable.", true);
    return;
  }
  let latitude = Number(alert.responderLatitude);
  let longitude = Number(alert.responderLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    latitude = victim.latitude + 0.003;
    longitude = victim.longitude + 0.003;
  } else {
    latitude += (victim.latitude - latitude) * 0.35;
    longitude += (victim.longitude - longitude) * 0.35;
  }
  try {
    if (typeof dashboard.updateSOSResponderLocation === "function") {
      await dashboard.updateSOSResponderLocation(
        alert.sourceTable,
        alert.sourceRecordId,
        latitude,
        longitude
      );
    } else {
      await dashboard.updateAlertResponderLocation(alert.sourceRecordId, latitude, longitude);
    }
    toast("Simulated responder coordinates written to Supabase.");
  } catch (error) {
    console.error("Simulated responder movement could not be saved.", error);
    toast(`Could not simulate responder movement: ${error.message || "Supabase update failed"}`, true);
  }
}

function exportCsv(selectedOnly = false) {
  const columns = [
    ["alertId", (alert) => alert.id],
    ["timestamp", (alert) => dateText(alert.timestamp)],
    ["userName", userNameOf],
    ["role", roleOf],
    ["phone", phoneOf],
    ["emergencyType", typeOf],
    ["locationAddress", addressOf],
    ["latitude", (alert) => alert.latitude ?? ""],
    ["longitude", (alert) => alert.longitude ?? ""],
    ["status", (alert) => displayStatus(alert.status)],
    ["assignedResponderId", (alert) => alert.assignedResponderId || ""],
    ["responderName", (alert) => alert.responderName || ""],
    ["responderPhone", (alert) => alert.responderPhone || ""],
    ["responderUnit", (alert) => alert.responderUnit || ""],
    ["responderSpecialty", (alert) => alert.responderSpecialty || ""],
    ["responderEtaMinutes", (alert) => alert.responderEtaMinutes ?? ""],
    ["adminNote", (alert) => alert.adminNote || ""],
    ["acceptedAt", (alert) => dateText(alert.acceptedAt)],
    ["resolvedAt", (alert) => dateText(alert.resolvedAt)],
    ["responderLatitude", (alert) => alert.responderLatitude ?? ""],
    ["responderLongitude", (alert) => alert.responderLongitude ?? ""],
    ["responderLocationUpdatedAt", (alert) => dateText(alert.responderLocationUpdatedAt)],
  ];
  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.map(([name]) => csvCell(name)).join(","),
    ...filteredAlerts()
      .filter((alert) => !selectedOnly || selectedHistoryIds.has(alert.id))
      .map((alert) => columns.map(([, value]) => csvCell(value(alert))).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `safepateros-sos-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteSelectedAlerts() {
  const selected = alerts.filter((alert) => selectedHistoryIds.has(alert.id));
  if (!selected.length) return;
  if (!dashboard || typeof dashboard.deleteSOSRecord !== "function") {
    toast("Supabase deletion is unavailable. No records were deleted.", true);
    return;
  }
  if (typeof window.safepaterosConfirm !== "function") {
    toast("The dashboard confirmation dialog is unavailable. No records were deleted.", true);
    return;
  }
  const confirmed = await window.safepaterosConfirm({
    title: "Delete selected SOS records?",
    message: `Permanently delete ${selected.length} selected SOS record${selected.length === 1 ? "" : "s"} from Supabase? This cannot be undone.`,
    confirmLabel: `Delete ${selected.length} record${selected.length === 1 ? "" : "s"}`,
  });
  if (!confirmed) return;

  const button = byId("alertnest-delete-selected");
  button.disabled = true;
  let deleted = 0;
  const failed = [];
  const deletedIds = new Set();
  for (const alert of selected) {
    try {
      await dashboard.deleteSOSRecord(alert.sourceTable, alert.sourceRecordId);
      selectedHistoryIds.delete(alert.id);
      deletedIds.add(alert.id);
      deleted += 1;
      if (selectedAlertId === alert.id) closeDetail();
    } catch (error) {
      console.error(`Could not delete SOS record ${alert.sourceRecordId}.`, error);
      failed.push({ alert, error });
    }
  }

  if (deleted) {
    alerts = alerts.filter((alert) => !deletedIds.has(alert.id));
    renderAll();
  } else {
    renderHistory();
  }

  if (failed.length) {
    toast(
      `Deleted ${deleted}; ${failed.length} record${failed.length === 1 ? "" : "s"} could not be deleted. Failed rows remain selected.`,
      true
    );
  } else {
    toast(`Deleted ${deleted} SOS record${deleted === 1 ? "" : "s"}.`);
  }
}

function setupControls() {
  byId("alertnest-audio-enable").addEventListener("click", async () => {
    alarmBlocked = false;
    try {
      audioContext ||= new window.AudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();
      void startAlarm();
    } catch (error) {
      alarmBlocked = true;
      console.error("SOS alarm audio could not be enabled.", error);
      toast("This browser could not enable alarm audio.", true);
    }
    syncAlarm();
    if (audioContext?.state === "running") toast("SOS alarm audio is enabled.");
  });
  byId("alertnest-alert-list").addEventListener("click", (event) => {
    const cancelButton = event.target.closest("[data-cancel-alert]");
    if (cancelButton) {
      const alert = alerts.find((item) => item.id === cancelButton.dataset.cancelAlert);
      if (alert) changeStatus(alert, "Declined");
      return;
    }
    const nearestButton = event.target.closest("[data-dispatch-nearest]");
    if (nearestButton) {
      dispatchNearest(nearestButton.dataset.dispatchNearest);
      return;
    }
    const chooseButton = event.target.closest("[data-choose-responder]");
    if (chooseButton) {
      openAlert(chooseButton.dataset.chooseResponder).then(() => {
        const alert = alerts.find((item) => item.id === chooseButton.dataset.chooseResponder);
        if (alert && alert.status === "Pending") startDispatch(alert);
      });
      return;
    }
    const detailButton = event.target.closest("[data-open-alert]");
    if (detailButton) openAlert(detailButton.dataset.openAlert);
  });
  byId("alertnest-history-select-all").addEventListener("change", (event) => {
    const visibleAlerts = filteredAlerts();
    if (event.target.checked) {
      visibleAlerts.forEach((alert) => selectedHistoryIds.add(alert.id));
    } else {
      visibleAlerts.forEach((alert) => selectedHistoryIds.delete(alert.id));
    }
    renderHistory();
  });
  byId("alertnest-history-body").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-alert]");
    if (!checkbox) return;
    if (checkbox.checked) selectedHistoryIds.add(checkbox.dataset.selectAlert);
    else selectedHistoryIds.delete(checkbox.dataset.selectAlert);
    renderHistory();
  });
  ["alertnest-filter-date", "alertnest-filter-type", "alertnest-filter-status"]
    .forEach((id) => byId(id).addEventListener("change", renderHistory));
  byId("alertnest-export-csv").addEventListener("click", exportCsv);
  byId("alertnest-export-selected").addEventListener("click", () => exportCsv(true));
  byId("alertnest-classify-selected").addEventListener("click", async () => {
    const selected = alerts.filter((alert) => selectedHistoryIds.has(alert.id));
    let classified = 0;
    for (const alert of selected) {
      try {
        await dashboard.updateSOSRecordStatus(
          alert.sourceTable,
          alert.sourceRecordId,
          "False Alarm"
        );
        classified += 1;
      } catch (error) {
        console.error(`Could not classify SOS record ${alert.sourceRecordId}.`, error);
        toast(`Could not classify ${userNameOf(alert)}: ${error.message || "Supabase update failed"}`, true);
      }
    }
    selectedHistoryIds.clear();
    toast(`${classified} SOS record${classified === 1 ? "" : "s"} classified as false alarm.`);
    renderHistory();
  });
  byId("alertnest-delete-selected").addEventListener("click", deleteSelectedAlerts);
  byId("sos-detail-close").addEventListener("click", closeDetail);
  byId("sos-cancel-dispatch").addEventListener("click", () => {
    byId("sos-dispatch-form").hidden = true;
    const alert = alerts.find((item) => item.id === selectedAlertId);
    if (alert) renderSelectedAlert(alert);
  });
  byId("sos-dispatch-form").addEventListener("submit", handleDispatchSubmit);
  byId("sos-detail-overlay").addEventListener("click", (event) => {
    if (event.target === byId("sos-detail-overlay")) closeDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("sos-detail-overlay").hidden) closeDetail();
  });
  window.setInterval(() => {
    renderAlertCards();
    if (selectedAlertId) {
      const selected = alerts.find((alert) => alert.id === selectedAlertId);
      if (selected) {
        byId("sos-detail-subtitle").textContent = `${dateText(selected.timestamp)} · ${elapsedText(selected.timestamp)}`;
      }
    }
  }, 60000);
}

function initializeAlertFeed() {
  setupControls();
  window.alertNestPendingCount = 0;
  updatePendingCount();
  if (!isSupabaseConfigured) {
    byId("alertnest-feed-status").textContent =
      "Add your Supabase project URL and anon key in supabase-config.js to connect.";
  }
  window.addEventListener("safepateros:supabase-ready", (event) => {
    dashboard = event.detail;
    byId("alertnest-feed-status").textContent = "Connected — syncing mobile SOS alerts and incident history.";
    if (typeof dashboard.subscribeToSOSRecords !== "function") {
      byId("alertnest-feed-status").textContent =
        "SOS history sync is unavailable. Reload the dashboard to update it.";
      return;
    }
    dashboard.subscribeToSOSRecords(
      (records) => {
        const nextAlerts = records
          .map(normalizeSOSRecord)
          .sort((first, second) =>
            (timestampMillis(second.timestamp) || 0) -
            (timestampMillis(first.timestamp) || 0)
          );
        const newlyPending = [];
        if (!firstSnapshot) {
          nextAlerts.forEach((alert) => {
            if (
              isMobileSOSRecord(alert) &&
              alert.status === "Pending" &&
              previousStatuses.get(alert.id) !== "Pending"
            ) newlyPending.push(alert);
          });
        }
        alerts = nextAlerts;
        previousStatuses = new Map(alerts.map((alert) => [alert.id, alert.status]));
        firstSnapshot = false;
        renderAll();
        if (newlyPending.length) {
          const banner = byId("alertnest-flash-banner");
          banner.hidden = false;
          window.setTimeout(() => { banner.hidden = true; }, 6000);
          toast(newlyPending.length === 1
            ? `New SOS from ${userNameOf(newlyPending[0])}`
            : `${newlyPending.length} new SOS alerts received`);
        }
      },
      (error) => {
        console.error("Supabase SOS records subscription failed.", error);
        byId("alertnest-feed-status").textContent = "Could not read SOS history. Check Supabase row-level security.";
        toast(`Could not load SOS alerts: ${error.message || "Supabase error"}`, true);
      }
    );
  });
  window.addEventListener("safepateros:sos-records-refreshed", (event) => {
    alerts = (event.detail || [])
      .map(normalizeSOSRecord)
      .sort((first, second) =>
        (timestampMillis(second.timestamp) || 0) -
        (timestampMillis(first.timestamp) || 0)
      );
    previousStatuses = new Map(alerts.map((alert) => [alert.id, alert.status]));
    firstSnapshot = false;
    renderAll();
  });
  window.addEventListener("safepateros:supabase-error", (event) => {
    byId("alertnest-feed-status").textContent = event.detail?.message || "Supabase initialization failed.";
  });
}

initializeAlertFeed();