import { createCollectorVisionScannerApplet } from "./collectorvision/lib/collectorvision-scanner-applet.mjs";

const button = document.querySelector("#camera-button");
const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const cardNameEl = document.querySelector("#card-name");
const cardSetEl = document.querySelector("#card-set");
const cardConfidenceEl = document.querySelector("#card-confidence");

let scanner = null;
let starting = false;
let lookupSequence = 0;

function setStatus(message, { error = false } = {}) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

function setRunningUi(running) {
  button.textContent = running ? "Parar câmera" : "Iniciar câmera";
  button.classList.toggle("is-running", running);
}

function formatProgress(data) {
  const stage = String(data?.stage ?? "").toLowerCase();
  if (stage.includes("catalog")) return "Carregando catálogo de cartas…";
  if (stage.includes("model") || stage.includes("embed") || stage.includes("detector")) {
    return "Carregando modelos de reconhecimento…";
  }
  return "Preparando reconhecimento…";
}

async function showDetectedCard(card) {
  const sequence = ++lookupSequence;
  setStatus("Carta reconhecida. Buscando o nome…");

  try {
    const response = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(card.cardId)}`);
    if (!response.ok) throw new Error(`Scryfall HTTP ${response.status}`);
    const data = await response.json();
    if (sequence !== lookupSequence) return;

    cardNameEl.textContent = data.name || card.cardId;
    const setName = data.set_name || data.set?.toUpperCase?.() || "";
    const collectorNumber = data.collector_number ? ` #${data.collector_number}` : "";
    cardSetEl.textContent = `${setName}${collectorNumber}`.trim();
    cardConfidenceEl.textContent = `${Math.round(card.score * 100)}%`;
    resultEl.hidden = false;
    setStatus("Pronto para a próxima carta.");
  } catch (error) {
    if (sequence !== lookupSequence) return;
    cardNameEl.textContent = card.cardId;
    cardSetEl.textContent = "Identificada, mas não foi possível consultar o nome no Scryfall.";
    cardConfidenceEl.textContent = `${Math.round(card.score * 100)}%`;
    resultEl.hidden = false;
    setStatus(error instanceof Error ? error.message : String(error), { error: true });
  }
}

async function ensureScanner() {
  if (scanner) return scanner;

  scanner = await createCollectorVisionScannerApplet({
    target: "#scanner",
    manifestUrl: "./collectorvision/assets/manifest.json",
    assetBasePath: "./collectorvision/assets",
    workerUrl: "./collectorvision/scanner.worker.mjs",
    autoStart: false,
    enableWebGpu: false,
    scanIntervalMs: 700,
    minCornerConfidence: 0.02,
    matchThreshold: 0.50,
    consecutiveMatches: 2,
    cooldownMs: 2800,
    groupBySecondaryId: true,
    showFpsOverlay: false,
    overlay: true,
    camera: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    onProgress(data) {
      setStatus(formatProgress(data));
    },
    onReady() {
      setStatus(scanner?.started ? "Aponte a câmera para uma carta." : "Reconhecimento pronto.");
    },
    onResult(data) {
      if (!data?.cardPresent) {
        setStatus("Procurando uma carta…");
      } else if (!data?.cornersValid) {
        setStatus("Carta encontrada. Mantenha-a inteira e parada.");
      } else if (!Number.isFinite(data?.score) || data.score < 0.50) {
        setStatus("Carta detectada. Tentando identificar…");
      }
    },
    onCardDetected(card) {
      showDetectedCard(card);
    },
    onError({ message }) {
      setStatus(message || "Erro no scanner.", { error: true });
    },
  });

  return scanner;
}

button.addEventListener("click", async () => {
  if (starting) return;

  if (scanner?.started) {
    scanner.stop();
    setRunningUi(false);
    setStatus("Câmera parada.");
    return;
  }

  starting = true;
  button.disabled = true;
  setStatus("Preparando scanner…");

  try {
    const instance = await ensureScanner();
    await instance.start();
    setRunningUi(true);
    setStatus(instance.ready ? "Aponte a câmera para uma carta." : "Câmera pronta. Carregando reconhecimento…");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingAssets = /manifest|404|fetch/i.test(message);
    setStatus(
      missingAssets
        ? "Runtime do CollectorVision não encontrado. Execute scripts/prepare-collectorvision.sh antes de servir o app."
        : message,
      { error: true },
    );
    scanner?.dispose?.();
    scanner = null;
    setRunningUi(false);
  } finally {
    starting = false;
    button.disabled = false;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("Service worker não registrado:", error);
    });
  });
}
