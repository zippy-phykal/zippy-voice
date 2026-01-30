# Contributing to Zippy Voice

Thanks for your interest! Here's how to contribute.

## Getting Started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/zippy-voice.git`
3. Install prerequisites (see README.md)
4. Copy `.env.example` to `.env` and configure
5. Run: `npm start`

## Project Structure

- `server.js` — Node.js server handling audio upload, Whisper transcription, and Clawdbot gateway communication
- `index.html` — Single-file PWA frontend with mic recording, TTS playback, debug panel
- `sw.js` — Service worker for offline support
- `REQUIREMENTS.md` — Feature requirements and their status

## Guidelines

- **Zero dependencies** — the server uses only Node.js built-in modules. Keep it that way.
- **Single-file frontend** — `index.html` is self-contained (HTML + CSS + JS). No build step.
- **Test before committing** — make sure the voice loop works end-to-end
- **Clear commit messages** — describe what changed and why

## Reporting Issues

Open a GitHub issue with:
- What you expected
- What happened instead
- Debug panel output (tap 🐛 in the app)
- Server logs (`journalctl --user -u zippy-voice.service`)

## Architecture Notes

See README.md "Key Design Decisions" for why things are built the way they are. The main constraint is that everything routes through a Clawdbot Telegram session — this is intentional for conversation continuity.
