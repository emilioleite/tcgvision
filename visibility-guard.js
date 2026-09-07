(() => {
  const activeStreams = new Set();
  let stopping = false;
  let nativePhotoFlowUntil = 0;

  function pageIsActive() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function nativePhotoFlowActive() {
    return Date.now() < nativePhotoFlowUntil;
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

    // Se getUserMedia terminar depois de a página já ter perdido foco,
    // encerra a câmera antes de devolver o stream ao scanner.
    if (!pageIsActive()) {
      stream.getTracks().forEach((track) => track.stop());
      activeStreams.delete(stream);
    }

    return stream;
  }

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices?.getUserMedia) {
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

    try {
      mediaDevices.getUserMedia = async (...args) => {
        const stream = await originalGetUserMedia(...args);
        return rememberStream(stream);
      };
    } catch (error) {
      console.warn("Não foi possível envolver getUserMedia:", error);
    }
  }

  function stopStream(stream) {
    if (!(stream instanceof MediaStream)) return;
    for (const track of stream.getTracks()) {
      try {
        if (track.readyState !== "ended") track.stop();
      } catch (error) {
        console.warn("Falha ao parar track de câmera:", error);
      }
    }
  }

  function stopAllKnownStreams() {
    for (const stream of activeStreams) stopStream(stream);
    activeStreams.clear();

    // Segunda via: encerra qualquer stream ainda ligado a elementos de vídeo.
    document.querySelectorAll("video").forEach((video) => {
      stopStream(video.srcObject);
      try {
        video.pause?.();
        video.srcObject = null;
        video.removeAttribute("src");
        video.load?.();
      } catch (error) {
        console.warn("Falha ao limpar vídeo da câmera:", error);
      }
    });
  }

  function markCameraSessionReset() {
    try {
      sessionStorage.setItem("tcg-camera-session-reset", "1");
    } catch {
      // sessionStorage pode estar indisponível em alguns modos privados.
    }
  }

  function hardResetPageSession() {
    markCameraSessionReset();

    // O reload é intencional: descarrega por completo o documento que possuía
    // o MediaStream. A página nova não chama getUserMedia automaticamente.
    try {
      window.location.reload();
    } catch (error) {
      console.warn("Falha ao reiniciar sessão da página:", error);
    }
  }

  function stopCameraIfNeeded() {
    if (pageIsActive() || stopping) return;
    stopping = true;

    try {
      stopAllKnownStreams();

      // Abrir o input capture também oculta a página. Nesse caso encerramos
      // qualquer stream de vídeo automático, mas preservamos o documento para
      // que a foto escolhida possa retornar ao <input type=file>.
      if (!nativePhotoFlowActive()) {
        hardResetPageSession();
      }
    } finally {
      queueMicrotask(() => {
        stopping = false;
      });
    }
  }

  // Marca o fluxo de Foto HD antes que o navegador abra a câmera nativa.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("#photo-button") : null;
    if (target) nativePhotoFlowUntil = Date.now() + 120000;
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target?.id === "photo-input") nativePhotoFlowUntil = 0;
  }, true);

  document.addEventListener("cancel", (event) => {
    if (event.target?.id === "photo-input") nativePhotoFlowUntil = 0;
  }, true);

  document.addEventListener("visibilitychange", stopCameraIfNeeded, { passive: true });
  window.addEventListener("blur", stopCameraIfNeeded, { passive: true });
  window.addEventListener("pagehide", stopCameraIfNeeded, { passive: true });
  window.addEventListener("beforeunload", stopAllKnownStreams, { passive: true });
  window.addEventListener("freeze", stopCameraIfNeeded, { passive: true });

  // Fallback para navegadores móveis que atrasam eventos de lifecycle.
  window.setInterval(stopCameraIfNeeded, 200);

  window.addEventListener("DOMContentLoaded", () => {
    try {
      if (sessionStorage.getItem("tcg-camera-session-reset") !== "1") return;
      sessionStorage.removeItem("tcg-camera-session-reset");
      const status = document.querySelector("#status");
      if (status) {
        status.textContent = "Câmera desligada porque o app saiu de foco. Toque em “Iniciar câmera” para ativá-la novamente.";
      }
    } catch {
      // Sem ação.
    }
  });
})();
