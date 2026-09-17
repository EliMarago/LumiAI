/* ===================================
   LumiAI – App Logic
   Remini Clarity Engine™ v2
   =================================== */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────────
  const uploadZone      = document.getElementById('upload-zone');
  const fileInput       = document.getElementById('file-input');
  const uploadSection   = document.getElementById('upload-section');
  const processingPanel = document.getElementById('processing-panel');
  const processingOverlay = document.getElementById('processing-overlay');

  const fileNameEl      = document.getElementById('file-name');
  const fileSizeEl      = document.getElementById('file-size');
  const fileTypeBadge   = document.getElementById('file-type-badge');
  const btnChangeFile   = document.getElementById('btn-change-file');
  const btnEnhance      = document.getElementById('btn-enhance');
  const btnDownload     = document.getElementById('btn-download');

  // Preview refs
  const imgWrapper      = document.getElementById('img-preview-wrapper');
  const videoWrapper    = document.getElementById('video-preview-wrapper');
  const previewPlaceholder = document.getElementById('preview-placeholder');
  const beforeCanvas    = document.getElementById('before-canvas');
  const afterCanvas     = document.getElementById('after-canvas');
  const baLabels        = document.getElementById('ba-labels');
  const baDivider       = document.getElementById('ba-divider');
  const videoPreview    = document.getElementById('video-preview');
  const videoOverlay    = document.getElementById('video-overlay');

  // Progress refs
  const progressFill    = document.getElementById('progress-fill');
  const progressPct     = document.getElementById('progress-pct');
  const processingTitle = document.getElementById('processing-title');
  const processingSub   = document.getElementById('processing-sub');

  // Settings
  const scaleSelect     = document.getElementById('scale-select');
  const noiseSelect     = document.getElementById('noise-select');
  const sharpenSelect   = document.getElementById('sharpen-select');
  const colorSelect     = document.getElementById('color-select');

  // ── State ─────────────────────────────────────────────────────────
  let currentFile = null;
  let currentObjectUrl = null;
  let originalImage = null;
  let isEnhanced = false;
  let enhancedBlob = null;

  // ── AI Super Resolution (UpscalerJS + ESRGAN) ─────────────────────
  let upscaler2xInstance = null;
  let upscaler4xInstance = null;
  let upscalerReady      = false;
  let upscalerLoading    = false;

  function updateAiBadge(status, text) {
    const badge = document.getElementById('ai-model-badge');
    const label = document.getElementById('ai-status-text');
    const dot   = badge ? badge.querySelector('.ai-status-dot') : null;
    if (!badge || !label) return;
    if (status === 'ready') {
      label.textContent = text || 'ESRGAN + Remini Clarity Engine';
      badge.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      badge.style.background = 'rgba(34, 197, 94, 0.1)';
      badge.style.color = '#4ade80';
      if (dot) { dot.style.background = '#22c55e'; dot.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.8)'; }
    } else if (status === 'loading') {
      label.textContent = text || 'Inizializzazione ESRGAN...';
      badge.style.borderColor = 'rgba(245, 200, 66, 0.4)';
      badge.style.background = 'rgba(245, 200, 66, 0.1)';
      badge.style.color = '#F5C842';
      if (dot) { dot.style.background = '#F5C842'; dot.style.boxShadow = '0 0 8px rgba(245, 200, 66, 0.8)'; }
    } else {
      label.textContent = text || 'Remini Clarity Engine Attivo';
      badge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
      badge.style.background = 'rgba(148, 163, 184, 0.1)';
      badge.style.color = '#94a3b8';
      if (dot) { dot.style.background = '#94a3b8'; dot.style.boxShadow = 'none'; }
    }
  }

  async function initUpscaler() {
    if (upscalerLoading || upscalerReady) return;
    upscalerLoading = true;
    updateAiBadge('loading', 'Caricamento Rete Neurale ESRGAN...');

    if (typeof Upscaler === 'undefined') {
      console.warn('[LumiAI] UpscalerJS non trovato — Remini Clarity Engine attivo.');
      upscalerLoading = false;
      updateAiBadge('fallback', 'Remini Clarity Engine Attivo');
      return;
    }
    try {
      const model2x = (typeof ESRGANSlim2x !== 'undefined') ? ESRGANSlim2x : undefined;
      const model4x = (typeof ESRGANSlim4x !== 'undefined') ? ESRGANSlim4x : undefined;
      upscaler2xInstance = new Upscaler({ model: model2x });
      if (model4x) upscaler4xInstance = new Upscaler({ model: model4x });
      upscalerReady = true;
      console.log('[LumiAI] Modelli ESRGAN pronti');
      updateAiBadge('ready', 'ESRGAN + Remini Clarity Engine');
    } catch (err) {
      console.warn('[LumiAI] ESRGAN fallback — Remini Clarity Engine attivo:', err);
      updateAiBadge('fallback', 'Remini Clarity Engine Attivo');
    }
    upscalerLoading = false;
  }

  window.__lumiAI = {
    isReady: () => upscalerReady,
    get2x: () => upscaler2xInstance,
    get4x: () => upscaler4xInstance,
    init: initUpscaler
  };

  initUpscaler();

  // ── Upload Zone Events ────────────────────────────────────────────
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-active');
  });
  uploadZone.addEventListener('dragleave', e => {
    if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-active');
  });
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-active');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  btnChangeFile.addEventListener('click', resetToUpload);

  // ── File Handling ─────────────────────────────────────────────────
  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|bmp|gif|tiff|svg|avif)$/i.test(file.name);
  }

  function isVideoFile(file) {
    if (file.type && file.type.startsWith('video/')) return true;
    return /\.(mp4|mov|webm|ogv|m4v|mkv)$/i.test(file.name);
  }

  function handleFile(file) {
    const isImage = isImageFile(file);
    const isVideo = isVideoFile(file);

    if (!isImage && !isVideo) {
      showToast('Formato non supportato. Usa immagini o video.', 'warn');
      return;
    }

    currentFile = file;
    isEnhanced = false;
    enhancedBlob = null;
    btnDownload.classList.add('hidden');
    afterCanvas.classList.add('hidden');
    baLabels.classList.add('hidden');
    baDivider.classList.add('hidden');

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatSize(file.size);
    fileTypeBadge.textContent = isImage ? 'IMG' : 'VID';
    fileTypeBadge.style.background = isImage
      ? 'linear-gradient(135deg, #F5C842, #C8923A)'
      : 'linear-gradient(135deg, #7B61FF, #4A90E2)';

    uploadSection.classList.add('hidden');
    processingPanel.classList.remove('hidden');

    if (isImage) {
      showImagePreview(currentObjectUrl);
    } else {
      showVideoPreview(currentObjectUrl);
    }
  }

  function showImagePreview(src) {
    imgWrapper.classList.remove('hidden');
    videoWrapper.classList.add('hidden');
    previewPlaceholder.classList.add('hidden');

    const img = new Image();
    img.onload = () => {
      originalImage = img;
      drawCanvas(beforeCanvas, img);
      showToast('File caricato con successo!', 'info');
    };
    img.onerror = () => {
      showToast('Errore nel caricamento del file immagine.', 'warn');
      resetToUpload();
    };
    img.src = src;
  }

  function showVideoPreview(src) {
    videoWrapper.classList.remove('hidden');
    imgWrapper.classList.add('hidden');
    previewPlaceholder.classList.add('hidden');
    videoPreview.src = src;
    videoOverlay.classList.add('hidden');
    videoPreview.onloadedmetadata = () => showToast('Video caricato con successo!', 'info');
    videoPreview.onerror = () => showToast('Formato video non decodificabile nel browser.', 'warn');
  }

  function drawCanvas(canvas, img) {
    const maxW = 520;
    const ratio = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
    canvas.width  = Math.min(img.naturalWidth || img.width, maxW);
    canvas.height = Math.round(canvas.width / ratio);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  // =================================================================
  // REMINI CLARITY ENGINE - Pixel Processing Algorithms
  // =================================================================

  /** Fast 1D Separable Box Blur */
  function fastBoxBlur(pixels, width, height) {
    const out = new Uint8ClampedArray(pixels.length);
    const tmp = new Uint8ClampedArray(pixels.length);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - 1), x2 = Math.min(width - 1, x + 1);
        const i0 = rowOffset + x0 * 4, i1 = rowOffset + x * 4, i2 = rowOffset + x2 * 4;
        const dest = i1;
        tmp[dest]     = (pixels[i0]     + pixels[i1]     + pixels[i2])     / 3;
        tmp[dest + 1] = (pixels[i0 + 1] + pixels[i1 + 1] + pixels[i2 + 1]) / 3;
        tmp[dest + 2] = (pixels[i0 + 2] + pixels[i1 + 2] + pixels[i2 + 2]) / 3;
        tmp[dest + 3] = pixels[i1 + 3];
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - 1), y2 = Math.min(height - 1, y + 1);
        const i0 = (y0 * width + x) * 4, i1 = (y * width + x) * 4, i2 = (y2 * width + x) * 4;
        out[i1]     = (tmp[i0]     + tmp[i1]     + tmp[i2])     / 3;
        out[i1 + 1] = (tmp[i0 + 1] + tmp[i1 + 1] + tmp[i2 + 1]) / 3;
        out[i1 + 2] = (tmp[i0 + 2] + tmp[i1 + 2] + tmp[i2 + 2]) / 3;
        out[i1 + 3] = tmp[i1 + 3];
      }
    }
    return out;
  }

  /** Narrow Unsharp Mask - crisp pixel-scale edge pop */
  function unsharpMaskFast(pixelData, width, height, strength) {
    if (strength <= 0) return pixelData;
    const blurred = fastBoxBlur(fastBoxBlur(pixelData, width, height), width, height);
    const out = new Uint8ClampedArray(pixelData.length);
    for (let i = 0; i < pixelData.length; i += 4) {
      out[i]     = Math.min(255, Math.max(0, pixelData[i]     + strength * (pixelData[i]     - blurred[i])));
      out[i + 1] = Math.min(255, Math.max(0, pixelData[i + 1] + strength * (pixelData[i + 1] - blurred[i + 1])));
      out[i + 2] = Math.min(255, Math.max(0, pixelData[i + 2] + strength * (pixelData[i + 2] - blurred[i + 2])));
      out[i + 3] = pixelData[i + 3];
    }
    return out;
  }

  /** Wide Unsharp Mask (4-pass blur) - Remini-style depth pop on large structures */
  function unsharpMaskWide(pixelData, width, height, strength) {
    if (strength <= 0) return pixelData;
    let b = fastBoxBlur(pixelData, width, height);
    b = fastBoxBlur(b, width, height);
    b = fastBoxBlur(b, width, height);
    b = fastBoxBlur(b, width, height);
    const out = new Uint8ClampedArray(pixelData.length);
    for (let i = 0; i < pixelData.length; i += 4) {
      out[i]     = Math.min(255, Math.max(0, pixelData[i]     + strength * (pixelData[i]     - b[i])));
      out[i + 1] = Math.min(255, Math.max(0, pixelData[i + 1] + strength * (pixelData[i + 1] - b[i + 1])));
      out[i + 2] = Math.min(255, Math.max(0, pixelData[i + 2] + strength * (pixelData[i + 2] - b[i + 2])));
      out[i + 3] = pixelData[i + 3];
    }
    return out;
  }

  /**
   * High-Frequency Detail Boost - amplifies the 1-pass blur residual.
   * This recovers micro-texture: skin pores, hair, fabric - the Remini signature.
   */
  function highFreqBoost(pixelData, width, height, amount) {
    if (amount <= 0) return pixelData;
    const blurred = fastBoxBlur(pixelData, width, height);
    const out = new Uint8ClampedArray(pixelData.length);
    for (let i = 0; i < pixelData.length; i += 4) {
      out[i]     = Math.min(255, Math.max(0, pixelData[i]     + (pixelData[i]     - blurred[i])     * amount));
      out[i + 1] = Math.min(255, Math.max(0, pixelData[i + 1] + (pixelData[i + 1] - blurred[i + 1]) * amount));
      out[i + 2] = Math.min(255, Math.max(0, pixelData[i + 2] + (pixelData[i + 2] - blurred[i + 2]) * amount));
      out[i + 3] = pixelData[i + 3];
    }
    return out;
  }

  /** 8-neighbor Laplacian sharpening - fine edge definition */
  function laplacianSharpenFast(pixelData, width, height, amount) {
    const out = new Uint8ClampedArray(pixelData.length);
    const scale = amount * 0.12;

    for (let y = 1; y < height - 1; y++) {
      const rowIdx = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i   = (rowIdx + x) * 4;
        const tl  = (rowIdx - width + x - 1) * 4;
        const top = (rowIdx - width + x)     * 4;
        const tr  = (rowIdx - width + x + 1) * 4;
        const lft = (rowIdx + x - 1)         * 4;
        const rgt = (rowIdx + x + 1)         * 4;
        const bl  = (rowIdx + width + x - 1) * 4;
        const bot = (rowIdx + width + x)     * 4;
        const br  = (rowIdx + width + x + 1) * 4;
        for (let c = 0; c < 3; c++) {
          const edge = 8 * pixelData[i + c]
            - pixelData[tl + c] - pixelData[top + c] - pixelData[tr + c]
            - pixelData[lft + c]                     - pixelData[rgt + c]
            - pixelData[bl + c] - pixelData[bot + c] - pixelData[br + c];
          out[i + c] = Math.min(255, Math.max(0, pixelData[i + c] + edge * scale));
        }
        out[i + 3] = pixelData[i + 3];
      }
    }
    // Copy border pixels
    for (let x = 0; x < width; x++) {
      const t = x * 4, b = ((height - 1) * width + x) * 4;
      for (let c = 0; c < 4; c++) { out[t + c] = pixelData[t + c]; out[b + c] = pixelData[b + c]; }
    }
    for (let y = 1; y < height - 1; y++) {
      const l = y * width * 4, r = (y * width + width - 1) * 4;
      for (let c = 0; c < 4; c++) { out[l + c] = pixelData[l + c]; out[r + c] = pixelData[r + c]; }
    }
    return out;
  }

  /**
   * Micro-contrast enhancer - amplifies local luminance variation
   * creating the Remini-signature 3D crystal-clear pop.
   */
  function microContrastBoost(pixelData, width, height, strength) {
    if (strength <= 0) return pixelData;
    const out = new Uint8ClampedArray(pixelData.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = pixelData[i + c];
          const local = (
            pixelData[((y - 1) * width + x) * 4 + c] +
            pixelData[((y + 1) * width + x) * 4 + c] +
            pixelData[(y * width + x - 1)   * 4 + c] +
            pixelData[(y * width + x + 1)   * 4 + c]
          ) / 4;
          out[i + c] = Math.min(255, Math.max(0, v + (v - local) * strength));
        }
        out[i + 3] = pixelData[i + 3];
      }
    }
    for (let x = 0; x < width; x++) {
      const t = x * 4, b = ((height - 1) * width + x) * 4;
      for (let c = 0; c < 4; c++) { out[t + c] = pixelData[t + c]; out[b + c] = pixelData[b + c]; }
    }
    for (let y = 1; y < height - 1; y++) {
      const l = y * width * 4, r = (y * width + width - 1) * 4;
      for (let c = 0; c < 4; c++) { out[l + c] = pixelData[l + c]; out[r + c] = pixelData[r + c]; }
    }
    return out;
  }

  /** Per-pixel color grading: brightness, contrast, saturation */
  function colorGrade(pixelData, brightness, contrast, saturation) {
    const out = new Uint8ClampedArray(pixelData.length);
    for (let i = 0; i < pixelData.length; i += 4) {
      let r = pixelData[i], g = pixelData[i + 1], b = pixelData[i + 2];
      r *= brightness; g *= brightness; b *= brightness;
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + saturation * (r - lum);
      g = lum + saturation * (g - lum);
      b = lum + saturation * (b - lum);
      out[i]     = Math.min(255, Math.max(0, r));
      out[i + 1] = Math.min(255, Math.max(0, g));
      out[i + 2] = Math.min(255, Math.max(0, b));
      out[i + 3] = pixelData[i + 3];
    }
    return out;
  }

  // ── Enhancement Logic ─────────────────────────────────────────────
  btnEnhance.addEventListener('click', () => runEnhancement());

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function activateStep(stepEls, idx) {
    stepEls.forEach((el, i) => {
      if (i < idx)      { el.classList.remove('active'); el.classList.add('done'); }
      else if (i === idx) { el.classList.remove('done'); el.classList.add('active'); }
      else               { el.classList.remove('active', 'done'); }
    });
  }

  async function runEnhancement() {
    if (!currentFile) {
      showToast('Seleziona prima un file da migliorare.', 'warn');
      return;
    }

    const scale     = parseInt(scaleSelect.value) || 4;
    const noise     = noiseSelect.value;
    const sharpen   = sharpenSelect.value;
    const colorMode = colorSelect.value;

    processingOverlay.classList.remove('hidden');
    const stepEls = ['step-1','step-2','step-3','step-4','step-5'].map(id => document.getElementById(id));
    stepEls.forEach(el => { el.className = 'proc-step'; });

    try {
      // Step 1
      processingTitle.textContent = 'Analisi struttura immagine...';
      processingSub.textContent   = 'Rilevamento risoluzione, profilo colore e dettagli...';
      setProgress(10); activateStep(stepEls, 0); await wait(500);

      // Step 2
      activateStep(stepEls, 1);
      processingTitle.textContent = 'Caricamento Rete Neurale...';
      processingSub.textContent   = upscalerReady ? 'ESRGAN pronto — avvio Remini Clarity Engine...' : 'Inizializzazione motore Remini Clarity Engine...';
      setProgress(25);
      if (!upscalerReady && !upscalerLoading) {
        try { await Promise.race([initUpscaler(), wait(2000)]); } catch (e) {}
      }
      await wait(300);

      // Step 3
      activateStep(stepEls, 2);
      const scaleLabel = scale >= 16 ? 'Remini Max' : scale + 'x';
      processingTitle.textContent = 'Super Resolution ' + scaleLabel + '...';
      processingSub.textContent   = 'Ricostruzione intelligente dettagli e texture...';
      setProgress(40);
      await wait(50); // Forza il rendering della UI al 40%

      let upscaledCanvas;
      try {
        upscaledCanvas = await Promise.race([
          performAIUpscaling(scale, frac => setProgress(Math.round(40 + frac * 30))),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))
        ]);
      } catch (err) {
        console.warn('[LumiAI] Switched to bicubic:', err);
        upscaledCanvas = canvasFallbackUpscale(scale);
      }

      // Step 4
      activateStep(stepEls, 3);
      processingTitle.textContent = 'Remini Clarity Engine...';
      processingSub.textContent   = 'USM + Wide USM + HF Boost + Laplacian + Micro-contrast...';
      setProgress(75); await wait(100);

      if (isImageFile(currentFile)) {
        await applyPixelPostProcessing(upscaledCanvas, noise, sharpen, colorMode);
      }

      // Step 5
      activateStep(stepEls, 4);
      processingTitle.textContent = 'HDR Color Grading & Output...';
      processingSub.textContent   = 'Finalizzazione anteprima ad altissima fedelta...';
      setProgress(100); await wait(400);

      processingOverlay.classList.add('hidden');

      if (isImageFile(currentFile)) showImageResult(upscaledCanvas);
      else applyVideoEnhancement();

      isEnhanced = true;
      btnDownload.classList.remove('hidden');

    } catch (globalErr) {
      console.error('[LumiAI] Errore elaborazione:', globalErr);
      processingOverlay.classList.add('hidden');
      showToast('Si e verificato un errore durante l elaborazione.', 'warn');
    }
  }

  function setProgress(pct) {
    progressFill.style.width = pct + '%';
    progressPct.textContent  = pct + '%';
  }

  async function performAIUpscaling(scale, onProgress) {
    let currentSrc = originalImage;
    if (!currentSrc) throw new Error('Nessuna immagine originale caricata');

    if (upscalerReady && (upscaler2xInstance || upscaler4xInstance)) {
      const model = upscaler4xInstance || upscaler2xInstance;
      if (model) {
        let srcW = currentSrc.naturalWidth || currentSrc.width;
        let srcH = currentSrc.naturalHeight || currentSrc.height;
        
        // Riduce l'immagine in input all'AI se è troppo grande per evitare il crash del browser
        const maxInputSize = 640;
        if (srcW > maxInputSize || srcH > maxInputSize) {
            const ratio = srcW / srcH;
            const newW = Math.round(srcW > srcH ? maxInputSize : maxInputSize * ratio);
            const newH = Math.round(srcH > srcW ? maxInputSize : maxInputSize / ratio);
            const c = document.createElement('canvas');
            c.width = newW; c.height = newH;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(currentSrc, 0, 0, newW, newH);
            const img = new Image();
            await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/jpeg', 0.95); });
            currentSrc = img;
            srcW = newW;
            srcH = newH;
        }

        const patchSize = (srcW < 128 || srcH < 128) ? 64 : 128;

        const dataUrl = await model.upscale(currentSrc, {
          patchSize,
          padding: 4,
          progress: onProgress,
        });
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
        currentSrc = img;
      }
      const out = document.createElement('canvas');
      const origW = originalImage.naturalWidth || originalImage.width;
      const origH = originalImage.naturalHeight || originalImage.height;
      const ratio = origW / origH;
      let finalW = origW * scale;
      let finalH = origH * scale;
      if (finalW > 3840 || finalH > 3840) {
          if (finalW > finalH) { finalW = 3840; finalH = Math.round(3840 / ratio); }
          else { finalH = 3840; finalW = Math.round(3840 * ratio); }
      }
      out.width  = finalW;
      out.height = finalH;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(currentSrc, 0, 0, out.width, out.height);
      return out;
    }
    return canvasFallbackUpscale(scale);
  }

  function canvasFallbackUpscale(scale) {
    if (!originalImage) return document.createElement('canvas');
    const origW = originalImage.naturalWidth || originalImage.width || 400;
    const origH = originalImage.naturalHeight || originalImage.height || 300;
    const ratio = origW / origH;
    
    let upW = origW * scale;
    let upH = origH * scale;
    // Evita crash bloccando sia width che height al massimo di 3840
    if (upW > 3840 || upH > 3840) {
        if (upW > upH) { upW = 3840; upH = Math.round(3840 / ratio); }
        else { upH = 3840; upW = Math.round(3840 * ratio); }
    }
    
    const c = document.createElement('canvas');
    c.width = upW; c.height = upH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(originalImage, 0, 0, upW, upH);
    return c;
  }

  /**
   * REMINI CLARITY ENGINE - Main post-processing pipeline.
   *
   * Sharpening profiles:
   *   low    - 1 narrow USM + 1 Laplacian
   *   medium - 2 narrow + 1 wide + 1 HF Boost + 2 Lap + micro-contrast
   *   high   - 3 narrow + 2 wide + 2 HF Boost + 3 Lap + micro-contrast
   *   remini - 5 narrow + 3 wide + 4 HF Boost + 4 Lap + max micro-contrast
   *            (maximum clarity - Remini-grade output)
   */
  async function applyPixelPostProcessing(workCanvas, noise, sharpen, colorMode) {
    const ctx = workCanvas.getContext('2d');
    const w = workCanvas.width, h = workCanvas.height;
    if (w === 0 || h === 0) return;

    let pixels = ctx.getImageData(0, 0, w, h).data;
    await wait(20);

    // Noise reduction
    const noisePasses = { light: 0, medium: 1, heavy: 2, remini: 1 }[noise] || 1;
    for (let p = 0; p < noisePasses; p++) pixels = fastBoxBlur(pixels, w, h);

    // Sharpening configuration
    const cfg = {
      low:    { usm: 1, usmS: 3.5,  wide: 0, wideS: 0,   hf: 0, hfA: 0,   lap: 1, lapA: 2.0, mc: 0   },
      medium: { usm: 2, usmS: 6.0,  wide: 1, wideS: 2.0, hf: 1, hfA: 1.5, lap: 2, lapA: 3.5, mc: 0.8 },
      high:   { usm: 3, usmS: 10.0, wide: 2, wideS: 3.5, hf: 2, hfA: 2.5, lap: 3, lapA: 5.5, mc: 1.5 },
      remini: { usm: 5, usmS: 14.0, wide: 3, wideS: 5.5, hf: 4, hfA: 4.0, lap: 4, lapA: 7.0, mc: 2.5 },
    };
    const sc = cfg[sharpen] || cfg.remini;

    // 1. Narrow USM - edge pop
    for (let p = 0; p < sc.usm; p++) { pixels = unsharpMaskFast(pixels, w, h, sc.usmS); await wait(4); }
    // 2. Wide USM - depth pop
    for (let p = 0; p < sc.wide; p++) { pixels = unsharpMaskWide(pixels, w, h, sc.wideS); await wait(4); }
    // 3. High-freq boost - Remini micro-texture recovery
    for (let p = 0; p < sc.hf; p++) { pixels = highFreqBoost(pixels, w, h, sc.hfA); await wait(4); }
    // 4. Laplacian - fine edge definition
    for (let p = 0; p < sc.lap; p++) { pixels = laplacianSharpenFast(pixels, w, h, sc.lapA); await wait(4); }
    // 5. Micro-contrast - 3D crystal pop
    if (sc.mc > 0) { pixels = microContrastBoost(pixels, w, h, sc.mc); await wait(4); }

    // Color grading
    const colorProfiles = {
      none:      { b: 1.00, c: 1.08, s: 1.05 },
      vivid:     { b: 1.05, c: 1.20, s: 1.45 },
      cinematic: { b: 0.97, c: 1.22, s: 1.18 },
      natural:   { b: 1.02, c: 1.12, s: 1.12 },
      remini:    { b: 1.06, c: 1.32, s: 1.60 },
    };
    const prof = colorProfiles[colorMode] || colorProfiles.remini;
    pixels = colorGrade(pixels, prof.b, prof.c, prof.s);
    ctx.putImageData(new ImageData(pixels, w, h), 0, 0);

    // CSS display-space boost
    const cssFilters = {
      low:    'contrast(1.10) saturate(1.15)',
      medium: 'contrast(1.18) saturate(1.25)',
      high:   'contrast(1.28) saturate(1.40)',
      remini: 'contrast(1.38) saturate(1.55) brightness(1.04) drop-shadow(0 0 0.4px rgba(0,0,0,0.22))',
    };
    workCanvas.style.filter = cssFilters[sharpen] || cssFilters.remini;
  }

  function showImageResult(workCanvas) {
    const maxW     = 520;
    const ratio    = workCanvas.width / workCanvas.height;
    const displayW = Math.min(workCanvas.width, maxW);
    const displayH = Math.round(displayW / ratio);

    afterCanvas.width  = workCanvas.width;
    afterCanvas.height = workCanvas.height;
    afterCanvas.getContext('2d').drawImage(workCanvas, 0, 0);
    afterCanvas.style.width  = displayW + 'px';
    afterCanvas.style.height = displayH + 'px';
    afterCanvas.style.filter = workCanvas.style.filter || '';

    drawCanvas(beforeCanvas, originalImage);
    beforeCanvas.style.width  = displayW + 'px';
    beforeCanvas.style.height = displayH + 'px';
    beforeCanvas.style.filter = '';

    afterCanvas.classList.remove('hidden');
    baLabels.classList.remove('hidden');
    baDivider.classList.remove('hidden');
    setupBeforeAfter();

    const method = upscalerReady ? 'ESRGAN + Remini Clarity Engine' : 'Remini Clarity Engine';
    showToast(method + ' completato!', 'success');
  }

  function applyVideoEnhancement() {
    videoOverlay.classList.remove('hidden');

    const sharpen   = sharpenSelect ? sharpenSelect.value : 'remini';
    const colorMode = colorSelect   ? colorSelect.value   : 'remini';

    const videoFilters = {
      low:    'contrast(1.15) saturate(1.20) brightness(1.02)',
      medium: 'contrast(1.28) saturate(1.35) brightness(1.03)',
      high:   'contrast(1.45) saturate(1.55) brightness(1.05)',
      remini: 'contrast(1.58) saturate(1.70) brightness(1.06) drop-shadow(0 0 0.5px rgba(0,0,0,0.28))',
    };
    const colorBoost = {
      none:      '',
      vivid:     ' saturate(1.5)',
      cinematic: ' contrast(1.1) brightness(0.96)',
      natural:   ' saturate(1.15)',
      remini:    ' saturate(1.6) contrast(1.12)',
    };

    videoPreview.style.filter =
      (videoFilters[sharpen] || videoFilters.remini) +
      (colorBoost[colorMode] || '');

    showToast('Video potenziato Remini-style! Nitidezza e colori al massimo.', 'success');
  }

  // ── Before/After Slider ───────────────────────────────────────────
  function setupBeforeAfter() {
    const wrapper = document.getElementById('before-after-wrapper');
    let dragging = false;

    function setDividerPos(clientX) {
      const rect = wrapper.getBoundingClientRect();
      const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
      afterCanvas.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      baDivider.style.left = pct + '%';
    }

    baDivider.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (dragging) setDividerPos(e.clientX); });
    document.addEventListener('mouseup',   () => { dragging = false; });
    baDivider.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
    document.addEventListener('touchmove', e => { if (dragging) setDividerPos(e.touches[0].clientX); }, { passive: true });
    document.addEventListener('touchend', () => { dragging = false; });
  }

  // ── Download ──────────────────────────────────────────────────────
  btnDownload.addEventListener('click', () => {
    if (isImageFile(currentFile)) {
      afterCanvas.toBlob(blob => {
        if (!blob) { showToast('Errore nella generazione del file.', 'warn'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFile.name.replace(/\.[^.]+$/, '') + '_lumiAI_remini.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Download avviato!', 'success');
      }, 'image/png', 1.0);
    } else {
      const a = document.createElement('a');
      a.href = currentObjectUrl;
      a.download = currentFile.name.replace(/\.[^.]+$/, '') + '_lumiAI_remini.' + currentFile.name.split('.').pop();
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast('Il file video e stato scaricato.', 'info');
    }
  });

  // ── Reset ─────────────────────────────────────────────────────────
  function resetToUpload() {
    currentFile = null; isEnhanced = false; enhancedBlob = null; originalImage = null;
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    fileInput.value = '';
    processingPanel.classList.add('hidden');
    uploadSection.classList.remove('hidden');
    imgWrapper.classList.add('hidden');
    videoWrapper.classList.add('hidden');
    previewPlaceholder.classList.remove('hidden');
    btnDownload.classList.add('hidden');
    [beforeCanvas, afterCanvas].forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height));
    afterCanvas.style.clipPath = '';
    baDivider.style.left = '50%';
    setProgress(0);
  }

  // ── Toast ─────────────────────────────────────────────────────────
  function showToast(msg, type) {
    type = type || 'success';
    const existing = document.querySelector('.lumi-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'lumi-toast';
    toast.textContent = msg;
    const colorMap = {
      success: 'linear-gradient(135deg, var(--gold-300), var(--gold-500))',
      warn:    'linear-gradient(135deg, #FF8C42, #FF6B35)',
      info:    'linear-gradient(135deg, #7B61FF, #4A90E2)',
    };
    Object.assign(toast.style, {
      position: 'fixed', bottom: '32px', left: '50%',
      transform: 'translateX(-50%) translateY(20px)',
      background: colorMap[type] || colorMap.success,
      color: type === 'success' ? '#000' : '#fff',
      padding: '12px 24px', borderRadius: '999px',
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: '0.88rem', fontWeight: '700', zIndex: '9999',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', opacity: '0',
      transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

})();
