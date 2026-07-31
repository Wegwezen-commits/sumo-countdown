// pwa.js — registers the service worker, captures the install prompt for
// the settings/install button, and surfaces an update notification when
// a new version has been fetched in the background.
(function (global) {
  "use strict";

  let deferredPrompt = null;

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Skip when opened directly from disk (file://) or embedded via srcdoc,
    // where SW registration throws.
    if (location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").then((reg) => {
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(reg);
            }
          });
        });
      }).catch(() => { /* offline/dev environments without HTTPS — ignore */ });
    });
  }

  function showUpdateBanner(reg) {
    const banner = document.createElement("div");
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:80;background:var(--ink);color:var(--paper);padding:10px 16px;border-radius:999px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:13px;";
    banner.innerHTML = `<span>${I18n.t("updateAvailable")}</span>`;
    const btn = document.createElement("button");
    btn.textContent = I18n.t("reload");
    btn.className = "ghost-button";
    btn.style.cssText = "padding:4px 10px;";
    btn.addEventListener("click", () => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      location.reload();
    });
    banner.appendChild(btn);
    document.body.appendChild(banner);
  }

  function wireInstallButton() {
    const topBtn = document.getElementById("installButton");
    const settingsRow = document.getElementById("installRow");
    const settingsBtn = document.getElementById("installButtonSettings");
    if (!topBtn && !settingsBtn) return;

    function show() {
      if (topBtn) topBtn.classList.remove("hidden");
      if (settingsRow) settingsRow.classList.remove("hidden");
    }
    function hide() {
      if (topBtn) topBtn.classList.add("hidden");
      if (settingsRow) settingsRow.classList.add("hidden");
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      show();
    });

    async function doInstall() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hide();
    }
    if (topBtn) topBtn.addEventListener("click", doInstall);
    if (settingsBtn) settingsBtn.addEventListener("click", doInstall);

    window.addEventListener("appinstalled", hide);
  }

  global.PWA = { init() { registerServiceWorker(); wireInstallButton(); } };
})(window);
