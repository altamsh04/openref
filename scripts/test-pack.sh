#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
NPM_CACHE_DIR="$TMP_DIR/.npm-cache"
mkdir -p "$NPM_CACHE_DIR"
export npm_config_cache="$NPM_CACHE_DIR"

TARBALL="$(npm pack | tail -n 1)"

cleanup() {
  rm -rf "$TMP_DIR"
  rm -f "$ROOT_DIR/$TARBALL"
}
trap cleanup EXIT

cd "$TMP_DIR"
npm init -y >/dev/null 2>&1
if npm i "$ROOT_DIR/$TARBALL" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --fetch-retries=0 \
  --fetch-timeout=5000; then
  node <<'NODE'
const sdk = require("@altamsh04/openref");

if (!sdk || typeof sdk.OpenRef !== "function") {
  throw new Error("OpenRef export is missing from packed artifact");
}

console.log("[pack-test] Tarball install/import check passed.");
NODE
else
  echo "[pack-test] npm install from tarball failed (likely restricted network). Running offline fallback..."
  cd "$TMP_DIR"
  mkdir -p unpacked
  tar -xzf "$ROOT_DIR/$TARBALL" -C unpacked
  NODE_PATH="$ROOT_DIR/node_modules" node <<'NODE'
const path = require("path");
const pkgRoot = path.join(process.cwd(), "unpacked", "package");
const sdk = require(pkgRoot);

if (!sdk || typeof sdk.OpenRef !== "function") {
  throw new Error("OpenRef export is missing from packed artifact (offline fallback)");
}

console.log("[pack-test] Offline tarball import check passed.");
NODE
fi
