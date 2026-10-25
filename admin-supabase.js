import { isSupabaseConfigured, supabase } from "./supabase-config.js";

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
      .select("data")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.data?.isAdmin !== true) {
      subscription.unsubscribe();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.replace("login.html?accessDenied=1");
      return;
    }

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
