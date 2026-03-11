#!/bin/bash
# TeamsHub — Double-click this to install and run
cd "$(dirname "$0")"

# Install Node.js if missing
if ! command -v node &>/dev/null; then
  echo "Installing Node.js..."
  curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash
  brew install node
fi

# Install dependencies
npm install 2>/dev/null

# Build
npm run build 2>/dev/null

# Open the app
if [ -d "dist/mac/TeamsHub.app" ]; then
  open "dist/mac/TeamsHub.app"
elif [ -d "dist/mac-arm64/TeamsHub.app" ]; then
  open "dist/mac-arm64/TeamsHub.app"
else
  # Fallback: run directly
  npx electron . &
fi

echo ""
echo "================================================"
echo "  TeamsHub is running!"
echo ""
echo "  Chrome Extension:"
echo "  1. Open chrome://extensions"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked'"
echo "  4. Select the 'extension' folder in this directory"
echo "================================================"
