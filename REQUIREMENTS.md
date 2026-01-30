# Zippy Voice — Requirements

## R1: Voice Send & Receive Loop
- User taps mic, records audio
- Audio sent to server, transcribed by Whisper
- Transcript injected into Telegram session via sessions_send
- Server polls for assistant reply
- Reply text displayed on app screen AND spoken aloud via TTS
- **Status:** Partially working — send works, response polling/playback needs fixing

## R2: Echo User's Words in Telegram
- Every voice message from Zippy Voice MUST appear in Telegram echoed back
- Format: 🍔 **BIG JOHN SAID:** "transcript here" 🍔
- This is NOT optional — it's how John sees what he said in the chat thread
- **Owner:** Clawdbot agent behavior (not app code) — agent must ALWAYS echo voice messages
- **Voice app:** The echo is STRIPPED from TTS playback — user doesn't hear their own words repeated back. Echo only appears in Telegram text.
- **Status:** ✅ Working — echo in Telegram, stripped from voice

## R3: Auto-Retry on Connection Failure
- If app can't reach server, retry up to 3 times with 2-second gaps
- Show retry status on screen ("Retrying... 2/3")
- After all retries fail, show "Connection failed — check WiFi/Tailscale"
- **Status:** ✅ Implemented

## R4: Debug Mode
- App shows real-time status of what's happening (transcribing, sending, polling, etc.)
- Server logs all steps with timestamps
- App displays debug info in a collapsible panel at the bottom
- **Status:** Server logging added, app debug panel NOT built yet

## R5: Continuous Listening Until "Zip Out"
- App stays listening until user says "zip out" (fuzzy match)
- Alternative stop: 20+ seconds of silence
- Any pause under 20 seconds — keep listening
- **Status:** Code exists in index.html but relies on Web Speech API which is flaky on Android Chrome. Needs testing.

## R6: "Enough" to Stop Playback
- User says "enough" while TTS is playing → immediately stops playback
- Returns to idle state, ready for next input
- **Status:** Code exists but untested

## R7: Auto-Summary for Long Responses
- If response > 500 chars, generate a short summary
- TTS speaks the summary, full text shown on screen
- User can say "enough" to cut off even the summary
- **Status:** Server-side logic exists but untested

## R8: Always Running
- Server runs as systemd service with auto-restart
- Survives reboots (lingering enabled)
- App retries if server is temporarily down during restart
- **Status:** ✅ Implemented

## R9: Git Commit Every Change
- Every code change gets committed and pushed immediately
- Clear commit messages describing what changed
- **Status:** ✅ Active

---
*This is the source of truth. If it's not in this doc, it's not a requirement.*
