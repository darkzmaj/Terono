#!/usr/bin/env bash
# Terono installer for macOS / Linux
#   curl -fsSL https://raw.githubusercontent.com/darkzmaj/Terono/main/install.sh | bash
# Builds Vencord with the Terono plugin, installs it into Discord and adds the Terono theme.
# Run it again any time to update.
set -euo pipefail

DIR="${TERONO_DIR:-$HOME/Terono}"
VENCORD="$DIR/Vencord"
PLUGIN="$VENCORD/src/userplugins/terono"

step() { printf '\n\033[36m> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }

# Git and Node.js are needed to build Vencord; on macOS they are installed with Homebrew when available
for tool in git node; do
  command -v "$tool" >/dev/null && continue
  if command -v brew >/dev/null; then step "Installing $tool (needed once)"; brew install "$tool"
  else fail "$tool is required. Install it with your package manager (for example: sudo apt install git nodejs npm), then run this again."; fi
done

mkdir -p "$DIR"

# Existing download: fetch the newest version and reset to it. Missing or damaged: download it fresh.
# The Terono folder sits inside the Vencord download; if its own .git is damaged git silently uses Vencord's,
# so only a folder that is its own repository root with the expected source counts.
sync() {
  url="$1"; path="$2"
  if [ -d "$path/.git" ]; then
    top="$(git -C "$path" rev-parse --show-toplevel 2>/dev/null || true)"
    origin="$(git -C "$path" remote get-url origin 2>/dev/null || true)"
    if [ -n "$top" ] && [ "$(cd "$top" && pwd -P)" = "$(cd "$path" && pwd -P)" ] && [ "${origin%.git}" = "$url" ] \
      && git -C "$path" fetch --depth 1 origin main && git -C "$path" reset --hard FETCH_HEAD; then
      return
    fi
    printf '\033[33mThe download folder is damaged, downloading it again.\033[0m\n'
  fi
  rm -rf "$path"
  git clone --depth 1 "$url" "$path"
}

step "Getting Vencord"
sync https://github.com/Vendicated/Vencord "$VENCORD"

step "Getting Terono"
sync https://github.com/darkzmaj/Terono "$PLUGIN"

cd "$VENCORD"
PNPM="$(node -p 'require("./package.json").packageManager')"

step "Installing build tools (first run takes a minute)"
npx -y "$PNPM" install --frozen-lockfile

step "Building"
npx -y "$PNPM" build

if [ -n "${TERONO_NO_INJECT:-}" ]; then step "Build finished (TERONO_NO_INJECT set, Discord left untouched)"; exit 0; fi

step "Closing Discord"
pkill -x Discord 2>/dev/null || pkill -x discord 2>/dev/null || true
sleep 2

step "Installing into Discord (may ask for your password on Linux)"
node scripts/runInstaller.mjs -- --install --branch auto

step "Enabling Terono"
node "$PLUGIN/scripts/enable.mjs"

if [ "$(uname)" = "Darwin" ]; then open -a Discord || true; else (nohup discord >/dev/null 2>&1 &) || true; fi

printf '\n\033[32mTerono is installed. Open Settings > Vencord > Plugins > Terono to customize it.\033[0m\n'
