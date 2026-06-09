#!/usr/bin/env bash
# start.sh — one-command launcher for Termux (and any Linux/macOS)
set -e

# ── Detect Termux ──────────────────────────────────────────────────────────────
IS_TERMUX=false
if [ -d "/data/data/com.termux" ]; then
  IS_TERMUX=true
fi

# ── Install Node.js if missing (Termux only) ───────────────────────────────────
if ! command -v node &>/dev/null; then
  if [ "$IS_TERMUX" = true ]; then
    echo "Installing Node.js via pkg..."
    pkg install nodejs -y
  else
    echo "Error: Node.js is not installed. Please install it first."
    echo "  Termux:  pkg install nodejs"
    echo "  Ubuntu:  sudo apt install nodejs npm"
    echo "  macOS:   brew install node"
    exit 1
  fi
fi

NODE_VER=$(node --version)
echo "Node.js $NODE_VER found."

# ── Install npm dependencies ───────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies..."
  npm install
fi

# ── Compile TypeScript → JavaScript ───────────────────────────────────────────
# Running compiled JS is significantly faster than ts-node on mobile hardware.
echo "Compiling TypeScript..."
npx tsc

# ── Start ──────────────────────────────────────────────────────────────────────
echo ""
node dist/chatbot/index.js
