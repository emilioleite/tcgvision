(() => {
  const activeStreams = new Set();
  let stopping = false;

  function pageIsActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function rememberStream(stream) {
    if (!(stream instanceof MediaStream)) return stream;

    activeStreams.add(stream);
    const forget = () => {
      if (stream.getTracks().every((track) => track.readyState === "ended")) {
        activeStreams.delete(stream);
      }
    };

    stream.getTracks().forEach((track) => track.addEventListener("ended", forget, { once: true }));

    // Se o pedido terminou depois de a página já ter ido para segundo plano,
    // não deixe a câmera chegar a permanecer aberta.
    if (!pageIsActive()) {
      stream.getTracks().forEach((track) => track.stop());
      activeStreams.delete(stream);
    }

    return stream;
  }

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices?.getUserMedia) {
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

    mediaDevices.getUserMedia = async (...args) => {
      const stream = await originalGetUserMedia(...args);
      return rememberStream(stream);
    };
  }

  function stopAllKnownStreams() {
    for (const stream of activeStreams) {
      for (const track of stream.getTracks()) {
        if (track.readyState !== "ended") track.stop();
      }
    }
    activeStreams.clear();

    // Também cobre streams criados antes deste script em algum cache antigo.
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
      stopAllKnownStreams();

      // Mantém a UI sincronizada quando possível, mas o encerramento da câmera
      // não depende mais deste clique.
      const cameraButton = document.querySelector("#camera-button");
      if (cameraButton?.classList.contains("is-running")) {
        cameraButton.click();
      }
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
  window.addEventListener("freeze", stopCameraIfNeeded, { passive: true });

  // Fallback para navegadores móveis que atrasam algum dos eventos acima.
  window.setInterval(stopCameraIfNeeded, 250);
})();
