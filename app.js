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
let lastNarratedKey = "";
let lastNarratedAt = 0;

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

function speechLanguageForCard(data) {
  const lang = String(data?.lang ?? "en").toLowerCase();
  if (lang === "pt") return "pt-BR";
  if (lang === "es") return "es-ES";
  if (lang === "fr") return "fr-FR";
  if (lang === "de") return "de-DE";
  if (lang === "it") return "it-IT";
  if (lang === "ja") return "ja-JP";
  return "en-US";
}

function cleanForSpeech(value) {
  return String(value ?? "")
    .replace(/[{}]/g, " ")
    .replace(/\//g, " ")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function narrationForCard(data) {
  const name = data.printed_name || data.name || "Carta reconhecida";
  const mana = cleanForSpeech(data.mana_cost);
  const typeLine = data.printed_type_line || data.type_line || "";
  const text = data.printed_text || data.oracle_text || "";

  return [
    cleanForSpeech(name),
    mana ? `Mana ${mana}` : "",
    cleanForSpeech(typeLine),
    cleanForSpeech(text),
  ].filter(Boolean).join(". ");
}

function narrateCard(data, fallbackCardId) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;

  const key = String(data?.oracle_id || data?.id || fallbackCardId || data?.name || "");
  const now = Date.now();

  // Evita repetir a narração se a mesma carta continuar parada diante da câmera.
  if (key && key === lastNarratedKey && now - lastNarratedAt < 12000) return;

  const text = narrationForCard(data);
  if (!text) return;

  lastNarratedKey = key;
  lastNarratedAt = now;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLanguageForCard(data);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function showDetectedCard(card) {
  const sequence = ++lookupSequence;
  setStatus("Carta reconhecida. Buscando o nome…");

  try {
    const response = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(card.cardId)}`);
    if (!response.ok) throw new Error(`Scryfall HTTP ${response.status}`);
    const data = await response.json();
    if (sequence !== lookupSequence) return;

    cardNameEl.textContent = data.printed_name || data.name || card.cardId;
    const setName = data.set_name || data.set?.toUpperCase?.() || "";
    const collectorNumber = data.collector_number ? ` #${data.collector_number}` : "";
    cardSetEl.textContent = `${setName}${collectorNumber}`.trim();
    cardConfidenceEl.textContent = `${Math.round(card.score * 100)}%`;
    resultEl.hidden = false;
    setStatus("Pronto para a próxima carta.");
    narrateCard(data, card.cardId);
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
    window.speechSynthesis?.cancel?.();
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
