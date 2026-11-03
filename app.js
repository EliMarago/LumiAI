/* ===================================
   LumiAI – App Logic
   Foto:  ESRGAN (UpscalerJS + TensorFlow.js) nel browser + filtri (rumore, nitidezza, colore)
   Video: elaborazione sul server locale con ffmpeg (npm start)
   =================================== */
(function () {
  'use strict';

  const q = (id) => document.getElementById(id);
  const el = {
    uploadZone: q('upload-zone'), uploadSection: q('upload-section'), processingPanel: q('processing-panel'),
    fileInput: q('file-input'), btnEnhance: q('btn-enhance'), btnDownload: q('btn-download'), btnChangeFile: q('btn-change-file'),
    fileName: q('file-name'), fileSize: q('file-size'), fileTypeBadge: q('file-type-badge'),
    imgWrapper: q('img-preview-wrapper'), videoWrapper: q('video-preview-wrapper'), placeholder: q('preview-placeholder'),
    video: q('video-preview'), videoOverlay: q('video-overlay'),
    baWrapper: q('before-after-wrapper'), before: q('before-canvas'), after: q('after-canvas'), baLabels: q('ba-labels'), baDivider: q('ba-divider'),
    scale: q('scale-select'), model: q('model-select'), noise: q('noise-select'), sharpen: q('sharpen-select'), color: q('color-select'),
    aiBadge: q('ai-model-badge'), aiText: q('ai-status-text'),
    overlay: q('processing-overlay'), title: q('processing-title'), sub: q('processing-sub'), fill: q('progress-fill'), pct: q('progress-pct'),
  };

  // Server locale: stesso origin se l'app è servita da `npm start`, altrimenti 127.0.0.1:3001
  const API = (location.protocol.startsWith('http') && location.port === '3001') ? '' : 'http://127.0.0.1:3001';

  // Limite area output (Safari: ~16.7 MP per canvas)
  const MAX_OUTPUT_PIXELS = 16000000;

  // ---------- Stato ----------
  const state = {
    file: null, objectUrl: null, image: null,
    resultCanvas: null, resultBlob: null,
    videoJobId: null, videoResultUrl: null, videoResultName: null,
    busy: false, aiReady: false,
  };
  const upscalers = {}; // cache per scala

  // ---------- Helper UI ----------
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const show = (e, yes) => { if (e) e.classList.toggle('hidden', !yes); };
  const setText = (e, t) => { if (e) e.textContent = t; };

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 ** 3) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  }

  function showToast(message, type = 'info', ms = 3500) {
    const old = q('lumi-toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'lumi-toast'; t.textContent = message; t.setAttribute('role', 'status');
    const bg = type === 'error' ? '#7a1f1f' : type === 'success' ? '#1f5a2e' : '#111';
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)',
      background: bg, color: '#fff', padding: '10px 18px', borderRadius: '8px', zIndex: 9999, fontSize: '0.9rem',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function setProgress(p, sub) {
    const v = Math.max(0, Math.min(100, Math.round(p)));
    if (el.fill) el.fill.style.width = v + '%';
    setText(el.pct, v + '%');
    if (sub) setText(el.sub, sub);
  }

  function setStep(n) {
    for (let i = 1; i <= 5; i++) {
      const s = q('step-' + i); if (!s) continue;
      s.classList.toggle('done', i < n);
      s.classList.toggle('active', i === n);
    }
  }

  function openOverlay(title) {
    setText(el.title, title); setProgress(0, 'Preparazione…'); setStep(1); show(el.overlay, true);
  }
  function closeOverlay(delay = 500) { setTimeout(() => show(el.overlay, false), delay); }

  function setBusy(b) {
    state.busy = b;
    if (el.btnEnhance) { el.btnEnhance.disabled = b; el.btnEnhance.style.opacity = b ? '0.6' : ''; }
  }

  function setBadge(text, color) {
    setText(el.aiText, text);
    const dot = el.aiBadge && el.aiBadge.querySelector('.ai-status-dot');
    if (dot) dot.style.background = color;
  }

  // ---------- Inizializzazione AI ----------
  async function initAI() {
    const hasLibs = typeof window.Upscaler === 'function' && typeof window.tf !== 'undefined' &&
      window.ESRGANSlim2x && window.ESRGANSlim4x && window.ESRGANSlim8x;
    if (!hasLibs) {
      state.aiReady = false;
      setBadge('AI non disponibile – solo filtri', '#e05a5a');
      console.warn('[LumiAI] Librerie AI non caricate (sei offline?). Uso upscaling classico + filtri.');
      return;
    }
    try {
      await tf.ready();
      const backend = tf.getBackend();
      state.aiReady = true;
      if (backend === 'webgl' || backend === 'webgpu') setBadge('ESRGAN AI pronto (GPU)', '#4cd07d');
      else setBadge('ESRGAN AI pronto (CPU, lento)', '#F5C842');
    } catch (err) {
      console.warn('[LumiAI] TensorFlow non inizializzato:', err);
      state.aiReady = false;
      setBadge('AI non disponibile – solo filtri', '#e05a5a');
    }
  }

  const MODEL_PREFIX = { slim: 'ESRGANSlim', medium: 'ESRGANMedium', thick: 'ESRGANThick' };
  const MODEL_LABEL = { slim: 'Slim', medium: 'Medium', thick: 'Thick' };

  // Restituisce { up, kind }: se il modello richiesto non è caricato, ripiega su Slim
  function getUpscaler(scale, kind) {
    if (!window[(MODEL_PREFIX[kind] || '') + scale + 'x']) kind = 'slim';
    const key = kind + scale;
    if (!upscalers[key]) {
      upscalers[key] = new window.Upscaler({ model: window[MODEL_PREFIX[kind] + scale + 'x'] });
    }
    return { up: upscalers[key], kind };
  }

  function disposeUpscalers(exceptKey) {
    for (const k of Object.keys(upscalers)) {
      if (k === exceptKey) continue;
      try { upscalers[k].dispose(); } catch (e) {}
      delete upscalers[k];
    }
  }

  // ---------- Caricamento file ----------
  function revokeObjectUrl() {
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
  }

  function clearResults() {
    state.resultCanvas = null; state.resultBlob = null;
    state.videoJobId = null; state.videoResultUrl = null; state.videoResultName = null;
    show(el.after, false); show(el.baLabels, false); show(el.baDivider, false); show(el.videoOverlay, false);
    show(el.btnDownload, false);
  }

  function loadFile(file) {
    if (!file || state.busy) return;
    const type = (file.type || '').toLowerCase();
    const isImg = type.startsWith('image/');
    const isVid = type.startsWith('video/');
    if (!isImg && !isVid) { showToast('Tipo di file non supportato', 'error'); return; }

    clearResults();
    state.file = file; state.image = null;
    revokeObjectUrl();
    state.objectUrl = URL.createObjectURL(file);
    setText(el.fileName, file.name || '');
    setText(el.fileSize, formatSize(file.size || 0));
    setText(el.fileTypeBadge, isVid ? 'VID' : 'IMG');
    show(el.uploadSection, false); show(el.processingPanel, true); show(el.placeholder, false);
    show(el.imgWrapper, isImg); show(el.videoWrapper, isVid);

    if (isImg) {
      if (el.video) { try { el.video.pause(); } catch (e) {} el.video.removeAttribute('src'); }
      const img = new Image();
      img.onload = () => { state.image = img; drawPreview(el.before, img); };
      img.onerror = () => showToast('Impossibile leggere questa immagine (formato non supportato dal browser?)', 'error', 5000);
      img.src = state.objectUrl;
    } else {
      el.video.src = state.objectUrl;
      el.video.load();
      checkServer().then((ok) => {
        if (!ok) showToast('Per i video avvia il server: apri il Terminale nella cartella LumiaAI e digita "npm start"', 'error', 7000);
      });
    }
  }

  // ---------- Anteprima prima/dopo ----------
  function previewSize(srcW, srcH) {
    const box = el.baWrapper || el.before;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(Math.round(((box && box.clientWidth) || 520) * dpr), 1600, srcW * 8);
    return { w, h: Math.max(1, Math.round(w * srcH / srcW)) };
  }

  function drawPreview(canvas, src, size) {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const { w, h } = size || previewSize(sw, sh);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
  }

  function setSplit(pct) {
    const p = Math.max(0, Math.min(100, pct));
    if (el.after) el.after.style.clipPath = `inset(0 0 0 ${p}%)`;
    if (el.baDivider) el.baDivider.style.left = p + '%';
  }

  if (el.baWrapper) {
    let dragging = false;
    const move = (ev) => {
      if (!dragging || !state.resultCanvas) return;
      const r = el.baWrapper.getBoundingClientRect();
      setSplit(((ev.clientX - r.left) / r.width) * 100);
    };
    el.baWrapper.addEventListener('pointerdown', (ev) => {
      if (!state.resultCanvas) return;
      dragging = true; el.baWrapper.setPointerCapture(ev.pointerId); move(ev);
    });
    el.baWrapper.addEventListener('pointermove', move);
    el.baWrapper.addEventListener('pointerup', () => { dragging = false; });
    el.baWrapper.addEventListener('pointercancel', () => { dragging = false; });
  }

  window.addEventListener('resize', () => {
    if (!state.image) return;
    const size = previewSize(state.image.naturalWidth, state.image.naturalHeight);
    drawPreview(el.before, state.image, size);
    if (state.resultCanvas) drawPreview(el.after, state.resultCanvas, size);
  });

  // ---------- Elaborazione immagine (pixel) ----------
  // Box blur separabile (RGB), alfa copiato. O(n) indipendente dal raggio.
  function boxBlur(src, w, h, r) {
    const tmp = new Uint8ClampedArray(src.length);
    const dst = new Uint8ClampedArray(src.length);
    const d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k)) * 4 + c];
        for (let x = 0; x < w; x++) {
          tmp[row + x * 4 + c] = sum / d;
          sum += src[row + Math.min(w - 1, x + r + 1) * 4 + c] - src[row + Math.max(0, x - r) * 4 + c];
        }
      }
    }
    const stride = w * 4;
    for (let x = 0; x < w; x++) {
      const col = x * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * stride + col + c];
        for (let y = 0; y < h; y++) {
          dst[y * stride + col + c] = sum / d;
          sum += tmp[Math.min(h - 1, y + r + 1) * stride + col + c] - tmp[Math.max(0, y - r) * stride + col + c];
        }
      }
    }
    for (let i = 3; i < src.length; i += 4) dst[i] = src[i];
    return dst;
  }

  const DENOISE = { light: { r: 1, t: 10 }, medium: { r: 2, t: 18 }, heavy: { r: 3, t: 28 } };
  // Nitidezza su due scale: d = dettaglio fine (raggio 1), c = microcontrasto/"clarity" (raggio 4),
  // max = limite per pixel che evita gli aloni sui bordi
  const SHARPEN = {
    low:    { d: 0.45, c: 0.12, max: 28 },
    medium: { d: 0.85, c: 0.22, max: 40 },
    high:   { d: 1.30, c: 0.32, max: 55 },
    ultra:  { d: 1.80, c: 0.45, max: 70 },
  };

  // Riduzione rumore edge-preserving: sfuma le aree uniformi, preserva i contorni.
  function denoiseCanvas(canvas, level) {
    const cfg = DENOISE[level]; if (!cfg) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const s = id.data;
    const b = boxBlur(s, canvas.width, canvas.height, cfg.r);
    const T = cfg.t;
    for (let i = 0; i < s.length; i += 4) {
      const diff = (Math.abs(s[i] - b[i]) + Math.abs(s[i + 1] - b[i + 1]) + Math.abs(s[i + 2] - b[i + 2])) / 3;
      const wgt = diff >= T ? 0 : 1 - diff / T;
      if (wgt > 0) {
        s[i] += (b[i] - s[i]) * wgt;
        s[i + 1] += (b[i + 1] - s[i + 1]) * wgt;
        s[i + 2] += (b[i + 2] - s[i + 2]) * wgt;
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // Nitidezza (unsharp mask con soglia) + correzione colore in un'unica passata
  function sharpenAndColor(canvas, sharpenLevel, colorMode) {
    const sh = SHARPEN[sharpenLevel] || null;
    if (!sh && (!colorMode || colorMode === 'none')) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h);
    const s = id.data;
    const blur = sh ? boxBlur(s, w, h, 1) : null;
    const blurWide = sh ? boxBlur(s, w, h, 4) : null;
    const lim = sh ? sh.max : 0;
    const clampD = (v) => (v > lim ? lim : v < -lim ? -lim : v);

    // parametri colore
    let contrast = 1, sat = 1, tone = 0, lo = 0, hi = 255;
    if (colorMode === 'vivid') { contrast = 1.06; sat = 1.25; }
    else if (colorMode === 'cinematic') { contrast = 1.10; sat = 0.92; tone = 1; }
    else if (colorMode === 'natural') {
      contrast = 1.02; sat = 1.06;
      // auto-livelli leggeri: percentili 0.3% / 99.7% della luminanza
      const hist = new Uint32Array(256); let n = 0;
      for (let i = 0; i < s.length; i += 16) { hist[(s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) | 0]++; n++; }
      let acc = 0; lo = 0; while (lo < 255 && (acc += hist[lo]) < n * 0.003) lo++;
      acc = 0; hi = 255; while (hi > 0 && (acc += hist[hi]) < n * 0.003) hi--;
      if (hi - lo < 64) { lo = 0; hi = 255; } // immagine a basso contrasto voluto: non forzare
      lo = Math.min(lo, 24); hi = Math.max(hi, 230);
    }
    const levels = 255 / (hi - lo);
    const doColor = colorMode && colorMode !== 'none';

    for (let i = 0; i < s.length; i += 4) {
      let r = s[i], g = s[i + 1], b = s[i + 2];
      if (blur) {
        const dr = r - blur[i], dg = g - blur[i + 1], db = b - blur[i + 2];
        // soglia: il dettaglio fine si amplifica solo dove c'è struttura, non sul rumore residuo
        // (soglia graduale: un taglio netto azzerava la nitidezza sui bordi morbidi tipici dell'upscaling)
        const mag = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
        const fine = sh.d * (mag >= 3 ? 1 : mag / 3);
        r += clampD(dr * fine + (r - blurWide[i]) * sh.c);
        g += clampD(dg * fine + (g - blurWide[i + 1]) * sh.c);
        b += clampD(db * fine + (b - blurWide[i + 2]) * sh.c);
      }
      if (doColor) {
        if (lo !== 0 || hi !== 255) { r = (r - lo) * levels; g = (g - lo) * levels; b = (b - lo) * levels; }
        r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128;
        const l = r * 0.299 + g * 0.587 + b * 0.114;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        if (tone) { // ombre verso il teal, luci verso l'arancio
          const t = (l / 255) - 0.5; // -0.5..0.5
          r += t * 22; b -= t * 22; g += t * 4;
        }
      }
      s[i] = r; s[i + 1] = g; s[i + 2] = b; // Uint8ClampedArray: clamp + arrotondamento automatici
    }
    ctx.putImageData(id, 0, 0);
  }

  function canvasUpscale(src, scale) {
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  async function aiUpscale(srcCanvas, scale, kind, onProgress) {
    const got = getUpscaler(scale, kind);
    const up = got.up;
    disposeUpscalers(got.kind + scale); // libera la memoria GPU dei modelli non in uso
    setStep(2); setText(el.sub, `Caricamento modello ESRGAN ${MODEL_LABEL[got.kind]} ${scale}×…`);
    try { await up.getModel(); } catch (e) { /* il modello si carica comunque al primo upscale */ }
    setStep(3);
    const input = tf.browser.fromPixels(srcCanvas);
    let out;
    try {
      out = await up.upscale(input, {
        output: 'tensor',
        patchSize: 64,
        padding: 6,
        progress: (p) => onProgress(typeof p === 'number' ? p : 0),
      });
    } finally {
      input.dispose();
    }
    const img = tf.tidy(() => {
      const t = out.rank === 4 ? out.squeeze([0]) : out;
      return t.clipByValue(0, 255).round().toInt();
    });
    out.dispose();
    const c = document.createElement('canvas');
    c.width = img.shape[1]; c.height = img.shape[0];
    await tf.browser.toPixels(img, c);
    img.dispose();
    return c;
  }

  async function enhanceImage() {
    const img = state.image;
    if (!img) { showToast('Immagine non ancora pronta', 'error'); return; }
    const requested = parseInt(el.scale.value, 10) || 2;
    const noise = el.noise.value, sharpen = el.sharpen.value, color = el.color.value;
    const modelKind = (el.model && el.model.value) || 'medium';

    openOverlay('Miglioramento foto in corso…');
    await nextFrame();

    // 1. copia a risoluzione nativa
    const src = document.createElement('canvas');
    src.width = img.naturalWidth; src.height = img.naturalHeight;
    src.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);

    // 2. riduzione rumore (prima dell'upscaling: più efficace, meno costosa)
    setProgress(3, 'Riduzione del rumore…'); await nextFrame();
    denoiseCanvas(src, noise);
    setProgress(10);

    // 3. scala effettiva compatibile con la memoria del browser
    let scale = requested;
    while (scale > 1 && src.width * src.height * scale * scale > MAX_OUTPUT_PIXELS) scale /= 2;
    if (scale < requested) {
      showToast(scale > 1
        ? `Immagine grande: upscaling ridotto a ${scale}× per non superare ~16 MP`
        : 'Immagine già ad alta risoluzione: applico solo rumore, nitidezza e colore', 'info', 5000);
    }

    let result = src;
    if (scale > 1) {
      if (state.aiReady) {
        try {
          if (modelKind === 'thick') showToast('Modello "Massima nitidezza": la prima volta scarica ~29 MB e può richiedere alcuni minuti', 'info', 6000);
          result = await aiUpscale(src, scale, modelKind, (p) => setProgress(10 + p * 75, `Super-risoluzione AI ${scale}× – ${Math.round(p * 100)}%`));
        } catch (err) {
          console.error('[LumiAI] ESRGAN fallito, uso upscaling classico:', err);
          showToast('AI non riuscita su questo dispositivo: uso upscaling classico', 'error', 5000);
          result = canvasUpscale(src, scale);
        }
      } else {
        setStep(3); setProgress(50, `Upscaling ${scale}× (classico)…`); await nextFrame();
        result = canvasUpscale(src, scale);
      }
    }
    setProgress(86, 'Nitidezza e colore…'); setStep(4); await nextFrame();

    // 4. nitidezza + colore
    sharpenAndColor(result, sharpen, color);

    // 5. export
    setStep(5); setProgress(95, 'Finalizzazione…'); await nextFrame();
    const blob = await new Promise((res) => result.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Esportazione PNG fallita (immagine troppo grande?)');
    state.resultCanvas = result; state.resultBlob = blob;

    const size = previewSize(img.naturalWidth, img.naturalHeight);
    drawPreview(el.before, img, size);
    drawPreview(el.after, result, size);
    show(el.after, true); show(el.baLabels, true); show(el.baDivider, true);
    setSplit(50);
    show(el.btnDownload, true);
    setProgress(100, `Fatto: ${result.width}×${result.height}px`);
    setText(el.title, 'Elaborazione completata');
    showToast(`Foto migliorata: ${img.naturalWidth}×${img.naturalHeight} → ${result.width}×${result.height}. Trascina sull'anteprima per confrontare.`, 'success', 5000);
  }

  // ---------- Elaborazione video (server ffmpeg) ----------
  async function checkServer() {
    try {
      const r = await fetch(API + '/api/health', { cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      if (!j.ffmpeg) { showToast('ffmpeg non trovato sul server: esegui "brew install ffmpeg"', 'error', 7000); return false; }
      return true;
    } catch (e) { return false; }
  }

  function uploadVideo(file, fields, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + '/api/video/enhance');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || ('Errore server ' + xhr.status)));
      };
      xhr.onerror = () => reject(new Error('Server non raggiungibile'));
      xhr.send(form);
    });
  }

  async function pollJob(id, onProgress) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const r = await fetch(`${API}/api/video/status/${id}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.status === 'done') return j;
      if (j.status === 'error') {
        if (j.details) console.error('[LumiAI] ffmpeg:', j.details);
        throw new Error(j.error || 'Elaborazione fallita');
      }
      onProgress(j.progress || 0);
    }
  }

  async function enhanceVideo() {
    if (!(await checkServer())) {
      showToast('Server video non attivo. Nel Terminale, dentro la cartella LumiaAI: npm start', 'error', 7000);
      return;
    }
    openOverlay('Miglioramento video in corso…');
    setText(el.sub, 'Caricamento del video sul motore locale…');
    const info = await uploadVideo(state.file, {
      scale: el.scale.value, noise: el.noise.value, sharpen: el.sharpen.value, color: el.color.value,
    }, (p) => setProgress(p * 10, `Caricamento… ${Math.round(p * 100)}%`));

    state.videoJobId = info.id;
    setStep(3);
    if (info.effectiveScale < (parseInt(el.scale.value, 10) || 2)) {
      showToast(`Uscita limitata a 4K: ${info.width}×${info.height}`, 'info', 5000);
    }
    const done = await pollJob(info.id, (p) => {
      setStep(p < 50 ? 3 : 4);
      setProgress(10 + p * 0.88, `Rumore, upscaling ${info.width}×${info.height}, nitidezza e colore… ${p}%`);
    });
    setStep(5);
    state.videoResultUrl = `${API}/api/video/download/${info.id}`;
    state.videoResultName = done.file;

    el.video.src = state.videoResultUrl;
    el.video.load();
    show(el.videoOverlay, true);
    show(el.btnDownload, true);
    setProgress(100, `Fatto: ${info.width}×${info.height}, salvato anche in outputs/`);
    setText(el.title, 'Elaborazione completata');
    showToast(`Video migliorato (${info.width}×${info.height}${info.hasAudio ? ', audio incluso' : ''}). Copia salvata in outputs/${done.file}`, 'success', 6000);
  }

  // ---------- Avvio elaborazione ----------
  async function runEnhancement() {
    if (state.busy) return;
    if (!state.file) { showToast('Seleziona prima un file', 'error'); return; }
    const isVideo = (state.file.type || '').startsWith('video/');
    setBusy(true);
    try {
      if (isVideo) await enhanceVideo();
      else await enhanceImage();
      closeOverlay(900);
    } catch (err) {
      console.error('[LumiAI]', err);
      setText(el.title, 'Errore durante l’elaborazione');
      setText(el.sub, err.message || String(err));
      showToast('Errore: ' + (err.message || err), 'error', 6000);
      closeOverlay(2500);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Download ----------
  function baseName() {
    return (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, '') : 'lumiAI_result');
  }

  async function downloadEnhanced() {
    // video: il server risponde con Content-Disposition: attachment
    if (state.videoResultUrl) {
      const a = document.createElement('a');
      a.href = state.videoResultUrl; a.download = state.videoResultName || `${baseName()}_lumiAI_enhanced.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    if (!state.resultBlob) { showToast('Nessun file pronto per il download', 'error'); return; }
    const filename = `${baseName()}_lumiAI_enhanced.png`;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Immagine PNG', accept: { 'image/png': ['.png'] } }],
        });
        const w = await handle.createWritable();
        await w.write(state.resultBlob); await w.close();
        showToast('File salvato: ' + handle.name, 'success');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // l'utente ha annullato
        console.warn('Salvataggio con File System API fallito, uso download classico:', err);
      }
    }
    const url = URL.createObjectURL(state.resultBlob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Download avviato', 'success');
  }

  // ---------- Eventi ----------
  function openFilePicker() {
    if (el.fileInput) { el.fileInput.value = ''; el.fileInput.click(); }
  }
  if (el.fileInput) el.fileInput.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) loadFile(f); });
  if (el.btnEnhance) el.btnEnhance.addEventListener('click', runEnhancement);
  if (el.btnDownload) el.btnDownload.addEventListener('click', downloadEnhanced);

  function resetToUpload() {
    if (state.busy) return;
    clearResults();
    state.file = null; state.image = null;
    revokeObjectUrl();
    if (el.video) { try { el.video.pause(); } catch (e) {} el.video.removeAttribute('src'); }
    show(el.uploadSection, true); show(el.processingPanel, false);
    show(el.imgWrapper, false); show(el.videoWrapper, false); show(el.placeholder, true);
    [el.before, el.after].forEach((c) => { if (c) { c.width = 0; c.height = 0; } });
    setText(el.fileName, ''); setText(el.fileSize, ''); setText(el.fileTypeBadge, '');
  }
  if (el.btnChangeFile) el.btnChangeFile.addEventListener('click', () => { if (state.busy) return; resetToUpload(); openFilePicker(); });

  if (el.uploadZone) {
    // il file input è dentro la zona: ignora il click "rimbalzato" dall'input stesso
    el.uploadZone.addEventListener('click', (e) => { if (e.target !== el.fileInput) openFilePicker(); });
    el.uploadZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); } });
    el.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); el.uploadZone.classList.add('dragging'); });
    el.uploadZone.addEventListener('dragleave', () => el.uploadZone.classList.remove('dragging'));
    el.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault(); el.uploadZone.classList.remove('dragging');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
  }

  initAI();

  // API minima per debug da console
  window.LumiAI = { runEnhancement, downloadEnhanced, state };
})();
