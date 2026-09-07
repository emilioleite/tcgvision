(() => {
  const installButton = document.querySelector("#install-button");
  if (!installButton) return;

  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches
      || window.navigator.standalone === true;
  }

  function hideInstallButton() {
    installButton.hidden = true;
    installButton.disabled = false;
  }

  if (isStandalone()) {
    hideInstallButton();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone()) installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) return;

    installButton.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (error) {
      console.warn("Falha ao abrir instalação da PWA:", error);
    } finally {
      deferredPrompt = null;
      hideInstallButton();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideInstallButton();
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", (event) => {
    if (event.matches) hideInstallButton();
  });
})();
