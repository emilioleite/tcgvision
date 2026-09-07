#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/collectorvision"
TMP_DIR="$(mktemp -d)"
UPSTREAM_REPO="HanClinto/CollectorVision"
UPSTREAM_REF="${COLLECTORVISION_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_REF}/examples/web_scanner"
RELEASE_BASE="https://github.com/${UPSTREAM_REPO}/releases/download/web-scanner-assets"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

command -v curl >/dev/null 2>&1 || { echo "curl é obrigatório." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar é obrigatório." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 é obrigatório." >&2; exit 1; }

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/lib"

echo "Baixando runtime web do CollectorVision…"
curl -fsSL "${RAW_BASE}/scanner.worker.mjs" -o "${TARGET_DIR}/scanner.worker.mjs"
curl -fsSL "${RAW_BASE}/lib/collectorvision-scanner-applet.mjs" -o "${TARGET_DIR}/lib/collectorvision-scanner-applet.mjs"
curl -fsSL "${RAW_BASE}/lib/collectorvision-catalog-v2.mjs" -o "${TARGET_DIR}/lib/collectorvision-catalog-v2.mjs"
curl -fsSL "https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_REF}/LICENSE" -o "${TARGET_DIR}/LICENSE"

echo "Aplicando suporte à região central, fotos HD e ciclo de vida PWA…"
python3 - "${TARGET_DIR}/lib/collectorvision-scanner-applet.mjs" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

old_capture = '''  drawCaptureFrame() {
    if (!this.stream || !this.elements.video.videoWidth) {
      return false;
    }
    this.resizeCanvas();
    this.captureCtx.drawImage(
      this.elements.video,
      0,
      0,
      this.captureCanvas.width,
      this.captureCanvas.height,
    );
    return true;
  }
'''

new_capture = '''  drawCaptureFrame() {
    if (!this.stream || !this.elements.video.videoWidth) {
      return false;
    }
    this.resizeCanvas();

    const region = this.config.captureRegion;
    if (region) {
      const videoWidth = this.elements.video.videoWidth;
      const videoHeight = this.elements.video.videoHeight;
      const x = clamp01(region.x ?? 0);
      const y = clamp01(region.y ?? 0);
      const width = Math.min(1 - x, Math.max(0.05, Number(region.width) || 1));
      const height = Math.min(1 - y, Math.max(0.05, Number(region.height) || 1));
      const sx = Math.round(x * videoWidth);
      const sy = Math.round(y * videoHeight);
      const sw = Math.max(1, Math.round(width * videoWidth));
      const sh = Math.max(1, Math.round(height * videoHeight));

      if (this.captureCanvas.width !== sw || this.captureCanvas.height !== sh) {
        this.captureCanvas.width = sw;
        this.captureCanvas.height = sh;
      }
      this.captureCtx.drawImage(this.elements.video, sx, sy, sw, sh, 0, 0, sw, sh);
      return true;
    }

    this.captureCtx.drawImage(
      this.elements.video,
      0,
      0,
      this.captureCanvas.width,
      this.captureCanvas.height,
    );
    return true;
  }
'''

old_resize = '''    if (this.captureCanvas.width !== width || this.captureCanvas.height !== height) {
      this.captureCanvas.width = width;
      this.captureCanvas.height = height;
    }
'''

new_resize = '''    if (!this.config.captureRegion && (this.captureCanvas.width !== width || this.captureCanvas.height !== height)) {
      this.captureCanvas.width = width;
      this.captureCanvas.height = height;
    }
'''

old_overlay = '''      const px = clamp01(x) * width;
      const py = clamp01(y) * height;
'''

new_overlay = '''      const region = this.config.captureRegion;
      const rx = region ? clamp01(region.x ?? 0) : 0;
      const ry = region ? clamp01(region.y ?? 0) : 0;
      const rw = region ? Math.min(1 - rx, Math.max(0.05, Number(region.width) || 1)) : 1;
      const rh = region ? Math.min(1 - ry, Math.max(0.05, Number(region.height) || 1)) : 1;
      const px = (rx + clamp01(x) * rw) * width;
      const py = (ry + clamp01(y) * rh) * height;
'''

scan_method = '''  async scanBitmap(bitmap) {
    if (!bitmap) {
      throw new Error("scanBitmap requires an ImageBitmap.");
    }
    if (!this.ready || !this.worker || this.workerBusy) {
      bitmap.close?.();
      return false;
    }

    this.workerBusy = true;
    try {
      this.worker.postMessage({ type: "frame", bitmap }, [bitmap]);
      return true;
    } catch (error) {
      this.workerBusy = false;
      bitmap.close?.();
      this.handleError(error);
      return false;
    }
  }

  async tick() {
'''

old_mount = '''    this.elements = this.createElements();
    this.mount();
  }
'''

new_mount = '''    this.elements = this.createElements();
    this.mount();

    // Em PWA/mobile, visibilitychange:hidden é o último evento confiável
    // antes de o app ir para segundo plano. O próprio scanner possui a
    // referência exata do MediaStream, então encerra a câmera diretamente.
    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && this.started) {
        this.stop("hidden");
      }
    };
    this.onFreeze = () => {
      if (this.started) this.stop("freeze");
    };
    this.onPageHide = () => {
      if (this.started) this.stop("pagehide");
    };

    document.addEventListener("visibilitychange", this.onVisibilityChange, { capture: true });
    document.addEventListener("freeze", this.onFreeze, { capture: true });
    window.addEventListener("pagehide", this.onPageHide, { capture: true });
  }
'''

old_stop = '''  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    this.started = false;
    this.workerBusy = false;
    this.lastFpsTimestamp = null;
    this.fpsEma = null;
    for (const track of this.stream?.getTracks?.() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.elements.video.srcObject = null;
    this.setStatus("Stopped.");
  }
'''

new_stop = '''  stop(reason = "manual") {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }

    const stream = this.stream;
    this.started = false;
    this.workerBusy = false;
    this.lastFpsTimestamp = null;
    this.fpsEma = null;
    this.stream = null;

    try {
      this.elements.video.pause();
      this.elements.video.srcObject = null;
    } catch {
      // Sem ação: ainda encerramos as tracks abaixo.
    }

    for (const track of stream?.getTracks?.() ?? []) {
      try {
        if (track.readyState !== "ended") track.stop();
      } catch {
        // Ignora uma track que já tenha sido finalizada pelo navegador.
      }
    }

    this.setStatus("Stopped.");

    if (reason !== "manual" && reason !== "dispose") {
      window.dispatchEvent(new CustomEvent("tcgvision-camera-stopped", {
        detail: { reason },
      }));
    }
  }
'''

old_dispose = '''  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.target.replaceChildren();
  }
'''

new_dispose = '''  dispose() {
    this.stop("dispose");
    document.removeEventListener("visibilitychange", this.onVisibilityChange, true);
    document.removeEventListener("freeze", this.onFreeze, true);
    window.removeEventListener("pagehide", this.onPageHide, true);
    this.worker?.terminate();
    this.worker = null;
    this.target.replaceChildren();
  }
'''

for old, new, label in [
    (old_capture, new_capture, "drawCaptureFrame"),
    (old_resize, new_resize, "resizeCanvas"),
    (old_overlay, new_overlay, "drawOverlay"),
    ("  async tick() {\n", scan_method, "scanBitmap"),
    (old_mount, new_mount, "lifecycle setup"),
    (old_stop, new_stop, "stop lifecycle"),
    (old_dispose, new_dispose, "dispose lifecycle"),
]:
    if old not in text:
        raise SystemExit(f"CollectorVision upstream mudou: trecho {label} não encontrado")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
PY

echo "Baixando modelos preparados do CollectorVision…"
curl -fL "${RELEASE_BASE}/web-scanner-assets.tar.zst" -o "${TMP_DIR}/web-scanner-assets.tar.zst"
tar --zstd -xf "${TMP_DIR}/web-scanner-assets.tar.zst" -C "${TARGET_DIR}"

BUILD_ID="cv-$(date -u +%Y%m%d%H%M%S)"
find "${TARGET_DIR}" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.json' \) -print0 \
  | xargs -0 sed -i "s/__BUILD_ID__/${BUILD_ID}/g"

echo "CollectorVision pronto em ${TARGET_DIR}"
