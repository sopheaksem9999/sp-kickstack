#!/usr/bin/env bash
set -e

REPO="sopheaksem9999/sp-kickstack"
APP_NAME="SP Kickstack"
APP_DIR="/Applications/${APP_NAME}.app"

echo "🚀 Installing ${APP_NAME} for macOS..."

# 1. Fetch latest release DMG download URL from GitHub API
RELEASE_JSON=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest")
DMG_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*aarch64\.dmg' | head -n 1)

if [ -z "${DMG_URL}" ]; then
  echo "⚠️ Could not automatically detect aarch64 DMG, falling back to any DMG..."
  DMG_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*\.dmg' | head -n 1)
fi

if [ -z "${DMG_URL}" ]; then
  echo "❌ Error: Could not find a DMG installer in the latest release."
  exit 1
fi

TMP_DIR=$(mktemp -d)
DMG_PATH="${TMP_DIR}/installer.dmg"

echo "📥 Downloading latest release from ${DMG_URL}..."
curl -L -f -o "${DMG_PATH}" "${DMG_URL}" --progress-bar

echo "📦 Mounting installer..."
MOUNT_POINT=$(mktemp -d)
hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_POINT}" -nobrowse -quiet

echo "📂 Installing to /Applications..."
if [ -d "${APP_DIR}" ]; then
  rm -rf "${APP_DIR}"
fi
cp -R "${MOUNT_POINT}/${APP_NAME}.app" /Applications/

echo "🧹 Unmounting installer..."
hdiutil detach "${MOUNT_POINT}" -quiet || true
rm -rf "${TMP_DIR}" "${MOUNT_POINT}"

echo "🛡️ Clearing macOS Gatekeeper quarantine flag..."
xattr -cr "${APP_DIR}"

echo ""
echo "✅ ${APP_NAME} installed successfully to /Applications!"
echo "✨ Launching ${APP_NAME}..."
open -a "${APP_NAME}"
