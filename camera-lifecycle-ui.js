(() => {
  function hasLiveCameraTrack() {
    const videos = document.querySelectorAll("video");

    for (const video of videos) {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) continue;

      const hasLiveVideo = stream.getVideoTracks().some((track) => track.readyState === "live");
      if (hasLiveVideo) return true;
    }

    return false;
  }

  function syncStoppedUi(reason = "background", { updateStatus = true } = {}) {
    const button = document.querySelector("#camera-button");
    const status = document.querySelector("#status");
    const photoInfo = document.querySelector("#photo-info");

    if (button) {
      button.textContent = "Iniciar câmera";
      button.classList.remove("is-running");
      button.disabled = false;
    }

    if (updateStatus && status) {
      status.textContent = reason === "hidden"
        ? "Câmera desligada porque o app saiu da tela. Toque em “Iniciar câmera” para ativar novamente."
        : "Câmera desligada ao colocar o app em segundo plano. Toque em “Iniciar câmera” para ativar novamente.";
      status.classList.remove("error");
    }

    if (updateStatus && photoInfo) {
      photoInfo.textContent = "A câmera automática só permanece ativa enquanto o app está visível. Foto HD continua disponível.";
    }
  }

  function reconcileCameraUi({ updateStatus = true } = {}) {
    if (document.visibilityState !== "visible") return;

    const button = document.querySelector("#camera-button");
    if (!button) return;

    const uiSaysRunning = button.classList.contains("is-running") || button.textContent.includes("Parar");
    if (uiSaysRunning && !hasLiveCameraTrack()) {
      syncStoppedUi("return", { updateStatus });
    }
  }

  window.addEventListener("tcgvision-camera-stopped", (event) => {
    syncStoppedUi(event.detail?.reason);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      queueMicrotask(() => reconcileCameraUi());
      setTimeout(() => reconcileCameraUi(), 100);
      setTimeout(() => reconcileCameraUi(), 500);
    }
  }, { capture: true });

  window.addEventListener("pageshow", () => {
    setTimeout(() => reconcileCameraUi({ updateStatus: false }), 0);
  });

  window.addEventListener("focus", () => {
    setTimeout(() => reconcileCameraUi(), 0);
  });

  // Em alguns Androids o retorno da aba pode acontecer sem entregar todos os
  // eventos imediatamente. Enquanto a página estiver visível, conferimos o
  // estado real do MediaStream e corrigimos a UI se necessário.
  window.setInterval(() => {
    reconcileCameraUi({ updateStatus: false });
  }, 250);
})();