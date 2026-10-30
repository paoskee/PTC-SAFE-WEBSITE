import { isSupabaseConfigured, supabase, isAdminRow } from "./supabase-config.js";

async function runDiagnostics(userId, profile) {
  try {
    const isAdmin = isAdminRow(profile);
    const tables = ["alerts", "users", "broadcasts", "emergency_requests", "incidents"];
    const counts = {};
    await Promise.all(
      tables.map(async (table) => {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        counts[table] = error ? `error: ${error.message}` : count;
      })
    );
    console.group("SafePateros Admin Diagnostics");
    console.log("Session User ID:", userId);
    console.log("Users Profile ID:", profile?.id || "(none)");
    console.log("isAdmin Result:", isAdmin);
    console.log("Table Head Counts:", counts);
    console.groupEnd();
  } catch (err) {
    console.warn("Diagnostics error:", err);
  }
}

async function initializeDashboardSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    window.location.replace("login.html");
    return;
  }

  let authorizedUserId = null;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (
      !session ||
      (authorizedUserId && session.user.id !== authorizedUserId)
    ) {
      window.location.replace("login.html");
    }
  });

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    authorizedUserId = user.id;

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!isAdminRow(profile)) {
      subscription.unsubscribe();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.replace("login.html?accessDenied=1");
      return;
    }
    void runDiagnostics(user.id, profile);

    try {
      const service = await import("./admin-service.js");
      document.documentElement.classList.remove("auth-pending");
      window.dispatchEvent(
        new CustomEvent("safepateros:supabase-ready", {
          detail: {
            subscribeToBroadcasts: service.subscribeToBroadcasts,
            subscribeToCampusBroadcasts: service.subscribeToCampusBroadcasts,
            subscribeToEmergencyRequests: service.subscribeToEmergencyRequests,
            subscribeToAlerts: service.subscribeToAlerts,
            subscribeToSOSRecords: service.subscribeToSOSRecords,
            subscribeToIncidents: service.subscribeToIncidents,
            subscribeToUsers: service.subscribeToUsers,
            refreshDashboardData: service.refreshDashboardData,
            getActiveAlerts: service.getActiveAlerts,
            getStaffResponders: service.getStaffResponders,
            acceptAndDispatchAlert: service.acceptAndDispatchAlert,
            dispatchSOSRecord: service.dispatchSOSRecord,
            updateSOSRecordStatus: service.updateSOSRecordStatus,
            updateSOSResponderLocation: service.updateSOSResponderLocation,
            deleteSOSRecord: service.deleteSOSRecord,
            updateAlertStatus: service.updateAlertStatus,
            deleteAlertRecord: service.deleteAlertRecord,
            updateAlertResponderLocation: service.updateAlertResponderLocation,
            acceptEmergencyRequest: service.acceptEmergencyRequest,
            cancelEmergencyRequest: service.cancelEmergencyRequest,
            resolveEmergencyRequest: service.resolveEmergencyRequest,
            cancelAlertRecord: service.cancelAlertRecord,
            updateEmergencyResponderLocation:
              service.updateEmergencyResponderLocation,
            sendBroadcast: service.sendBroadcast,
            adminId: user.id,
            signOut: async () => {
              const { error: signOutError } = await supabase.auth.signOut();
              if (signOutError) throw signOutError;
            },
          },
        })
      );
    } catch (error) {
      console.error("Supabase dashboard initialization failed.", error);
      document.documentElement.classList.remove("auth-pending");
      window.dispatchEvent(
        new CustomEvent("safepateros:supabase-error", { detail: error })
      );
    }
  } catch (error) {
    console.error("Supabase authentication initialization failed.", error);
    window.dispatchEvent(
      new CustomEvent("safepateros:supabase-error", { detail: error })
    );
    window.location.replace("login.html?authError=1");
  }

  window.addEventListener("pagehide", () => subscription.unsubscribe(), {
    once: true,
  });
}

initializeDashboardSupabase();
