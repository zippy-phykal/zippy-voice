# Zippy Voice — Current Status
*Last updated: 2026-01-29 9:11 PM EST*

## What It Is
A PWA that gives you voice-to-voice communication with your Clawdbot AI assistant through Telegram. Talk into your phone → message appears in Telegram → AI responds → you hear it spoken back.

## What's Working ✅
- **Push-to-talk recording** — tap mic to start, tap to send
- **Whisper transcription** — local whisper.cpp, no API keys, offline-capable
- **Telegram session injection** — voice messages route into the main Telegram session via `sessions_send` (fire-and-forget, non-blocking)
- **Response polling** — polls `sessions_history` every 2s for new assistant replies (last 10 messages, skips noise)
- **Browser TTS playback** — Web Speech API reads responses aloud on the phone ✅ CONFIRMED WORKING
- **Markdown stripping** — code blocks, bold, links, headers, bullets cleaned for natural TTS
- **BIG JOHN echo stripped from TTS** — agent echo only shows in Telegram, not spoken on app
- **Visible transcripts in Telegram** — user's voice messages appear as 🎙️ **YOU SAID:** messages
- **Visible AI replies in Telegram** — AI responses appear as ⚡ messages
- **Full Telegram thread** — both sides of voice conversations are visible in the chat
- **Auto-retry** — 3 attempts with 2-second gaps if server unreachable
- **Debug panel** — tap 🐛 icon to see real-time request/response logs
- **Progress status** — shows Uploading → Transcribing → Waiting → Still waiting...
- **Auto-summary** — long responses get summarized for voice, full text shown on screen
- **PWA install** — add to home screen, works like a native app with wake lock
- **Always running** — systemd service with auto-restart, survives reboots, lingering enabled
- **Zero cost for voice** — all STT/TTS is local/free; only the AI response uses your API key
- **GitHub repo** — https://github.com/zippyclawdbot-lab/zippy-voice (public, johnminze as admin collaborator)
- **Git history** — every change committed and pushed with clear messages
- **Env var config** — GATEWAY_URL, WHISPER_MODEL, PORT, TELEGRAM_CHAT_ID, UPLOAD_DIR all configurable
- **Open-source packaging** — LICENSE (MIT), package.json, .env.example, CONTRIBUTING.md

## What's NOT Working / Not Built Yet ❌
- **Continuous listening** — currently push-to-talk only. "Zip out" stop phrase and 20-second silence detection are coded in index.html but rely on Web Speech API which is unreliable on Android Chrome. Needs testing.
- **"Enough" interrupt** — code exists to stop TTS playback when user says "enough" but untested in practice
- **ClawdHub publishing** — CLI installed, needs auth + SKILL.md wrapper

## Architecture

```
Phone (Zippy Voice PWA)
  ↓ tap mic, record audio
  ↓ POST /api/voice-send (multipart: audio + token)
Server (Node.js, port 8080)
  ↓ ffmpeg convert → whisper-cli transcribe
  ↓ Fire-and-forget: sessions_send to agent:main:main
  ↓ Fire-and-forget: message tool sends 🎙️ YOU SAID to Telegram
  ↓ Poll sessions_history for new assistant reply (2s intervals)
  ↓ On reply: send ⚡ reply to Telegram + return to app
  ↓ Return { transcript, reply (cleaned for voice), fullReply (raw) }
Phone
  ↓ Display text, speak cleaned reply via Web Speech API

Telegram (parallel view)
  ← 🎙️ YOU SAID: "user's transcribed words"
  ← ⚡ AI's response text
```

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Node server — Whisper transcription, gateway proxy, response polling, Telegram messages |
| `index.html` | PWA frontend — mic UI, TTS playback, debug panel, retry logic, settings |
| `sw.js` | Service worker — offline caching (skips /api/ and /v1/ routes) |
| `manifest.json` | PWA manifest — name, icons, display mode |
| `icons/` | App icons (192px, 512px) |
| `REQUIREMENTS.md` | Feature requirements and status tracking |
| `.env.example` | Configuration template |
| `CONTRIBUTING.md` | How to contribute |
| `package.json` | npm start, metadata, keywords |

## Infrastructure
- **Server:** Node.js on port 8080, systemd user service `zippy-voice.service` (Restart=always, RestartSec=3)
- **Network:** Tailscale (100.85.34.7 gateway, 100.74.140.12 phone)
- **STT:** whisper.cpp with ggml-base.en.bin model
- **TTS (PWA):** Browser Web Speech API
- **TTS (Telegram):** edge-tts v7.2.7, en-US-GuyNeural voice
- **Gateway:** Clawdbot on port 18789, tailnet-bound

## Bugs Fixed (2026-01-29)
1. **edge-tts not installed** — Telegram voice replies silently failed. Installed via pip.
2. **Two server.js processes** — old zombie process conflicting. Killed and fixed.
3. **Polling too shallow** — only checked last 3 messages, missed replies after tool calls. Bumped to 10.
4. **Wrong JSON path** — `result.messages` vs `result.details.messages`. Critical fix.
5. **sessions_send blocking 30s** — changed to fire-and-forget, started polling immediately.
6. **Poller grabbing transcript as reply** — visible Telegram messages were picked up as AI response. Added skip filters.
7. **MEDIA/NO_REPLY noise** — poller could return garbage. Added filters.
8. **No visible chat thread** — voice messages invisible in Telegram. Added 🎙️ YOU SAID + ⚡ reply messages.

## Git Log
```
3eded5a Send AI reply visibly to Telegram chat thread, skip in poller to avoid loops
cac4d97 Fix poller picking up visible transcript as reply — skip YOU SAID, Voice:, ANNOUNCE_SKIP messages
dceeebe Change visible transcript format to: YOU SAID with mic emoji for clear distinction
1c76dee Send visible transcript to Telegram chat so user sees their voice messages in thread
0e25e91 Open-source packaging: .gitignore, LICENSE (MIT), package.json, .env.example, CONTRIBUTING.md, env var config
e1c0182 Rewrite README with full feature docs, design decisions, echo behavior, cost breakdown
f607bc9 Update REQUIREMENTS.md — R2 echo stripped from voice, kept in Telegram
4ca2338 Strip BIG JOHN SAID echo from TTS voice reply (keep in Telegram only)
34f3511 Strip markdown/code from voice replies for clean TTS playback
5eb3360 Fix critical bug: sessions_history messages at result.details.messages not result.messages
5f8b429 Add REQUIREMENTS.md, debug panel (bug icon), progress status updates during send/poll
d4c9967 Add auto-retry (3 attempts) when server is unreachable
166911a Add server-side debug logging for voice send and response polling
e6f1330 Add STATUS.md, fix response polling (limit 10, skip MEDIA/NO_REPLY), install edge-tts
d90d88d Add conversation history context to voice and text responses
3514914 Push-to-talk with Whisper, Telegram integration, auto-summary, tap-to-stop
1396b3d Initial commit: hands-free voice PWA for Clawdbot
```
