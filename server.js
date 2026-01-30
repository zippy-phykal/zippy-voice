const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 8080;
const DIR = __dirname;
const GATEWAY = process.env.GATEWAY_URL || 'http://100.85.34.7:18789';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/home/jack/.local/share/whisper/ggml-base.en.bin';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/zippy-voice';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png'
};

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
      timeout: 120000
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanForVoice(text) {
  return text
    .replace(/🍔\s*\*{0,2}BIG JOHN SAID:\*{0,2}\s*"[^"]*"\s*🍔/gi, '') // strip echo block
    .replace(/```[\s\S]*?```/g, '') // remove code blocks
    .replace(/`([^`]+)`/g, '$1')    // remove inline code backticks
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold → plain
    .replace(/\*([^*]+)\*/g, '$1')     // italic → plain
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#{1,6}\s*/g, '')       // remove headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text only
    .replace(/^[-*•]\s+/gm, '')      // remove bullet points
    .replace(/^\d+\.\s+/gm, '')      // remove numbered lists
    .replace(/\n{2,}/g, '. ')        // double newlines → pause
    .replace(/\n/g, ' ')             // single newlines → space
    .replace(/\s{2,}/g, ' ')         // collapse whitespace
    .trim();
}

function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    execFile('whisper-cli', [
      '-m', WHISPER_MODEL, '--no-timestamps', '-np', '-f', filePath
    ], { timeout: 30000 }, (err, stdout) => {
      fs.unlink(filePath, () => {});
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

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
        // Skip empty, NO_REPLY, HEARTBEAT, or MEDIA-only responses
        if (!text || text === 'NO_REPLY' || text === 'HEARTBEAT_OK' || /^MEDIA:/.test(text.trim())) continue;
        // Strip MEDIA lines from response
        text = text.replace(/^MEDIA:.*$/gm, '').trim();
        if (!text) continue;
        return { text, ts: msgs[i].timestamp || 0 };
      }
    }
  }
  return { text: '', ts: 0 };
}

async function sendAndWaitForReply(token, message) {
  // Get the last assistant message before we send
  const before = await getLastAssistantMessage(token);

  // Fire-and-forget: inject message into the main Telegram session
  // Don't await — sessions_send blocks until the AI finishes responding
  console.log(`[send] Firing message to gateway (no-wait)...`);
  gatewayPost('/tools/invoke', {
    tool: 'sessions_send',
    args: {
      sessionKey: 'agent:main:main',
      message: `[🎤 Voice] ${message}`
    }
  }, token).then(res => {
    console.log(`[send] Gateway returned: ok=${res.data?.ok}, status=${res.status}`);
  }).catch(err => {
    console.log(`[send] Gateway error: ${err.message}`);
  });

  // Give the gateway a moment to accept the message before we start polling
  await sleep(2000);

  // Poll for new assistant response (up to 2 minutes)
  console.log(`[poll] Before ts=${before.ts}, text="${(before.text || '').substring(0, 50)}"`);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const after = await getLastAssistantMessage(token);
    if (i % 5 === 0) console.log(`[poll] Check #${i}: ts=${after.ts}, text="${(after.text || '').substring(0, 50)}"`);
    if (after.ts > before.ts && after.text && after.text !== before.text) {
      console.log(`[poll] Got reply after ${i * 2}s`);
      const voiceText = cleanForVoice(after.text);
      return { reply: voiceText, fullReply: after.text };
    }
  }

  console.log(`[poll] Timed out after 120s`);
  return { reply: 'No response received', fullReply: 'No response received' };
}

const server = http.createServer(async (req, res) => {
  // Voice send endpoint
  if (req.url === '/api/voice-send' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
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

          if (!audioPart || !tokenPart) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing audio or token' }));
            return;
          }

          const token = tokenPart.data.toString().trim();
          const ext = audioPart.filename ? path.extname(audioPart.filename) : '.webm';
          const tempFile = path.join(UPLOAD_DIR, `voice_${Date.now()}${ext}`);
          fs.writeFileSync(tempFile, audioPart.data);

          // Convert to WAV for Whisper
          let wavFile;
          try {
            wavFile = await convertToWav(tempFile);
            fs.unlink(tempFile, () => {});
          } catch (e) {
            wavFile = tempFile;
          }

          // Transcribe
          const transcript = await transcribeAudio(wavFile);
          if (!transcript) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No speech detected', transcript: '' }));
            return;
          }

          // Send to main session and wait for reply
          console.log(`[voice] Transcript: "${transcript}"`);
          const result = await sendAndWaitForReply(token, transcript);
          console.log(`[voice] Reply: "${(result.reply || '').substring(0, 100)}..."`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ transcript, ...result }));
        } catch (err) {
          console.error('Voice send error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      // JSON body (text-based)
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { message, token } = JSON.parse(body);
          if (!message || !token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing message or token' }));
            return;
          }
          const result = await sendAndWaitForReply(token, message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
    return;
  }

  // Static files
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
});

// Simple multipart parser
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zippy Voice serving on http://0.0.0.0:${PORT}`);
});
