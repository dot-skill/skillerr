#!/usr/bin/env bash
# Install Open .skill Protocol CLI → bin: skill
set -euo pipefail

# Pinned, not @latest: an unpinned install can silently pick up a breaking
# release between when this script was tested and when someone runs it.
# Bump this alongside packages/skillerr/package.json on release.
SKILLERR_VERSION="0.6.4"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm required (Node >= 20): https://nodejs.org" >&2
  exit 1
fi

echo "Installing skillerr@${SKILLERR_VERSION}…"
if ! npm install -g "skillerr@${SKILLERR_VERSION}"; then
  echo "npm install failed — from source:"
  echo "  git clone https://github.com/dot-skill/skillerr.git && cd skillerr"
  echo "  npm i && npm run build && npm link -w skillerr"
  exit 1
fi

echo
echo "  export SKILL_HOST=cursor"
echo "  skill --help"
echo

installed_version="$(skill --version 2>/dev/null || true)"
if [ -n "$installed_version" ]; then
  echo "Installed: skillerr ${installed_version}"
else
  echo "Warning: installed but 'skill --version' did not run — check your PATH." >&2
fi
