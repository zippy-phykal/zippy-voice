# Zippy Voice — Current Status
*Last updated: 2026-01-29*

## What It Is
A PWA that gives you voice-to-voice communication with your Clawdbot AI assistant through Telegram. Talk into your phone → message appears in Telegram → AI responds → you hear it spoken back.

## What's Working ✅
- **Push-to-talk recording** — tap mic to start, tap to send
- **Whisper transcription** — local whisper.cpp, no API keys, offline-capable
- **Telegram session injection** — voice messages route into the main Telegram session via `sessions_send` (fire-and-forget, non-blocking)
- **Response polling** — polls `sessions_history` every 2s for new assistant replies (last 10 messages, skips MEDIA/NO_REPLY/HEARTBEAT noise)
- **Browser TTS playback** — Web Speech API reads responses aloud on the phone ✅ CONFIRMED WORKING
- **Markdown stripping** — code blocks, bold, links etc. stripped for clean TTS
- **Auto-summary** — long responses get summarized for voice, full text shown on screen
- **PWA install** — add to home screen, wake lock, service worker
- **Settings panel** — configure server URL and auth token
- **Reset button** — clears service worker cache for updates
- **Edge TTS on Telegram** — Clawdbot auto-converts text replies to voice notes in Telegram (edge-tts, en-US-GuyNeural)
- **Auto-retry** — 3 attempts with 2s gaps if server unreachable
- **Debug panel** — tap 🐛 icon to see real-time logs
- **Progress status** — shows Uploading → Transcribing → Waiting → Still waiting...
- **GitHub repo** — https://github.com/zippyclawdbot-lab/zippy-voice (public, johnminze as admin collaborator)

## What's NOT Working / Not Built Yet ❌
- **Continuous listening** — currently push-to-talk only. "Zip out" stop phrase and 20-second silence detection are coded in index.html but rely on Web Speech API which is unreliable on Android Chrome (restarts on pause, drops transcript). Needs testing.
- **"Enough" interrupt** — code exists to stop TTS playback when user says "enough" but untested in practice

## Architecture

```
Phone (Zippy Voice PWA)
  ↓ tap mic, record audio
  ↓ POST /api/voice-send (multipart: audio + token)
Server (Node.js, port 8080)
  ↓ ffmpeg convert → whisper-cli transcribe
  ↓ POST /tools/invoke → sessions_send to agent:main:main
  ↓ Poll /tools/invoke → sessions_history for new assistant reply
  ↓ Return { transcript, reply, fullReply }
Phone
  ↓ Display text, speak reply via Web Speech API

Telegram (parallel)
  ← sees "[🎤 Voice] transcript" as user message
  ← sees assistant reply as text + voice note (edge-tts auto)
```

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Node server — Whisper transcription, gateway proxy, response polling |
| `index.html` | PWA frontend — mic UI, TTS playback, settings |
| `sw.js` | Service worker — offline caching (skips /api/ and /v1/ routes) |
| `manifest.json` | PWA manifest — name, icons, display mode |
| `icons/` | App icons (192px, 512px) |

## Infrastructure
- **Server:** Node.js on port 8080, systemd user service `zippy-voice.service` (auto-restart, boot start)
- **Network:** Tailscale (100.85.34.7 gateway, 100.74.140.12 phone)
- **STT:** whisper.cpp with ggml-base.en.bin model
- **TTS (PWA):** Browser Web Speech API
- **TTS (Telegram):** edge-tts v7.2.7, en-US-GuyNeural voice
- **Gateway:** Clawdbot on port 18789, tailnet-bound

## Known Issues
1. Web Speech API on Android Chrome is flaky — restarts on pause, duplicates text, loses transcript. This killed the original continuous-listen design. Push-to-talk is the workaround.
2. Two server.js processes can spawn if the old one isn't killed before restarting the systemd service. Fixed 2026-01-29.
3. Response polling checked only last 3 messages — missed replies that had tool calls before them. Fixed to 10 + filters for MEDIA/NO_REPLY.
4. edge-tts was configured but never installed — Telegram voice replies silently failed. Installed 2026-01-29.

## Git History
```
d90d88d Add conversation history context to voice and text responses
3514914 Push-to-talk with Whisper, Telegram integration, auto-summary, tap-to-stop
1396b3d Initial commit: hands-free voice PWA for Clawdbot
```
