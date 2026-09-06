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
const SPEECH_LANGUAGE = "pt-BR";
const CLEAR_FRAMES_TO_REARM = 2;

const COLLECTORVISION_BASE = new URL("./collectorvision/", window.location.href);
const COLLECTORVISION_MANIFEST = new URL("assets/manifest.json", COLLECTORVISION_BASE).href;
const COLLECTORVISION_ASSETS = new URL("assets", COLLECTORVISION_BASE).href.replace(/\/$/, "");
const COLLECTORVISION_WORKER = new URL("scanner.worker.mjs", COLLECTORVISION_BASE).href;

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
let narrationLocked = false;
let awaitingCardRemoval = false;
let clearFrameCount = 0;

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

function cleanForSpeech(value) {
  return String(value ?? "")
    .replace(/[{}]/g, " ")
    .replace(/\//g, " ")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function manaForSpeech(value) {
  const mana = String(value ?? "");
  if (!mana) return "";

  const symbols = [...mana.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (!symbols.length) return cleanForSpeech(mana);

  const names = {
    W: "uma mana branca",
    U: "uma mana azul",
    B: "uma mana preta",
    R: "uma mana vermelha",
    G: "uma mana verde",
    C: "uma mana incolor",
    X: "X",
  };

  return symbols.map((symbol) => {
    if (names[symbol]) return names[symbol];
    if (/^\d+$/.test(symbol)) {
      const amount = Number(symbol);
      return amount === 1 ? "uma mana genérica" : `${amount} manas genéricas`;
    }
    if (symbol.includes("/")) {
      return symbol.split("/").map((part) => names[part] || part).join(" ou ");
    }
    return symbol;
  }).join(", ");
}

function portugueseTypeLine(typeLine) {
  let text = String(typeLine ?? "");
  const replacements = [
    ["Legendary", "Lendário"],
    ["Basic", "Básico"],
    ["Snow", "Nevado"],
    ["Creature", "Criatura"],
    ["Artifact", "Artefato"],
    ["Enchantment", "Encantamento"],
    ["Instant", "Mágica instantânea"],
    ["Sorcery", "Feitiço"],
    ["Planeswalker", "Planeswalker"],
    ["Land", "Terreno"],
    ["Battle", "Batalha"],
    ["Equipment", "Equipamento"],
    ["Vehicle", "Veículo"],
    ["Aura", "Aura"],
    ["Saga", "Saga"],
    ["Token", "Ficha"],
  ];

  for (const [from, to] of replacements) {
    text = text.replace(new RegExp(`\\b${from}\\b`, "gi"), to);
  }
  return text;
}

function localRulesSummary(oracleText) {
  const source = String(oracleText ?? "");
  if (!source) return "";

  const parts = [];
  const keywordMap = [
    [/\bflying\b/i, "Tem voar."],
    [/\bvigilance\b/i, "Tem vigilância."],
    [/\btrample\b/i, "Tem atropelar."],
    [/\bhaste\b/i, "Tem ímpeto."],
    [/\bdeathtouch\b/i, "Tem toque mortífero."],
    [/\blifelink\b/i, "Tem vínculo com a vida."],
    [/\breach\b/i, "Tem alcance."],
    [/\bmenace\b/i, "Tem ameaçar."],
    [/\bfirst strike\b/i, "Tem iniciativa."],
    [/\bdouble strike\b/i, "Tem golpe duplo."],
    [/\bhexproof\b/i, "Não pode ser alvo de mágicas ou habilidades controladas pelos oponentes."],
    [/\bindestructible\b/i, "É indestrutível."],
  ];

  for (const [pattern, sentence] of keywordMap) {
    if (pattern.test(source)) parts.push(sentence);
  }

  const damage = source.match(/deals? (\d+) damage to any target/i);
  if (damage) parts.push(`Causa ${damage[1]} pontos de dano a qualquer alvo.`);

  const gainLife = source.match(/you gain (\d+) life/i);
  if (gainLife) parts.push(`Você ganha ${gainLife[1]} pontos de vida.`);

  if (/draw a card/i.test(source)) parts.push("Você compra uma carta.");
  if (/draw two cards/i.test(source)) parts.push("Você compra duas cartas.");
  if (/destroy target/i.test(source)) parts.push("Possui um efeito que destrói um alvo.");
  if (/exile target/i.test(source)) parts.push("Possui um efeito que exila um alvo.");
  if (/create .* token/i.test(source)) parts.push("Possui um efeito que cria uma ficha.");
  if (/when .* enters/i.test(source) || /when this .* enters/i.test(source)) {
    parts.push("Possui uma habilidade que é ativada quando entra no campo de batalha.");
  }
  if (/whenever/i.test(source)) parts.push("Possui uma habilidade desencadeada.");
  if (/\{T\}:/i.test(source)) parts.push("Possui uma habilidade ativada ao virar a carta.");

  if (!parts.length) {
    return "Esta carta possui texto de regras adicional, mas não encontrei uma impressão oficial em português para narrá-lo com segurança.";
  }

  return [...new Set(parts)].join(" ");
}

function narrationForCard(data, { officialPortuguese = false } = {}) {
  const name = data.printed_name || data.name || "Carta reconhecida";
  const mana = manaForSpeech(data.mana_cost);
  const typeLine = officialPortuguese
    ? (data.printed_type_line || data.type_line || "")
    : portugueseTypeLine(data.type_line || "");
  const rulesText = officialPortuguese
    ? (data.printed_text || data.oracle_text || "")
    : localRulesSummary(data.oracle_text || "");

  return [
    cleanForSpeech(name),
    mana ? `Custo de mana: ${mana}` : "",
    typeLine ? `Tipo: ${cleanForSpeech(typeLine)}` : "",
    cleanForSpeech(rulesText),
  ].filter(Boolean).join(". ");
}

function selectPortugueseVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  return voices.find((voice) => String(voice.lang).toLowerCase() === "pt-br")
    || voices.find((voice) => String(voice.lang).toLowerCase().startsWith("pt"))
    || null;
}

function releaseNarrationLock() {
  narrationLocked = false;
  if (clearFrameCount >= CLEAR_FRAMES_TO_REARM) {
    awaitingCardRemoval = false;
    setStatus("Pronto para a próxima carta.");
  } else {
    setStatus("Remova a carta para ler a próxima.");
  }
}

function speakPortuguese(text) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    releaseNarrationLock();
    return;
  }
  if (!text) {
    releaseNarrationLock();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANGUAGE;
  utterance.rate = 0.95;
  utterance.pitch = 1;

  const voice = selectPortugueseVoice();
  if (voice) utterance.voice = voice;

  utterance.onstart = () => {
    narrationLocked = true;
    setStatus("Narrando carta…");
  };
  utterance.onend = releaseNarrationLock;
  utterance.onerror = releaseNarrationLock;

  window.speechSynthesis.speak(utterance);
}

function escapeScryfallQuotedName(name) {
  return String(name ?? "").replace(/(["\\])/g, "\\$1");
}

async function findPortuguesePrinting(data) {
  if (String(data?.lang ?? "").toLowerCase() === "pt" && (data?.printed_text || data?.printed_type_line)) {
    return data;
  }

  const name = String(data?.name ?? "").trim();
  if (!name) return null;

  try {
    const query = `!\"${escapeScryfallQuotedName(name)}\" lang:pt`;
    const url = new URL("https://api.scryfall.com/cards/search");
    url.searchParams.set("q", query);
    url.searchParams.set("unique", "prints");
    url.searchParams.set("order", "released");
    url.searchParams.set("dir", "desc");

    const response = await fetch(url);
    if (!response.ok) return null;
    const result = await response.json();
    return Array.isArray(result?.data) ? (result.data[0] || null) : null;
  } catch {
    return null;
  }
}

async function narrateCard(data, fallbackCardId) {
  if (narrationLocked || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) return;

  const key = String(data?.oracle_id || data?.id || fallbackCardId || data?.name || "");
  const now = Date.now();
  if (key && key === lastNarratedKey && now - lastNarratedAt < 12000) return;

  // Trava antes da busca da impressão em português para impedir corridas entre scans.
  narrationLocked = true;
  lastNarratedKey = key;
  lastNarratedAt = now;

  try {
    const portugueseCard = await findPortuguesePrinting(data);
    const narration = portugueseCard
      ? narrationForCard(portugueseCard, { officialPortuguese: true })
      : narrationForCard(data, { officialPortuguese: false });

    speakPortuguese(narration);
  } catch (error) {
    console.warn("Falha ao preparar narração:", error);
    releaseNarrationLock();
  }
}

async function showDetectedCard(card) {
  if (narrationLocked || awaitingCardRemoval) return;

  awaitingCardRemoval = true;
  clearFrameCount = 0;

  const sequence = ++lookupSequence;
  setStatus("Carta reconhecida. Buscando os dados…");

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
    narrateCard(data, card.cardId);
  } catch (error) {
    if (sequence !== lookupSequence) return;
    awaitingCardRemoval = false;
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

      if (data?.cardPresent) {
        clearFrameCount = 0;
      } else {
        clearFrameCount += 1;
        if (!narrationLocked && awaitingCardRemoval && clearFrameCount >= CLEAR_FRAMES_TO_REARM) {
          awaitingCardRemoval = false;
          setStatus("Pronto para a próxima carta.");
          return;
        }
      }

      if (narrationLocked) {
        setStatus("Narrando carta…");
        return;
      }

      if (awaitingCardRemoval) {
        setStatus("Remova a carta para ler a próxima.");
        return;
      }

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
      if (narrationLocked || awaitingCardRemoval) return;
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
    narrationLocked = false;
    awaitingCardRemoval = false;
    clearFrameCount = 0;
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
