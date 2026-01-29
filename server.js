const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 8080;
const DIR = __dirname;
const GATEWAY = 'http://100.85.34.7:18789';
const WHISPER_MODEL = '/home/jack/.local/share/whisper/ggml-base.en.bin';
const UPLOAD_DIR = '/tmp/zippy-voice';

// Ensure upload dir exists
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

function sendToTelegram(token, text) {
  return gatewayPost('/tools/invoke', {
    tool: 'message',
    args: { action: 'send', channel: 'telegram', target: '8398867491', message: text }
  }, token);
}

async function getRecentHistory(token, limit = 20) {
  const res = await gatewayPost('/tools/invoke', {
    tool: 'sessions_history',
    args: { sessionKey: 'agent:main:main', limit, includeTools: false }
  }, token);

  if (!res.data?.ok || !res.data.result?.messages) return [];

  const messages = [];
  for (const msg of res.data.result.messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(p => p.type === 'text');
      if (textPart) text = textPart.text;
    }
    if (text) messages.push({ role, content: text });
  }
  return messages;
}

function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    execFile('whisper-cli', [
      '-m', WHISPER_MODEL,
      '--no-timestamps', '-np',
      '-f', filePath
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      // Clean up temp file
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

const server = http.createServer(async (req, res) => {
  // Audio upload + transcribe + send endpoint
  if (req.url === '/api/voice-send' && req.method === 'POST') {
    // Multipart: audio file + token
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart
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
            wavFile = tempFile; // Try raw if ffmpeg fails
          }

          // Transcribe with Whisper
          const transcript = await transcribeAudio(wavFile);

          if (!transcript) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No speech detected', transcript: '' }));
            return;
          }

          // Send user's message to Telegram
          await sendToTelegram(token, `🎤 ${transcript}`);

          // Get recent conversation history for context
          let history = [];
          try { history = await getRecentHistory(token); } catch (e) {}

          // Get AI response with full context
          const aiRes = await gatewayPost('/v1/chat/completions', {
            model: 'clawdbot:main',
            messages: [...history, { role: 'user', content: transcript }],
            stream: false
          }, token, { 'x-clawdbot-session-key': 'agent:main:main' });

          if (aiRes.status === 401) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid auth token' }));
            return;
          }

          const reply = aiRes.data?.choices?.[0]?.message?.content || 'No response';

          // Auto-summarize long responses for voice
          let voiceReply = reply;
          if (reply.length > 500) {
            try {
              const summaryRes = await gatewayPost('/v1/chat/completions', {
                model: 'clawdbot:main',
                messages: [{
                  role: 'user',
                  content: `Summarize this in 1-2 short spoken sentences for someone driving. No markdown, no lists, just natural speech:\n\n${reply}`
                }],
                stream: false
              }, token);
              const summary = summaryRes.data?.choices?.[0]?.message?.content;
              if (summary && summary.length < reply.length) voiceReply = summary;
            } catch (e) {}
          }

          // Send response to Telegram
          await sendToTelegram(token, `⚡ ${reply}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ transcript, reply: voiceReply, fullReply: reply }));
        } catch (err) {
          console.error('Voice send error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      // JSON body (legacy text-based)
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
          await sendToTelegram(token, `🎤 ${message}`);
          let history = [];
          try { history = await getRecentHistory(token); } catch (e) {}
          const aiRes = await gatewayPost('/v1/chat/completions', {
            model: 'clawdbot:main',
            messages: [...history, { role: 'user', content: message }],
            stream: false
          }, token, { 'x-clawdbot-session-key': 'agent:main:main' });
          if (aiRes.status === 401) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid auth token' }));
            return;
          }
          const reply = aiRes.data?.choices?.[0]?.message?.content || 'No response';
          await sendToTelegram(token, `⚡ ${reply}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reply, fullReply: reply }));
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
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const str = buffer.toString('binary');
  const segments = str.split(`--${boundary}`);

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.startsWith('--')) break; // End boundary

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
