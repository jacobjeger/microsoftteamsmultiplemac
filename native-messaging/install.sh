#!/bin/bash

# TeamsHub Native Messaging Host Installer
# Installs the native messaging host manifest for Chrome

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/host.js"
MANIFEST_NAME="com.teamshub.native.json"

# Chrome native messaging hosts directory
CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Ensure the directory exists
mkdir -p "$CHROME_NM_DIR"

# Make host.js executable
chmod +x "$HOST_PATH"

# Get extension ID from argument or prompt
EXTENSION_ID="${1:-}"
if [ -z "$EXTENSION_ID" ]; then
  echo "TeamsHub Native Messaging Host Installer"
  echo "========================================="
  echo ""
  echo "To find your extension ID:"
  echo "  1. Open chrome://extensions in Chrome"
  echo "  2. Enable Developer Mode"
  echo "  3. Find TeamsHub and copy its ID"
  echo ""
  read -p "Enter your Chrome extension ID: " EXTENSION_ID
fi

if [ -z "$EXTENSION_ID" ]; then
  echo "Error: Extension ID is required"
  exit 1
fi

# Create the manifest with the correct paths
cat > "$CHROME_NM_DIR/$MANIFEST_NAME" << EOF
{
  "name": "com.teamshub.native",
  "description": "TeamsHub Native Messaging Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo ""
echo "Native messaging host installed successfully!"
echo "  Manifest: $CHROME_NM_DIR/$MANIFEST_NAME"
echo "  Host: $HOST_PATH"
echo "  Extension ID: $EXTENSION_ID"
echo ""
echo "You may need to restart Chrome for changes to take effect."
