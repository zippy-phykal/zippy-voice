# Zippy Voice — Requirements

## R1: Voice Send & Receive Loop
- User taps mic, records audio
- Audio sent to server, transcribed by Whisper
- Transcript injected into Telegram session via sessions_send (fire-and-forget)
- Server polls for assistant reply every 2 seconds
- Reply text displayed on app screen AND spoken aloud via TTS
- **Status:** ✅ Working — full loop confirmed, ~4-6 second response time

## R2: User's Voice Visible in Telegram
- Every voice message from Zippy Voice appears in Telegram as: 🎙️ **YOU SAID:** "transcript"
- Sent via the `message` tool to the user's Telegram chat
- **Status:** ✅ Working

## R3: AI Reply Visible in Telegram
- Every AI response to a voice message appears in Telegram as: ⚡ response text
- Sent via the `message` tool after the poller finds the reply
- **Status:** ✅ Working

## R4: No Echo in Voice Playback
- The agent's BIG JOHN SAID echo and the 🎙️ YOU SAID transcript are NOT read aloud on the app
- User only hears the actual AI response
- The echo/transcript only appears in Telegram text
- **Status:** ✅ Working — server strips echo via cleanForVoice(), poller skips transcript messages

## R5: Auto-Retry on Connection Failure
- If app can't reach server, retry up to 3 times with 2-second gaps
- Show retry status on screen ("Retrying... 2/3")
- After all retries fail, show "Connection failed — check WiFi/Tailscale"
- **Status:** ✅ Implemented

## R6: Debug Mode
- App shows real-time status of what's happening (transcribing, sending, polling, etc.)
- Server logs all steps with timestamps to journalctl
- App displays debug info in a collapsible panel (tap 🐛 icon)
- **Status:** ✅ Implemented

## R7: Progress Status During Send
- App shows progressive status: Uploading → Transcribing → Waiting for Zippy → Still waiting → Zippy is thinking hard → Almost there
- **Status:** ✅ Implemented

## R8: Continuous Listening Until "Zip Out"
- App stays listening until user says "zip out" (fuzzy match)
- Alternative stop: 20+ seconds of silence
- Any pause under 20 seconds — keep listening
- **Status:** ❌ Code exists in index.html but relies on Web Speech API which is flaky on Android Chrome. Needs testing.

## R9: "Enough" to Stop Playback
- User says "enough" while TTS is playing → immediately stops playback
- Returns to idle state, ready for next input
- **Status:** ❌ Code exists but untested

## R10: Auto-Summary for Long Responses
- If response > 500 chars, generate a short summary
- TTS speaks the summary, full text shown on screen
- User can say "enough" to cut off even the summary
- **Status:** ❌ Server-side logic exists but untested

## R11: Always Running
- Server runs as systemd service with auto-restart (Restart=always, RestartSec=3)
- Survives reboots (lingering enabled)
- App retries if server is temporarily down during restart
- **Status:** ✅ Implemented

## R12: Git Commit Every Change
- Every code change gets committed and pushed immediately
- Clear commit messages describing what changed
- **Status:** ✅ Active — 20+ commits tracked

## R13: Clean Markdown Stripping for TTS
- Code blocks, inline code, bold, italic, headers, links, bullets, numbered lists all stripped
- Double newlines converted to pauses
- BIG JOHN SAID echo block stripped
- Voice transcript messages stripped
- **Status:** ✅ Implemented

## R14: Open-Source Packaging
- GitHub repo: https://github.com/zippyclawdbot-lab/zippy-voice
- MIT License
- package.json with `npm start`
- .env.example for configuration
- CONTRIBUTING.md for contributors
- .gitignore for clean repo
- All config via environment variables (no hardcoded secrets)
- **Status:** ✅ Complete

## R15: ClawdHub Publishing
- Publish to clawdhub.com so Clawdbot users can find and install it
- Requires: clawdhub login + SKILL.md wrapper
- **Status:** ❌ CLI installed, needs auth flow

---
*This is the source of truth. If it's not in this doc, it's not a requirement.*
*Last updated: 2026-01-29 9:11 PM EST*
