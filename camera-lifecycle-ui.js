(() => {
  function syncStoppedUi(reason = "background") {
    const button = document.querySelector("#camera-button");
    const status = document.querySelector("#status");
    const photoInfo = document.querySelector("#photo-info");

    if (button) {
      button.textContent = "Iniciar câmera";
      button.classList.remove("is-running");
      button.disabled = false;
    }

    if (status) {
      status.textContent = reason === "hidden"
        ? "Câmera desligada porque o app saiu da tela. Toque em “Iniciar câmera” para ativar novamente."
        : "Câmera desligada ao colocar o app em segundo plano. Toque em “Iniciar câmera” para ativar novamente.";
      status.classList.remove("error");
    }

    if (photoInfo) {
      photoInfo.textContent = "A câmera automática só permanece ativa enquanto o app está visível. Foto HD continua disponível.";
    }
  }

  window.addEventListener("tcgvision-camera-stopped", (event) => {
    syncStoppedUi(event.detail?.reason);
  });
})();
