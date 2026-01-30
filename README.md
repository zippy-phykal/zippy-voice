# Zippy Voice ⚡🎤

Hands-free voice interface for [Clawdbot](https://github.com/clawdbot/clawdbot). Talk to your AI assistant without touching your phone.

## What It Does

A lightweight PWA that lets you talk to Clawdbot by voice — tap to record, it transcribes with Whisper, sends to your Clawdbot gateway, and reads the reply back aloud. That's it.

**Built for:** driving, cooking, walking, or anytime your hands are busy.

## How It Works

1. **Tap** the mic button → records audio
2. **Tap again** → sends to the server
3. **Server** converts to WAV → transcribes with [whisper.cpp](https://github.com/ggerganov/whisper.cpp) → sends to Clawdbot gateway
4. **Response** comes back → displayed on screen + spoken via Web Speech API
5. Long responses are auto-summarized for voice

## Stack

- **Frontend:** Single-page PWA (vanilla HTML/JS, no build step)
- **Backend:** Node.js server (~200 lines, zero dependencies)
- **STT:** whisper.cpp (local, offline transcription)
- **TTS:** Web Speech API (browser-native)
- **AI:** Clawdbot gateway (OpenAI-compatible API)

## Architecture Decisions

### Conversation Context: Last 20 Messages

The voice endpoint pulls the **last 20 messages** from your Clawdbot session to give the AI conversational context. This is intentional:

- **Voice is real-time** — latency matters. More context = more tokens = slower responses.
- **Shared session** — the voice app uses your main Clawdbot session, so those 20 messages include Telegram, voice, and any other channel. It's a good window.
- **Cost** — every voice interaction sends the full context. Deeper history multiplies token cost fast.
- **Relevance decay** — for hands-free use (driving, cooking), you almost never need something from 30+ messages ago.

The limit is configurable in `server.js` (`getRecentHistory(token, 20)`). Bump it if your use case needs more, but 20 is the sweet spot for responsive voice interaction.

## Setup

### Prerequisites

- [Clawdbot](https://github.com/clawdbot/clawdbot) running with a gateway token
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) installed (`whisper-cli` in PATH)
- `ffmpeg` installed
- A Whisper model downloaded (e.g. `ggml-base.en.bin`)

### Configure

Edit the top of `server.js`:

```js
const GATEWAY = 'http://YOUR_CLAWDBOT_IP:18789';
const WHISPER_MODEL = '/path/to/ggml-base.en.bin';
```

### Run

```bash
node server.js
```

Open `http://localhost:8080` on your phone, tap ⚙️ to enter your gateway auth token, and start talking.

### Install as PWA

On mobile, use "Add to Home Screen" for a fullscreen app experience with wake lock support.

## Files

```
├── server.js        # Node server (transcription + gateway proxy)
├── index.html       # PWA frontend
├── sw.js            # Service worker (offline fallback)
├── manifest.json    # PWA manifest
└── icons/           # App icons
```

## License

MIT
