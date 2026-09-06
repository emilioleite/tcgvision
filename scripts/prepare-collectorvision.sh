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

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}/lib"

echo "Baixando runtime web do CollectorVision…"
curl -fsSL "${RAW_BASE}/scanner.worker.mjs" -o "${TARGET_DIR}/scanner.worker.mjs"
curl -fsSL "${RAW_BASE}/lib/collectorvision-scanner-applet.mjs" -o "${TARGET_DIR}/lib/collectorvision-scanner-applet.mjs"
curl -fsSL "${RAW_BASE}/lib/collectorvision-catalog-v2.mjs" -o "${TARGET_DIR}/lib/collectorvision-catalog-v2.mjs"
curl -fsSL "https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_REF}/LICENSE" -o "${TARGET_DIR}/LICENSE"

echo "Baixando modelos preparados do CollectorVision…"
curl -fL "${RELEASE_BASE}/web-scanner-assets.tar.zst" -o "${TMP_DIR}/web-scanner-assets.tar.zst"
tar --zstd -xf "${TMP_DIR}/web-scanner-assets.tar.zst" -C "${TARGET_DIR}"

BUILD_ID="cv-$(date -u +%Y%m%d)"
find "${TARGET_DIR}" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.json' \) -print0 \
  | xargs -0 sed -i "s/__BUILD_ID__/${BUILD_ID}/g"

echo "CollectorVision pronto em ${TARGET_DIR}"
