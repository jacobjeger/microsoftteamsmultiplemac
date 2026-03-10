# Teams Launcher

A Mac menu bar app for managing multiple Microsoft Teams accounts. Each account runs in its own isolated browser session, so you can stay logged into multiple Teams organizations simultaneously.

## Features

- **Menu bar app** — lives in your Mac menu bar, no dock icon
- **Unlimited accounts** — add as many Teams accounts as you need
- **Session isolation** — each account has its own cookie store via Electron partitions
- **Launch All** — open all accounts at once with a single click
- **Native notifications** — Teams notifications fire as native Mac notifications, labeled with the account name
- **Persistent config** — account settings survive app restarts
- **Dark UI** — clean, minimal settings panel with drag-and-drop reordering

## Setup

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build .app and .dmg for distribution
npm run dist
```

## How It Works

Each Teams account opens `teams.microsoft.com` in its own Electron BrowserWindow with a unique session partition (`persist:account_<id>`). This means each window has its own cookies, localStorage, and login state — completely independent from the others.

The app uses the Electron Tray API to sit in your menu bar. Clicking the tray icon shows a dropdown with all your accounts, their open/closed status, and quick actions.

## Tech Stack

- **Electron** — desktop app framework
- **electron-builder** — packaging for Mac `.app` and `.dmg`
- **Electron Tray API** — menu bar integration
- **Session partitions** — `partition: 'persist:account_<id>'` for isolation
- **Simple JSON store** — lightweight persistence in `userData/accounts.json`
