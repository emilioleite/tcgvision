import { createCollectorVisionScannerApplet } from "./collectorvision/lib/collectorvision-scanner-applet.mjs";

const button = document.querySelector("#camera-button");
const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const cardNameEl = document.querySelector("#card-name");
const cardSetEl = document.querySelector("#card-set");
const cardConfidenceEl = document.querySelector("#card-confidence");
const diagPresentEl = document.querySelector("#diag-present");
const diagCornersEl = document.querySelector("#diag-corners");
const diagCornerScoreEl = document.querySelector("#diag-corner-score");
const diagMatchScoreEl = document.querySelector("#diag-match-score");
const diagCardIdEl = document.querySelector("#diag-card-id");

const MATCH_THRESHOLD = 0.45;

const COLLECTORVISION_BASE = new URL("./collectorvision/", window.location.href);
const COLLECTORVISION_MANIFEST = new URL("assets/manifest.json", COLLECTORVISION_BASE).href;
const COLLECTORVISION_ASSETS = new URL("assets", COLLECTORVISION_BASE).href.replace(/\/$/, "");
const COLLECTORVISION_WORKER = new URL("scanner.worker.mjs", COLLECTORVISION_BASE).href;

// Região real analisada pelo modelo. Ela é propositalmente um pouco maior
// que a moldura visível para o jogador não precisar encaixar a carta exatamente.
const CAPTURE_REGION = {
  x: 0.30,
  y: 0.04,
  width: 0.40,
  height: 0.92,
};

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

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function updateDiagnostics(data = {}) {
  diagPresentEl.textContent = data.cardPresent === true ? "SIM" : data.cardPresent === false ? "NÃO" : "—";
  diagCornersEl.textContent = data.cornersValid === true ? "SIM" : data.cornersValid === false ? "NÃO" : "—";
  diagCornerScoreEl.textContent = formatNumber(data.confidence);
  diagMatchScoreEl.textContent = formatNumber(data.score);
  diagCardIdEl.textContent = data.cardId || "—";
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
    manifestUrl: COLLECTORVISION_MANIFEST,
    assetBasePath: COLLECTORVISION_ASSETS,
    workerUrl: COLLECTORVISION_WORKER,
    autoStart: false,
    enableWebGpu: false,
    scanIntervalMs: 400,
    minCornerConfidence: 0.02,
    matchThreshold: MATCH_THRESHOLD,
    consecutiveMatches: 1,
    cooldownMs: 2200,
    groupBySecondaryId: true,
    showFpsOverlay: true,
    overlay: true,
    captureRegion: CAPTURE_REGION,
    camera: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    onProgress(data) {
      setStatus(formatProgress(data));
    },
    onReady() {
      setStatus(scanner?.started
        ? "Coloque a carta inteira dentro da moldura. A captura é automática."
        : "Reconhecimento pronto.");
    },
    onResult(data) {
      updateDiagnostics(data);

      if (!data?.cardPresent) {
        setStatus("Aguardando uma carta dentro da moldura…");
      } else if (!data?.cornersValid) {
        setStatus("Vi uma carta. Mantenha-a inteira e parada dentro da área.");
      } else if (!Number.isFinite(data?.score) || data.score < MATCH_THRESHOLD) {
        setStatus(`Foto capturada automaticamente. Identificando… score ${formatNumber(data?.score)}.`);
      }
    },
    onCardDetected(card) {
      updateDiagnostics(card.raw || card);
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
    setStatus(instance.ready
      ? "Coloque a carta inteira dentro da moldura. A captura é automática."
      : "Câmera pronta. Carregando reconhecimento…");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingAssets = /manifest|404|fetch/i.test(message);
    setStatus(
      missingAssets
        ? "Não foi possível carregar os modelos do CollectorVision. Atualize a página e tente novamente."
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

updateDiagnostics();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("Service worker não registrado:", error);
    });
  });
}
