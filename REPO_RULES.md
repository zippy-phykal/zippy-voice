# Zippy Voice — Mandatory Rules for All Agents

**READ THIS BEFORE DOING ANYTHING IN THIS REPO.**

## What This Is

Zippy Voice is a **voice-to-voice PWA** that connects to Clawdbot (AI assistant) via Telegram. User speaks → Whisper transcribes → Clawdbot replies → TTS speaks the reply. It's a lightweight Node.js server + single-page HTML app.

## Architecture

```
Browser (PWA)          Server (Node.js)           Clawdbot Gateway
index.html ──POST───▶ server.js ──sessions_send──▶ Telegram session
     ◀──poll/reply──   │                              │
     ◀──TTS audio───   │◀──────poll for reply─────────┘
                        │
                   Whisper CLI (local binary)
```

- **No frameworks** — vanilla HTML/JS frontend, plain Node.js `http` server
- **No database** — stateless, temp files only (`/tmp/zippy-voice/`)
- **No npm dependencies** — zero `node_modules`, uses only Node.js built-ins
- **CommonJS** — `require()` not `import` (server.js)

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | HTTP server — serves static files, handles `/upload` (Whisper), `/poll` (reply check), `/tts` |
| `index.html` | Full PWA frontend — mic recording, UI, TTS playback, polling |
| `sw.js` | Service worker for offline PWA support |
| `manifest.json` | PWA manifest |
| `REQUIREMENTS.md` | R1-R15 tracked requirements with status |
| `STATUS.md` | Current bug/feature status |

## ❌ Things That Do NOT Exist

- No npm dependencies — do NOT add `package-lock.json` or `node_modules`
- No build step — serve files directly, no bundling
- No TypeScript — plain JavaScript only
- No React/Vue/framework — vanilla HTML/JS
- No database — everything is stateless

## ✅ Core Behaviors

- Voice messages appear in Telegram as: 🎙️ **YOU SAID:** "transcript"
- AI replies appear in Telegram as: ⚡ response text
- Echoes/transcripts are NOT read aloud — only the AI response plays via TTS
- Server strips echoes via `cleanForVoice()` function
- Polling checks every 2 seconds for Clawdbot reply
- Auto-retry on connection failure (3 attempts, 2s gap)

## Environment Variables

```
PORT=8080
GATEWAY_URL=http://100.85.34.7:18789
GATEWAY_TOKEN=<clawdbot-token>
WHISPER_MODEL=/home/jack/.local/share/whisper/ggml-base.en.bin
UPLOAD_DIR=/tmp/zippy-voice
TELEGRAM_CHAT_ID=8398867491
```

## Commands

- **Start server:** `node server.js`
- **Start with env:** `PORT=8080 node server.js`
- **Check status:** `curl http://localhost:8080/`
- **Test upload:** `curl -X POST http://localhost:8080/upload -F "audio=@test.webm"`
