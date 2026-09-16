# ♟ ChessMind — Free Offline Chess Analysis with Voice Control

A powerful, completely free, ad-free chess analysis web app that runs entirely in your browser. No accounts, no servers, no internet required after first load.

## Features

- **🔧 Board Setup Mode** — Drag and drop pieces anywhere. Build any position you want.
- **⚡ Stockfish Engine** — The world's strongest open-source chess engine, running via WebAssembly directly in your browser.
- **🎤 Voice Control** — Say "knight to f3" or "analyze" to control the app hands-free.
- **🔊 Text-to-Speech** — Hear the best move and evaluation spoken aloud.
- **📱 Responsive** — Works on desktop, tablet, and phone.
- **🌐 LAN Access** — Serve on your local network and access from any device.
- **🔒 100% Offline** — Works as a PWA after first load. Your data never leaves your device.
- **♿ Accessible** — ARIA labels, keyboard navigation, screen reader support.

## Quick Start

### Option 1: Simple (Python)
```bash
cd chessmind
python serve.py
```
Open `http://localhost:8080` in your browser. Other devices on your network can access via the URL printed in the terminal.

### Option 2: Development (Node.js)
```bash
cd chessmind
npx serve .
```

### Option 3: Just Open It
Double-click `index.html` in your file explorer. (Note: some features like voice control may not work without a proper HTTP server due to browser security restrictions.)

## Voice Commands

| Say this... | It does this... |
|-------------|-----------------|
| "knight to f3" | Places/moves knight to f3 |
| "bishop takes d5" | Captures on d5 with bishop |
| "castle kingside" | Castles kingside (O-O) |
| "analyze" | Starts engine analysis |
| "clear board" | Empties the board |
| "starting position" | Resets to standard setup |
| "flip board" | Rotates the board |
| "stop" | Stops analysis |
| "what's the evaluation" | Speaks the current eval |

## Tech Stack

- **Stockfish WASM** — Chess engine running in Web Worker
- **Chessground** — Board UI (from Lichess)
- **chess.js** — Move validation and game logic
- **Web Speech API** — Voice recognition and synthesis
- **Vanilla JavaScript** — No framework bloat

## Accessing from Other Devices

Run the server with:
```bash
python serve.py
```

It will print your local network URL. On other devices:
1. Connect to the same WiFi network
2. Open the URL in a browser
3. For voice control on remote devices, use the HTTPS URL and accept the self-signed certificate

## License

MIT — Free for everyone, forever.
