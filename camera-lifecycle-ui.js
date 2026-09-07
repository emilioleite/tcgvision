(() => {
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

  window.addEventListener("tcgvision-camera-stopped", (event) => {
    syncStoppedUi(event.detail?.reason);
  });

  // O runtime sempre encerra a câmera quando a página fica hidden. Ao voltar,
  // sincronizamos a interface mesmo se o navegador tiver suspendido a página
  // antes de entregar o CustomEvent de parada.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncStoppedUi("return");
    }
  }, { capture: true });

  window.addEventListener("pageshow", () => {
    if (document.visibilityState === "visible") {
      syncStoppedUi("return", { updateStatus: false });
    }
  });
})();
