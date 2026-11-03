const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
const outDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', port: PORT }));
  }

  if (req.method === 'POST' && req.url === '/save-base64') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        if (!obj.filename || !obj.data) return res.writeHead(400).end(JSON.stringify({ error: 'missing filename or data' }));
        const filename = path.basename(obj.filename);
        const outPath = path.join(outDir, filename);
        const buf = Buffer.from(obj.data, 'base64');
        fs.writeFileSync(outPath, buf);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ saved: true, path: path.relative(__dirname, outPath) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/save-and-convert') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        if (!obj.filename || !obj.data) return res.writeHead(400).end(JSON.stringify({ error: 'missing filename or data' }));
        const filename = path.basename(obj.filename);
        const base = filename.replace(/\.[^.]+$/, '');
        const inputPath = path.join(outDir, base + '_in');
        const outPath = path.join(outDir, base + '.mp4');
        // write input buffer (assume webm if not specified)
        const buf = Buffer.from(obj.data, 'base64');
        fs.writeFileSync(inputPath, buf);
        // spawn ffmpeg to convert
        const { spawn } = require('child_process');
        const ff = spawn('ffmpeg', ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', outPath]);
        let stderr = '';
        ff.stderr.on('data', (d) => { stderr += d.toString(); });
        ff.on('error', (err) => {
          try { fs.unlinkSync(inputPath); } catch (e) {}
          return res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'ffmpeg not found or failed to start', details: err.message }));
        });
        ff.on('close', (code) => {
          try { fs.unlinkSync(inputPath); } catch (e) {}
          if (code !== 0) {
            return res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'ffmpeg failed', code, details: stderr }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ saved: true, path: path.relative(__dirname, outPath) }));
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Native save server listening on http://127.0.0.1:${PORT}`));
