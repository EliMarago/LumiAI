/* ===================================
   LumiAI – Filtri video condivisi
   Usato sia dal server (Node + ffmpeg) sia dal browser (ffmpeg.wasm),
   così i due motori producono lo stesso risultato.
   =================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LumiVideoFilters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DENOISE = { light: 'hqdn3d=2:1.5:3:2.5', medium: 'hqdn3d=4:3:6:4.5', heavy: 'hqdn3d=7:6:10:8' };

  // CAS (Contrast Adaptive Sharpening) recupera il dettaglio senza aloni; unsharp aggiunge incisività
  const SHARPEN = {
    low: 'cas=0.45,unsharp=5:5:0.4:5:5:0',
    medium: 'cas=0.7,unsharp=5:5:0.8:5:5:0',
    high: 'cas=0.9,unsharp=5:5:1.2:5:5:0,unsharp=9:9:0.25:5:5:0',
    ultra: 'cas=1,unsharp=7:7:1.6:5:5:0,unsharp=11:11:0.4:5:5:0',
  };

  const COLOR = {
    none: null,
    vivid: 'eq=contrast=1.06:saturation=1.25',
    cinematic: 'eq=contrast=1.10:saturation=0.92,colorbalance=rs=-0.05:gs=0:bs=0.06:rh=0.05:gh=0.01:bh=-0.05',
    natural: 'eq=contrast=1.03:saturation=1.06',
  };

  /**
   * @param {{width:number,height:number}} meta  dimensioni di visualizzazione del video (già ruotate)
   * @param {{scale:number,noise:string,sharpen:string,color:string}} opts
   * @param {number} maxSide  lato lungo massimo in uscita
   */
  function buildVideoFilter(meta, opts, maxSide) {
    const scale = [2, 4, 8].includes(Number(opts.scale)) ? Number(opts.scale) : 2;
    let k = scale;
    const longSide = Math.max(meta.width, meta.height);
    if (longSide * k > maxSide) k = Math.max(1, maxSide / longSide);
    // dimensioni sempre pari (richiesto da H.264 yuv420p)
    const outW = Math.round((meta.width * k) / 2) * 2;
    const outH = Math.round((meta.height * k) / 2) * 2;

    const f = [];
    f.push(DENOISE[opts.noise] || DENOISE.medium); // denoise PRIMA dell'upscaling: più efficace e veloce
    if (outW !== meta.width || outH !== meta.height) f.push(`scale=${outW}:${outH}:flags=lanczos+accurate_rnd+full_chroma_int`);
    f.push(SHARPEN[opts.sharpen] || SHARPEN.medium);
    if (COLOR[opts.color]) f.push(COLOR[opts.color]);
    f.push('format=yuv420p');
    return { filter: f.join(','), outW, outH, effectiveScale: k, requestedScale: scale };
  }

  return { buildVideoFilter, DENOISE, SHARPEN, COLOR };
});
