# Zippy Voice ⚡🎤

A voice-to-voice PWA for talking to your [Clawdbot](https://github.com/clawdbot/clawdbot) AI assistant hands-free. Talk into your phone, hear the AI respond — all routed through Telegram so every conversation is preserved.

## What It Does

You talk. Your AI listens, thinks, and talks back. Every exchange shows up in your Telegram chat as a permanent record.

**Built for:** driving, cooking, walking, working out — anytime your hands are busy and you want to talk to your AI.

## How It Works

1. **Tap the mic** → records your voice
2. **Tap again** → uploads audio to the server
3. **Server transcribes** your speech locally using [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (no cloud APIs)
4. **Message is injected** into your Clawdbot Telegram session — it appears in the chat as if you typed it
5. **AI responds** in the Telegram chat (text + optional voice note via Edge TTS)
6. **App polls** for the response, strips markdown, and **reads it aloud** through your phone speaker

The entire conversation lives in Telegram. The app is just a voice interface on top.

## Key Design Decisions

### Why Telegram as the backbone?
Every voice interaction is injected into and read from the main Telegram session. This means:
- **Full conversation history** — voice and text messages are interleaved in one thread
- **Context preservation** — the AI has your full chat history, not just voice messages
- **Permanent record** — everything is in Telegram, nothing disappears when you close the app
- **Multi-device** — talk on the app, check the conversation on Telegram later

### How the user's voice appears in chat
When you speak through the app, your words appear in the Telegram chat prefixed with `[🎤 Voice]`. The AI then echoes what you said in its response between hamburger emojis:

```
🍔 BIG JOHN SAID: "your transcribed words here" 🍔
```

This is because Telegram shows voice messages as coming from the bot, not from you. The echo lets you (and anyone reading the chat) see exactly what was said. **The echo is NOT read aloud on the app** — you already know what you said. It only appears in the Telegram text.

### Why local transcription?
Speech-to-text runs entirely on-device using whisper.cpp. No audio is sent to OpenAI, Google, or any cloud service. Your voice stays on your machine.

### Why fire-and-forget for message sending?
The `sessions_send` API call blocks until the AI finishes its full response (which can take 10-30+ seconds when the AI uses tools). Instead of waiting, the server fires the message and immediately starts polling for the response. This cuts perceived latency significantly.

### Why Web Speech API for playback?
Browser-native TTS is free, instant, and requires no API keys. The server strips all markdown (code blocks, bold, links, headers, bullets) so the spoken response sounds natural.

## Features

- **Push-to-talk** — tap to record, tap to send
- **Local transcription** — whisper.cpp, offline, private
- **Voice responses** — AI response read aloud via Web Speech API
- **Markdown stripping** — code, bold, links cleaned for natural TTS
- **Auto-retry** — 3 attempts with 2-second gaps if server is temporarily down
- **Progress indicators** — Uploading → Transcribing → Waiting for Zippy → Still waiting...
- **Debug panel** — tap the 🐛 icon to see real-time request/response logs
- **PWA** — install to home screen, works like a native app with wake lock
- **Always running** — systemd service with auto-restart, survives reboots
- **Zero cost for voice** — all STT/TTS is local/free; only the AI response uses your API key

## Setup

### Prerequisites

- [Clawdbot](https://github.com/clawdbot/clawdbot) running with a gateway token
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) installed (`whisper-cli` in PATH)
- `ffmpeg` installed (for audio format conversion)
- A Whisper model (e.g., `ggml-base.en.bin`)
- Network access between phone and server (Tailscale recommended for mobile use)

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
GATEWAY_URL=http://YOUR_CLAWDBOT_IP:18789
WHISPER_MODEL=/path/to/ggml-base.en.bin
PORT=8080
```

Or edit the defaults directly in `server.js`.

### Run

```bash
npm start
```

Or install as a systemd service for always-on:

```bash
# Create service file at ~/.config/systemd/user/zippy-voice.service
[Unit]
Description=Zippy Voice PWA Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/zippy-voice
ExecStart=/usr/bin/node /path/to/zippy-voice/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now zippy-voice.service
loginctl enable-linger $USER  # keeps service running after logout
```

### Connect your phone

1. Open `http://YOUR_SERVER_IP:8080` on your phone
2. Tap ⚙️ and enter your Clawdbot gateway auth token
3. Tap the mic and start talking
4. Add to home screen for PWA experience

## Files

```
├── server.js          # Node server — Whisper transcription, gateway proxy, response polling
├── index.html         # PWA frontend — mic UI, TTS playback, debug panel, settings
├── sw.js              # Service worker — offline caching (skips API routes)
├── manifest.json      # PWA manifest
├── icons/             # App icons (192px, 512px)
├── REQUIREMENTS.md    # Feature requirements and status tracking
└── STATUS.md          # Current project status and known issues
```

## Cost

| Component | Cost |
|-----------|------|
| Speech-to-text (Whisper) | Free (local) |
| Text-to-speech (Edge TTS / Web Speech) | Free |
| Server (Node.js) | Free (self-hosted) |
| Network (Tailscale) | Free (personal) |
| **AI responses (Claude)** | **~$0.05-0.10 per turn** (same as any Clawdbot message) |

The voice app adds zero extra cost. You only pay for the AI, which you'd pay for anyway.

## License

MIT
