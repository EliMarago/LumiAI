/* ===================================
   LumiAI – Server locale
   - serve l'app (index.html, app.js, style.css)
   - elabora i video con ffmpeg (denoise, upscaling, nitidezza, colore, audio preservato)
   =================================== */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildVideoFilter } = require('./video-filters');

const app = express();
const PORT = 3001;
const HOST = '127.0.0.1';

const outDir = path.join(__dirname, 'outputs');
const tmpDir = path.join(__dirname, 'outputs', '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Limite di sicurezza sulla risoluzione in uscita (lato lungo)
const MAX_OUTPUT_SIDE = 3840; // 4K

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir),
    // nome casuale: il nome fornito dal client non tocca mai il filesystem
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
  fileFilter: (req, file, cb) => cb(null, /^video\//.test(file.mimetype || '')),
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- App statica (solo i file del frontend) ----------
const STATIC_FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css',
  '/video-filters.js': 'video-filters.js',
  '/vendor/ffmpeg/ffmpeg.js': 'vendor/ffmpeg/ffmpeg.js', '/vendor/ffmpeg/814.ffmpeg.js': 'vendor/ffmpeg/814.ffmpeg.js',
};
for (const [route, file] of Object.entries(STATIC_FILES)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// ---------- Health ----------
let ffmpegAvailable = false;
function checkFfmpeg() {
  const p = spawn('ffmpeg', ['-version']);
  p.on('error', () => { ffmpegAvailable = false; });
  p.on('close', (code) => { ffmpegAvailable = code === 0; });
}
checkFfmpeg();
app.get('/api/health', (req, res) => res.json({ status: 'ok', ffmpeg: ffmpegAvailable }));

// ---------- Utility ----------
function sanitizeBaseName(name) {
  const base = path.parse(path.basename(String(name || ''))).name;
  const clean = base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
  return clean || `lumiai_${Date.now()}`;
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe: ' + err.trim()));
      try {
        const info = JSON.parse(out);
        const v = (info.streams || []).find((s) => s.codec_type === 'video');
        if (!v) return reject(new Error('Nessuna traccia video trovata'));
        // rotazione (video da smartphone)
        let rot = 0;
        const sd = (v.side_data_list || []).find((s) => s.rotation !== undefined);
        if (sd) rot = Math.abs(Number(sd.rotation)) % 180;
        else if (v.tags && v.tags.rotate) rot = Math.abs(Number(v.tags.rotate)) % 180;
        const w = rot === 90 ? v.height : v.width;
        const h = rot === 90 ? v.width : v.height;
        resolve({
          width: w, height: h,
          duration: Number(info.format && info.format.duration) || Number(v.duration) || 0,
          hasAudio: (info.streams || []).some((s) => s.codec_type === 'audio'),
        });
      } catch (e) { reject(e); }
    });
  });
}

function buildFilters(meta, opts) {
  return buildVideoFilter(meta, opts, MAX_OUTPUT_SIDE);
}

// ---------- Job video ----------
const jobs = new Map(); // id -> { status, progress, error, outPath, outName, ... }

app.post('/api/video/enhance', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file video ricevuto' });
  if (!ffmpegAvailable) {
    fs.rm(req.file.path, { force: true }, () => {});
    return res.status(500).json({ error: 'ffmpeg non installato. Esegui: brew install ffmpeg' });
  }

  const inputPath = req.file.path;
  const opts = {
    scale: parseInt(req.body.scale, 10),
    noise: req.body.noise,
    sharpen: req.body.sharpen,
    color: req.body.color,
  };

  let meta;
  try {
    meta = await probe(inputPath);
  } catch (e) {
    fs.rm(inputPath, { force: true }, () => {});
    return res.status(400).json({ error: 'File video non leggibile', details: e.message });
  }

  const { filter, outW, outH, effectiveScale } = buildFilters(meta, opts);
  const id = crypto.randomUUID();
  const outName = `${sanitizeBaseName(req.file.originalname)}_lumiAI_enhanced.mp4`;
  const outPath = path.join(outDir, outName);
  const job = { status: 'processing', progress: 0, error: null, outPath, outName, width: outW, height: outH, effectiveScale };
  jobs.set(id, job);

  const args = [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath,
  ];
  const ff = spawn('ffmpeg', args);
  let stderr = '';
  ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  ff.stdout.on('data', (d) => {
    const m = String(d).match(/out_time_(?:ms|us)=(\d+)/g);
    if (m && meta.duration > 0) {
      const us = Number(m[m.length - 1].split('=')[1]);
      job.progress = Math.min(99, Math.round((us / 1e6 / meta.duration) * 100));
    }
  });
  ff.on('error', (err) => {
    job.status = 'error'; job.error = 'Impossibile avviare ffmpeg: ' + err.message;
    fs.rm(inputPath, { force: true }, () => {});
  });
  ff.on('close', (code) => {
    fs.rm(inputPath, { force: true }, () => {});
    if (code === 0) { job.status = 'done'; job.progress = 100; }
    else { job.status = 'error'; job.error = 'ffmpeg ha restituito un errore'; job.details = stderr; }
  });

  res.json({ id, width: outW, height: outH, effectiveScale, duration: meta.duration, hasAudio: meta.hasAudio });
});

app.get('/api/video/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job non trovato' });
  res.json({ status: job.status, progress: job.progress, error: job.error, details: job.details, file: job.outName });
});

app.get('/api/video/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'File non disponibile' });
  res.download(job.outPath, job.outName);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Errore server' });
});

app.listen(PORT, HOST, () => {
  console.log(`LumiAI attivo su http://${HOST}:${PORT}  (apri questo indirizzo nel browser)`);
});
