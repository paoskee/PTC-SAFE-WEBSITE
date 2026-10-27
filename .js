[1mdiff --git a/admin-alerts.js b/admin-alerts.js[m
[1mindex 14ba065..32548a1 100644[m
[1m--- a/admin-alerts.js[m
[1m+++ b/admin-alerts.js[m
[36m@@ -431,7 +431,7 @@[m [mfunction renderAlertCards() {[m
     return;[m
   }[m
   list.innerHTML = pendingAlerts.map((alert) => `[m
[31m-    <article class="sos-alert-item">[m
[32m+[m[32m    <article class="sos-alert-item" id="alert-card-${escapeHtml(alert.id)}">[m
       <button class="sos-alert-card" type="button" data-open-alert="${escapeHtml(alert.id)}">[m
         <div class="sos-alert-card-head">[m
           <strong>${escapeHtml(userNameOf(alert))}</strong>[m
