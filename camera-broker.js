(() => {
  const VERSION = "19";
  const control = document.querySelector("#camera-control");
  const permissionButton = document.querySelector("#camera-permission-button");
  const scannerButton = document.querySelector("#camera-button");
  const photoButton = document.querySelector("#photo-button");
  const statusEl = document.querySelector("#status");
  const mediaDevices = navigator.mediaDevices;
  const originalGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices) ?? null;
  const activeStreams = new Set();
  const tabId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("tcgvision-camera-v1") : null;

  let nativeControlEnabled = false;
  let brokerStream = null;
  let shuttingDown = false;

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function isLive(stream) {
    return stream instanceof MediaStream
      && stream.getTracks().some((track) => track.readyState === "live");
  }

  function rememberStream(stream) {
    if (!(stream instanceof MediaStream)) return stream;
    activeStreams.add(stream);

    const forgetIfEnded = () => {
      if (stream.getTracks().every((track) => track.readyState === "ended")) {
        activeStreams.delete(stream);
        if (stream === brokerStream) brokerStream = null;
        syncVisibleControl();
      }
    };

    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", forgetIfEnded, { once: true });
    });

    return stream;
  }

  function stopStream(stream) {
    if (!(stream instanceof MediaStream)) return;
    stream.getTracks().forEach((track) => {
      try {
        if (track.readyState !== "ended") track.stop();
      } catch (error) {
        console.warn("Falha ao encerrar track:", error);
      }
    });
  }

  function stopDomVideoStreams() {
    document.querySelectorAll("video").forEach((video) => {
      stopStream(video.srcObject);
      try {
        video.pause?.();
        video.srcObject = null;
      } catch {
        // Sem ação.
      }
    });
  }

  function scannerLooksRunning() {
    return scannerButton?.classList.contains("is-running") === true;
  }

  function syncVisibleControl() {
    if (!permissionButton) return;
    const active = isLive(brokerStream)
      || [...activeStreams].some(isLive)
      || scannerLooksRunning();
    permissionButton.textContent = active ? "Parar câmera" : "Iniciar câmera";
    permissionButton.classList.toggle("is-running", active);
    permissionButton.dataset.cameraState = active ? "active" : "idle";
  }

  function syncScannerStop() {
    if (!scannerLooksRunning()) return;
    try {
      scannerButton.click();
    } catch (error) {
      console.warn("Falha ao sincronizar parada do scanner:", error);
    }
  }

  function shutdownCamera({ notifyPeers = false, message = null } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      if (notifyPeers) {
        channel?.postMessage({ type: "stop-camera", sender: tabId });
      }

      // Primeiro pede ao próprio app para encerrar seu scanner.
      syncScannerStop();

      // Depois encerra diretamente qualquer referência de MediaStream conhecida.
      stopStream(brokerStream);
      brokerStream = null;
      for (const stream of activeStreams) stopStream(stream);
      activeStreams.clear();
      stopDomVideoStreams();
      syncVisibleControl();

      if (message) setStatus(message);
    } finally {
      shuttingDown = false;
    }
  }

  function installGetUserMediaBroker(fn) {
    if (!mediaDevices || typeof fn !== "function") return false;

    try {
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        writable: true,
        value: fn,
      });
      return mediaDevices.getUserMedia === fn;
    } catch {
      try {
        mediaDevices.getUserMedia = fn;
        return mediaDevices.getUserMedia === fn;
      } catch {
        return false;
      }
    }
  }

  function unwrapUnsupportedControl() {
    if (!control || !permissionButton || control.parentNode == null) return;
    try {
      control.replaceWith(permissionButton);
    } catch {
      // Em navegador antigo, deixar o elemento desconhecido como wrapper é inofensivo.
    }
  }

  if (originalGetUserMedia) {
    const nativeElementSupported = "HTMLUserMediaElement" in window
      && control
      && typeof control.setConstraints === "function";

    if (nativeElementSupported) {
      try {
        control.setConstraints({
          video: {
            facingMode: "environment",
            width: 1280,
            height: 720,
          },
          audio: false,
        });

        const brokeredGetUserMedia = async (constraints = {}) => {
          const wantsVideo = Boolean(constraints?.video);
          const wantsAudio = Boolean(constraints?.audio);

          if (nativeControlEnabled && wantsVideo && !wantsAudio) {
            if (isLive(brokerStream)) return brokerStream;
            throw new DOMException(
              "Ative a câmera pelo controle visível da página.",
              "NotAllowedError",
            );
          }

          const stream = await originalGetUserMedia(constraints);
          return rememberStream(stream);
        };

        nativeControlEnabled = installGetUserMediaBroker(brokeredGetUserMedia);
      } catch (error) {
        console.warn("Controle nativo de câmera indisponível:", error);
        nativeControlEnabled = false;
      }
    }

    if (!nativeControlEnabled) {
      // Fallback: mantém o getUserMedia tradicional, mas ainda rastreia os streams
      // para encerrá-los ao sair da página.
      unwrapUnsupportedControl();
      const trackedGetUserMedia = async (...args) => {
        const stream = await originalGetUserMedia(...args);
        return rememberStream(stream);
      };
      installGetUserMediaBroker(trackedGetUserMedia);
    }
  }

  if (nativeControlEnabled && control) {
    control.addEventListener("stream", () => {
      const stream = control.stream;
      if (!(stream instanceof MediaStream)) return;

      // Este projeto nunca precisa do microfone.
      stream.getAudioTracks().forEach((track) => track.stop());
      brokerStream = rememberStream(stream);
      channel?.postMessage({ type: "camera-claimed", sender: tabId });
      syncVisibleControl();
      setStatus("Câmera autorizada. Iniciando reconhecimento…");

      // O app legado inicia somente depois que o Chrome entregou o stream.
      if (!scannerLooksRunning()) scannerButton?.click();
    });

    control.addEventListener("error", () => {
      brokerStream = null;
      syncVisibleControl();
      setStatus(`Não foi possível abrir a câmera: ${control.error?.name || "erro de permissão"}.`);
    });

    control.addEventListener("cancel", () => {
      brokerStream = null;
      syncVisibleControl();
      setStatus("Permissão da câmera cancelada.");
    });
  }

  permissionButton?.addEventListener("click", (event) => {
    if (isLive(brokerStream) || scannerLooksRunning()) {
      event.preventDefault();
      event.stopPropagation();
      shutdownCamera({ message: "Câmera desligada." });
      return;
    }

    if (nativeControlEnabled) {
      // O clique físico segue para o <usermedia>, que controla a permissão.
      setStatus("Aguardando autorização da câmera…");
      return;
    }

    // Fallback para navegadores sem <usermedia>.
    event.preventDefault();
    event.stopPropagation();
    scannerButton?.click();
    setTimeout(syncVisibleControl, 100);
  }, true);

  // Antes de abrir a câmera fotográfica nativa, libera qualquer stream contínuo.
  photoButton?.addEventListener("click", () => {
    if (isLive(brokerStream) || scannerLooksRunning() || [...activeStreams].some(isLive)) {
      shutdownCamera();
    }
  }, true);

  const scannerObserver = scannerButton
    ? new MutationObserver(syncVisibleControl)
    : null;
  if (scannerObserver && scannerButton) {
    scannerObserver.observe(scannerButton, {
      attributes: true,
      attributeFilter: ["class", "disabled"],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  channel?.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.sender === tabId) return;
    if (data.type === "camera-claimed" || data.type === "stop-camera") {
      shutdownCamera();
    }
  });

  function stopForBackground() {
    if (document.visibilityState !== "hidden") return;
    shutdownCamera({
      notifyPeers: true,
      message: "Câmera desligada porque a página saiu de primeiro plano. Toque em “Iniciar câmera” para usar novamente.",
    });
  }

  document.addEventListener("visibilitychange", stopForBackground, { passive: true });
  window.addEventListener("pagehide", () => shutdownCamera({ notifyPeers: true }), { passive: true });
  window.addEventListener("freeze", () => shutdownCamera({ notifyPeers: true }), { passive: true });

  // Checagem auxiliar; não tenta manter a câmera viva em segundo plano.
  window.setInterval(() => {
    if (document.visibilityState === "hidden") stopForBackground();
  }, 500);

  document.documentElement.dataset.cameraBroker = nativeControlEnabled ? "usermedia" : "legacy";
  document.documentElement.dataset.tcgVersion = VERSION;
  syncVisibleControl();
})();
