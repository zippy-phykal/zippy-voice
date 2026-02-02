const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

const PORT = process.env.PORT || 8080;
const DIR = __dirname;
const GATEWAY = process.env.GATEWAY_URL || 'http://100.107.89.83:18789';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/home/jack/.local/share/whisper/ggml-base.en.bin';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/zippy-voice';
const AUDIO_DIR = path.join(UPLOAD_DIR, 'tts');
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8398867491';
const DEFAULT_VOICE = process.env.TTS_VOICE || 'en-US-AnaNeural';

// Groq API for cloud transcription (preferred over local whisper)
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Clean old TTS files periodically (keep last hour)
setInterval(() => {
  try {
    const files = fs.readdirSync(AUDIO_DIR);
    const cutoff = Date.now() - 3600000;
    for (const f of files) {
      const fp = path.join(AUDIO_DIR, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch {}
    }
  } catch {}
}, 600000);

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
};

// ─── Gateway HTTP helper ───────────────────────────────────────
function gatewayPost(urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${GATEWAY}${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 360000
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('gateway timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Text cleaning for voice ──────────────────────────────────
function cleanForVoice(text) {
  return text
    .replace(/🍔\s*\*{0,2}BIG JOHN SAID:\*{0,2}\s*"[^"]*"\s*🍔/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^MEDIA:.*$/gm, '')
    .replace(/\[\[tts:[^\]]*\]\]/g, '')
    .replace(/\[\[\/tts:[^\]]*\]\]/g, '')
    .replace(/\[\[reply_to[^\]]*\]\]/g, '')
    .replace(/NO_REPLY/g, '')
    .replace(/HEARTBEAT_OK/g, '')
    .replace(/ANNOUNCE_SKIP/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Transcription ─────────────────────────────────────────────

// Cloud: Groq Whisper API (fast, reliable)
async function transcribeGroq(filePath) {
  // Use curl for multipart upload (simpler than implementing multipart in node http)
  return new Promise((resolve, reject) => {
    const cmd = `curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
      -H "Authorization: Bearer ${GROQ_API_KEY}" \
      -H "Content-Type: multipart/form-data" \
      -F "file=@${filePath}" \
      -F "model=whisper-large-v3-turbo" \
      -F "response_format=json" \
      -F "language=en"`;
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Groq API error: ${err.message}`));
      try {
        const data = JSON.parse(stdout);
        if (data.error) return reject(new Error(`Groq: ${data.error.message}`));
        resolve(data.text || '');
      } catch (e) {
        reject(new Error(`Groq parse error: ${stdout.substring(0, 200)}`));
      }
    });
  });
}

// Local: whisper-cli (fallback)
function transcribeLocal(filePath) {
  return new Promise((resolve, reject) => {
    execFile('whisper-cli', [
      '-m', WHISPER_MODEL, '--no-timestamps', '-np', '-f', filePath
    ], { timeout: 30000, env: { ...process.env, LD_LIBRARY_PATH: '/home/jack/.local/lib' } }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

// Try Groq first, fall back to local
async function transcribe(filePath) {
  if (GROQ_API_KEY) {
    try {
      console.log('[transcribe] Using Groq API...');
      const text = await transcribeGroq(filePath);
      console.log(`[transcribe] Groq result: "${text.substring(0, 80)}"`);
      return text;
    } catch (e) {
      console.log(`[transcribe] Groq failed: ${e.message}, falling back to local`);
    }
  }
  console.log('[transcribe] Using local whisper-cli...');
  const text = await transcribeLocal(filePath);
  console.log(`[transcribe] Local result: "${text.substring(0, 80)}"`);
  return text;
}

// ─── Audio conversion ──────────────────────────────────────────
function convertToWav(inputPath) {
  const wavPath = inputPath + '.wav';
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', wavPath
    ], { timeout: 15000 }, (err) => {
      if (err) return reject(err);
      resolve(wavPath);
    });
  });
}

// ─── TTS: Server-side Edge TTS ─────────────────────────────────
function generateTTS(text, voice) {
  const filename = `tts_${Date.now()}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);
  // Truncate text for TTS (keep under 3000 chars)
  const ttsText = text.length > 3000 ? text.substring(0, 2997) + '...' : text;
  
  return new Promise((resolve, reject) => {
    // Escape single quotes for shell
    const escaped = ttsText.replace(/'/g, "'\\''");
    exec(`edge-tts --voice "${voice || DEFAULT_VOICE}" --text '${escaped}' --write-media "${filepath}"`, 
      { timeout: 30000 }, (err) => {
        if (err) return reject(err);
        resolve({ filename, filepath, url: `/audio/${filename}` });
      });
  });
}

// ─── Get last assistant message ────────────────────────────────
async function getLastAssistantMessage(token) {
  const res = await gatewayPost('/tools/invoke', {
    tool: 'sessions_history',
    args: { sessionKey: 'agent:main:main', limit: 10, includeTools: false }
  }, token);

  const msgs = res.data?.result?.details?.messages || res.data?.result?.messages;
  if (res.data?.ok && msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        let text = '';
        if (typeof msgs[i].content === 'string') text = msgs[i].content;
        else if (Array.isArray(msgs[i].content)) {
          const tp = msgs[i].content.find(p => p.type === 'text');
          if (tp) text = tp.text;
        }
        // Skip non-content messages
        if (!text || text === 'NO_REPLY' || text === 'HEARTBEAT_OK' || /^MEDIA:/.test(text.trim())) continue;
        if (/^🎙️\s*\*{0,2}YOU SAID/.test(text) || /^🎤\s*\*?Voice:?\*?/.test(text) || /^⚡\s/.test(text)) continue;
        if (text === 'ANNOUNCE_SKIP') continue;
        text = text.replace(/^MEDIA:.*$/gm, '').trim();
        if (!text) continue;
        return { text, ts: msgs[i].timestamp || 0 };
      }
    }
  }
  return { text: '', ts: 0 };
}

// ─── Main voice flow ───────────────────────────────────────────
async function sendAndWaitForReply(token, message) {
  const before = await getLastAssistantMessage(token);

  // Fire message to gateway (don't await — it blocks until AI finishes)
  console.log(`[send] Sending to gateway...`);
  gatewayPost('/tools/invoke', {
    tool: 'sessions_send',
    args: { sessionKey: 'agent:main:main', message: `[🎤 Voice] ${message}` }
  }, token).then(res => {
    console.log(`[send] Gateway returned: ok=${res.data?.ok}`);
  }).catch(err => {
    console.log(`[send] Gateway error: ${err.message}`);
  });

  // Show transcript in Telegram
  gatewayPost('/tools/invoke', {
    tool: 'message',
    args: { action: 'send', channel: 'telegram', target: TELEGRAM_CHAT_ID, message: `🎙️ **YOU SAID:** "${message}"` }
  }, token).catch(() => {});

  await sleep(2000);

  // Poll for response (up to 2 minutes)
  console.log(`[poll] Waiting for reply (before ts=${before.ts})...`);
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const after = await getLastAssistantMessage(token);
    if (i % 5 === 0) console.log(`[poll] Check #${i}: ts=${after.ts}`);
    if (after.ts > before.ts && after.text && after.text !== before.text) {
      console.log(`[poll] Got reply after ${(i + 1) * 2}s (${after.text.length} chars)`);
      return { text: after.text };
    }
  }
  console.log(`[poll] Timed out after 300s`);
  return { text: 'Sorry, I didn\'t get a response. Try again.' };
}

// ─── Multipart parser ──────────────────────────────────────────
function parseMultipart(buffer, boundary) {
  const parts = [];
  const str = buffer.toString('binary');
  const segments = str.split(`--${boundary}`);
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.startsWith('--')) break;
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = segment.substring(0, headerEnd);
    const bodyStr = segment.substring(headerEnd + 4).replace(/\r\n$/, '');
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        data: Buffer.from(bodyStr, 'binary')
      });
    }
  }
  return parts;
}

// ─── HTTP Server ───────────────────────────────────────────────
// HTTPS with self-signed cert for PWA install + mic access
const SSL_KEY = path.join(__dirname, 'key.pem');
const SSL_CERT = path.join(__dirname, 'cert.pem');
const useHttps = fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT);

const serverHandler = async (req, res) => {

  // ── Voice send endpoint ──────────────────────────────────────
  if (req.url === '/api/voice-send' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
      return;
    }

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing boundary' }));
      return;
    }

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(body);
        const parts = parseMultipart(buffer, boundary);
        const audioPart = parts.find(p => p.name === 'audio');
        const tokenPart = parts.find(p => p.name === 'token');
        const voicePart = parts.find(p => p.name === 'voice');

        if (!audioPart || !tokenPart) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing audio or token' }));
          return;
        }

        const token = tokenPart.data.toString().trim();
        const voice = voicePart ? voicePart.data.toString().trim() : DEFAULT_VOICE;

        // Save audio file
        const ext = audioPart.filename ? path.extname(audioPart.filename) : '.webm';
        const tempFile = path.join(UPLOAD_DIR, `voice_${Date.now()}${ext}`);
        fs.writeFileSync(tempFile, audioPart.data);
        console.log(`[voice] Audio: ${audioPart.data.length} bytes`);

        // Convert to WAV
        let wavFile;
        try {
          wavFile = await convertToWav(tempFile);
          fs.unlink(tempFile, () => {});
        } catch (e) {
          console.log(`[voice] WAV conversion failed: ${e.message}`);
          wavFile = tempFile;
        }

        // Transcribe (Groq or local fallback)
        const transcript = await transcribe(wavFile);
        fs.unlink(wavFile, () => {});

        if (!transcript || transcript.trim().length < 2) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No speech detected', transcript: '' }));
          return;
        }

        console.log(`[voice] Transcript: "${transcript}"`);

        // Send to AI and wait for reply
        const result = await sendAndWaitForReply(token, transcript);
        const voiceText = cleanForVoice(result.text);
        console.log(`[voice] Reply: ${voiceText.length} chars`);

        // Generate TTS audio
        let audioUrl = null;
        try {
          const tts = await generateTTS(voiceText, voice);
          audioUrl = tts.url;
          console.log(`[voice] TTS generated: ${tts.filename}`);
        } catch (e) {
          console.log(`[voice] TTS failed: ${e.message}`);
        }

        // Send AI reply to Telegram
        gatewayPost('/tools/invoke', {
          tool: 'message',
          args: { action: 'send', channel: 'telegram', target: TELEGRAM_CHAT_ID, message: `⚡ ${result.text}` }
        }, token).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          transcript,
          reply: voiceText,
          fullReply: result.text,
          audioUrl
        }));

      } catch (err) {
        console.error('[voice] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── New session endpoint ─────────────────────────────────────
  if (req.url === '/api/new-session' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { token } = JSON.parse(body);
        if (!token) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing token' }));
          return;
        }
        console.log('[new-session] Sending /new command...');
        // Send /new as a chat message so OpenClaw processes it as a command
        await gatewayPost('/v1/chat/completions', {
          model: 'main',
          messages: [{ role: 'user', content: '/new' }]
        }, token);
        console.log('[new-session] Session reset sent');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Voices list endpoint ─────────────────────────────────────
  if (req.url === '/api/voices' && req.method === 'GET') {
    exec('edge-tts --list-voices 2>/dev/null | grep "en-US"', (err, stdout) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to list voices' }));
        return;
      }
      const voices = stdout.trim().split('\n').map(line => {
        const parts = line.split(/\s{2,}/);
        return { id: parts[0], gender: parts[1], tags: parts[2], description: parts[3] };
      }).filter(v => v.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voices, default: DEFAULT_VOICE }));
    });
    return;
  }

  // ── Serve TTS audio files ────────────────────────────────────
  if (req.url.startsWith('/audio/') && req.method === 'GET') {
    const filename = path.basename(req.url);
    const filepath = path.join(AUDIO_DIR, filename);
    fs.readFile(filepath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // ── Static files ─────────────────────────────────────────────
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache', 'Expires': '0'
    });
    res.end(data);
  });
};

const server = useHttps
  ? https.createServer({ key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) }, serverHandler)
  : http.createServer(serverHandler);

// Graceful shutdown to avoid EADDRINUSE on restart
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zippy Voice v2 serving on ${useHttps ? 'https' : 'http'}://0.0.0.0:${PORT}`);
  console.log(`  Groq API: ${GROQ_API_KEY ? 'configured' : 'NOT SET (using local whisper)'}`);
  console.log(`  TTS voice: ${DEFAULT_VOICE}`);
  console.log(`  Gateway: ${GATEWAY}`);
});
