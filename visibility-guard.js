(() => {
  let stopping = false;

  function pageIsActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function stopMediaTracks() {
    document.querySelectorAll("video").forEach((video) => {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) return;
      stream.getTracks().forEach((track) => {
        if (track.readyState !== "ended") track.stop();
      });
      video.srcObject = null;
    });
  }

  function stopCameraIfNeeded() {
    if (pageIsActive() || stopping) return;
    stopping = true;

    try {
      const cameraButton = document.querySelector("#camera-button");
      if (cameraButton?.classList.contains("is-running")) {
        // Usa a própria lógica do app para manter o estado do scanner sincronizado.
        cameraButton.click();
      }

      // Segurança extra para navegação, minimização ou encerramento da página.
      stopMediaTracks();
    } finally {
      queueMicrotask(() => {
        stopping = false;
      });
    }
  }

  document.addEventListener("visibilitychange", stopCameraIfNeeded, { passive: true });
  window.addEventListener("blur", stopCameraIfNeeded, { passive: true });
  window.addEventListener("pagehide", stopCameraIfNeeded, { passive: true });
  window.addEventListener("beforeunload", stopCameraIfNeeded, { passive: true });

  // Cobre o caso raro de getUserMedia terminar de abrir depois que a página já perdeu foco.
  window.setInterval(stopCameraIfNeeded, 500);
})();
