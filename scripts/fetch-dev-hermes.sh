#!/usr/bin/env bash
# Drop the published Hermes V1 prebuilt at ./.hermes/hermes so a clone can
# run `pnpm argus examples/math.test.ts` without ARGUS_HERMES.
#
# This repository has no react-native install, so the product provisioning
# chain never fires here. The published archive is the contributor path.
set -euo pipefail

VERSION="250829098.0.16"
TAG="hermes-bin-v${VERSION}"
BASE="https://github.com/malopezr7/argus/releases/download/${TAG}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${ROOT}/.hermes"
DEST="${DEST_DIR}/hermes"

os="$(uname -s)"
arch="$(uname -m)"
case "${os}" in
Darwin) plat="darwin" ;;
Linux) plat="linux" ;;
*)
  echo "unsupported OS: ${os} (Windows is not supported)" >&2
  exit 2
  ;;
esac
case "${arch}" in
arm64 | aarch64) cpu="arm64" ;;
x86_64) cpu="x64" ;;
*)
  echo "unsupported arch: ${arch}" >&2
  exit 2
  ;;
esac

asset="hermes-${VERSION}-${plat}-${cpu}.tar.gz"
sha_file="${asset}.sha256"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
cd "${tmp}"

echo "fetching ${asset}"
curl -fsSL -o "${asset}" "${BASE}/${asset}"
curl -fsSL -o "${sha_file}" "${BASE}/${sha_file}"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c "${sha_file}"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c "${sha_file}"
else
  echo "need shasum or sha256sum to verify the download" >&2
  exit 2
fi

mkdir -p "${DEST_DIR}"
tar -xzf "${asset}" hermes
chmod +x hermes
mv hermes "${DEST}"
echo "installed ${DEST}"
