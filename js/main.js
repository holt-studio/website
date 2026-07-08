/* Holt Studio — scroll-scrubbed film site */

const FPS = 24;               // source video fps (timecode display)
const SEQ_COUNT = 6;

// Per-sequence frame counts, read from the scene sections (trimmed per video)
const FRAME_COUNTS = {};
document.querySelectorAll('.scene').forEach((s) => {
  FRAME_COUNTS[Number(s.dataset.seq)] = Number(s.dataset.frames);
});
const TOTAL_FRAMES = Object.values(FRAME_COUNTS).reduce((a, b) => a + b, 0);
const FILM_SECONDS = TOTAL_FRAMES / 12; // frames extracted at 12fps

const canvas = document.getElementById('film');
const ctx = canvas.getContext('2d');
const loader = document.getElementById('loader');
const loaderFill = document.getElementById('loaderFill');
const loaderPct = document.getElementById('loaderPct');
const timecodeEl = document.getElementById('timecode');
const sceneLabelEl = document.getElementById('sceneLabel');
const scrollHintEl = document.getElementById('scrollHint');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- frame store ---------- */
const sequences = {}; // seq -> { images: Image[], loaded: boolean[] }

function framePath(seq, idx) {
  return `frames/seq${seq}/f_${String(idx).padStart(3, '0')}.jpg`;
}

function loadSequence(seq, frames, onProgress) {
  return new Promise((resolve) => {
    const store = { images: new Array(frames), loaded: new Array(frames).fill(false) };
    sequences[seq] = store;
    let done = 0;
    for (let i = 1; i <= frames; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => {
        store.loaded[i - 1] = true;
        done++;
        if (onProgress) onProgress(done / frames);
        if (done === frames) {
          // Redraw if the film is currently parked on this sequence
          if (requested.seq === seq) drawFrame(seq, requested.frame, true);
          resolve(store);
        }
      };
      img.src = framePath(seq, i);
      store.images[i - 1] = img;
    }
  });
}

/* ---------- draw ---------- */
let current = { seq: 1, frame: 0 };   // last frame actually drawn (0-based)
let requested = { seq: 1, frame: 0 }; // last frame asked for (may not be loaded yet)

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  drawFrame(current.seq, current.frame, true);
}

function nearestLoaded(store, idx) {
  if (store.loaded[idx]) return idx;
  for (let d = 1; d < store.loaded.length; d++) {
    if (idx - d >= 0 && store.loaded[idx - d]) return idx - d;
    if (idx + d < store.loaded.length && store.loaded[idx + d]) return idx + d;
  }
  return -1;
}

function drawFrame(seq, frameIdx, force) {
  requested = { seq, frame: frameIdx };
  const store = sequences[seq];
  if (!store) {
    loadSequence(seq, FRAME_COUNTS[seq]); // deep links / fast jumps: load on demand
    return;
  }
  const idx = nearestLoaded(store, frameIdx);
  if (idx < 0) return;
  if (!force && current.seq === seq && current.frame === idx) return;
  current = { seq, frame: idx };

  const img = store.images[idx];
  const cw = canvas.width, ch = canvas.height;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

/* ---------- static fallback ---------- */
function initStaticMode() {
  document.body.classList.add('static-mode');
  loader.classList.add('done');
  document.querySelectorAll('.scene').forEach((scene) => {
    const seq = scene.dataset.seq;
    const img = document.createElement('img');
    img.className = 'poster';
    img.src = framePath(seq, FRAME_COUNTS[Number(seq)]);
    img.alt = '';
    img.loading = 'lazy';
    scene.appendChild(img);
  });
}

/* ---------- film mode ---------- */
function initFilmMode() {
  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const scenes = gsap.utils.toArray('.scene');

  // Scenes chained directly after another scene scrub continuously (start
  // as soon as the previous scrub ends). Scenes after the hero or a panel
  // start when they reach the top, so panels get a calm settled frame.
  // Uniform pace either way: ~2.1vh of scroll per frame.
  const chained = (scene) =>
    scene.previousElementSibling && scene.previousElementSibling.classList.contains('scene');

  scenes.forEach((scene) => {
    const frames = Number(scene.dataset.frames);
    const lead = chained(scene) ? 0 : 100;
    scene.style.height = `${Math.round(lead + frames * 2.1)}vh`;
  });
  ScrollTrigger.refresh();

  scenes.forEach((scene, sceneIdx) => {
    const seq = Number(scene.dataset.seq);
    const frames = Number(scene.dataset.frames);
    const startEdge = chained(scene) ? 'top bottom' : 'top top';
    const beats = gsap.utils.toArray(scene.querySelectorAll('.beat'));
    const beatMeta = beats.map((b) => ({
      el: b,
      from: Number(b.dataset.from),
      to: Number(b.dataset.to),
    }));

    ScrollTrigger.create({
      trigger: scene,
      start: startEdge,
      end: 'bottom bottom',
      scrub: true,
      onUpdate(self) {
        const p = self.progress;
        drawFrame(seq, Math.min(frames - 1, Math.floor(p * frames)));
        for (const beat of beatMeta) {
          const FADE = 0.07;
          let o = 0;
          if (p >= beat.from && p <= beat.to) {
            const inO = Math.min(1, (p - beat.from) / FADE);
            const outO = Math.min(1, (beat.to - p) / FADE);
            o = Math.min(inO, outO);
          }
          beat.el.style.opacity = o.toFixed(3);
        }
      },
      onToggle(self) {
        if (self.isActive) { if (sceneLabelEl) sceneLabelEl.textContent = scene.dataset.label; }
        else beatMeta.forEach((b) => (b.el.style.opacity = 0));
      },
      // Lazy-load next sequence just before it's needed
      onEnter() {
        const next = seq + 1;
        if (next <= SEQ_COUNT && !sequences[next]) loadSequence(next, FRAME_COUNTS[next]);
      },
    });
  });

  // Global timecode + scroll hint
  ScrollTrigger.create({
    trigger: document.body,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const t = self.progress * FILM_SECONDS;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(Math.floor(t % 60)).padStart(2, '0');
      const ff = String(Math.floor((t % 1) * FPS)).padStart(2, '0');
      if (timecodeEl) timecodeEl.textContent = `00:${mm}:${ss}:${ff}`;
      scrollHintEl.style.opacity = self.progress > 0.02 ? 0.55 : 1;
    },
  });

  // Hero label
  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top top',
    end: 'bottom top',
    onToggle(self) {
      if (self.isActive && sceneLabelEl) sceneLabelEl.textContent = 'SC 00 — TITLE';
    },
  });
}

/* ---------- form ---------- */
// After deploying the Cloudflare Worker, paste its URL here:
const RFQ_ENDPOINT = ''; // e.g. 'https://holt-studio-rfq.<you>.workers.dev'

document.getElementById('ctaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const doneEl = document.getElementById('formDone');
  const errEl = document.getElementById('formErr');
  errEl.hidden = true;

  const fields = form.querySelectorAll('input, button');
  fields.forEach((el) => (el.disabled = true));

  const payload = {
    name: form.name.value,
    business: form.business.value,
    phone: form.phone.value,
    website: form.website.value, // honeypot
  };

  // Not wired to a backend yet — acknowledge without losing the submission's UX.
  if (!RFQ_ENDPOINT) {
    doneEl.hidden = false;
    return;
  }

  try {
    const res = await fetch(RFQ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Bad response ' + res.status);
    doneEl.hidden = false;
  } catch (err) {
    fields.forEach((el) => (el.disabled = false));
    errEl.hidden = false;
  }
});

/* ---------- boot ---------- */
if (reducedMotion) {
  initStaticMode();
} else {
  // Load reel 1 with progress; start film when ready, load reel 2 behind it
  loadSequence(1, FRAME_COUNTS[1], (p) => {
    const pct = Math.round(p * 100);
    loaderFill.style.width = pct + '%';
    loaderPct.textContent = pct + '%';
  }).then(() => {
    loader.classList.add('done');
    initFilmMode();
    loadSequence(2, FRAME_COUNTS[2]);
  });
}
