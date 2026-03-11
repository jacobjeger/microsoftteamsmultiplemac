# TeamsHub

Mac menu bar app for managing multiple Microsoft Teams accounts simultaneously, with a Chrome extension that routes Microsoft 365 links to the right account.

## Features

### Phase 1 — Window Mode
- **Unlimited Teams accounts** with custom labels and color tags
- **Isolated sessions** — each account runs in its own sandboxed BrowserWindow
- **Launch All** or launch individual accounts from the menu bar
- **Window position/size persistence** per account
- **Native Mac notifications** labeled with account name
- **Dock badge** showing total unread count
- **Tabbed browser** per account for Microsoft 365 links (SharePoint, OneDrive, etc.)
- **Auto-launch URLs** — configure URLs to open automatically with each account

### Phase 2 — Chrome Extension
- **Manifest V3** Chrome extension
- **Intercepts Microsoft 365 URLs** — SharePoint, OneDrive, Outlook, Office, Teams
- **Domain-to-account mapping** — pick once per domain, then automatic
- **Native messaging** bridge between Chrome and TeamsHub
- **Options page** for managing domain mappings

## Prerequisites

- **macOS** (10.15+)
- **Node.js** (18+)
- **npm** (9+)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Run in development mode

```bash
npm run dev
```

This starts Vite dev server and Electron concurrently. The settings window will open automatically.

### 3. Add accounts

1. Click **+ Add Account** in the settings window
2. Enter a name (e.g. "Acme Corp") and pick a color
3. Optionally add auto-launch URLs (e.g. SharePoint sites)
4. Click **Save**
5. Click the play button to launch the account
6. Log in to Teams in the window that opens — your session is saved per account

### 4. Build for distribution

```bash
npm run build
```

This builds the React UI with Vite and packages the Electron app into a `.app` and `.dmg` using electron-builder.

## Chrome Extension Setup

### 1. Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory from this project
5. Note the **Extension ID** shown on the card

### 2. Install native messaging host

```bash
cd native-messaging
./install.sh YOUR_EXTENSION_ID
```

Replace `YOUR_EXTENSION_ID` with the ID from step 1.

### 3. Usage

- Make sure TeamsHub is running
- Click any Microsoft 365 link in Chrome
- First time: the extension popup asks which TeamsHub account to use
- After that: automatic routing, no popup

## Project Structure

```
teamshub/
├── electron/                # Main process
│   ├── main.js              # Tray, windows, IPC, HTTP server
│   ├── store.js             # electron-store persistence
│   ├── preload-teams.js     # Notification override + unread counting
│   ├── preload-settings.js  # Settings window IPC bridge
│   └── preload-browser.js   # Browser window IPC bridge
├── src/                     # React renderers (Vite)
│   ├── settings/            # Settings window UI
│   └── browser/             # Tabbed browser UI
├── extension/               # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js        # URL interception + routing
│   ├── popup.*              # Account picker popup
│   └── options.*            # Domain mapping management
├── native-messaging/        # Chrome ↔ Electron bridge
│   ├── host.js              # Native messaging host
│   ├── com.teamshub.native.json
│   └── install.sh           # Installer script
├── package.json
├── vite.config.js
└── .env.example
```

## Azure AD Registration (Phase 3)

For the future Hub Mode (unified inbox), you'll need to register an Azure AD app:

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click **New registration**
3. Name: `TeamsHub`
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
5. Redirect URI: `http://localhost` (will be updated)
6. Under **API permissions**, add:
   - `Chat.Read`, `Chat.ReadWrite`
   - `ChannelMessage.Read.All`
   - `Presence.Read`
   - `offline_access`
7. Copy the **Application (client) ID** to your `.env` file

## Tech Stack

- **Electron** — desktop framework
- **React 18** — UI rendering
- **Vite** — bundler for React
- **electron-store** — persistence
- **electron-builder** — packaging (.app, .dmg)
- **Chrome Manifest V3** — extension
- **Native Messaging** — Chrome ↔ Electron bridge

## License

MIT
