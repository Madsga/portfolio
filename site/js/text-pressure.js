// Text pressure: a plain-JavaScript port of React Bits' <TextPressure /> (after Juan Fuentes' CodePen).
// Letters swell in width and weight the closer the pointer gets; while the pointer is away a wave
// rolls through the word, and a click sends a ripple outward. Reduced motion keeps the idle wave off.
//
//   textPressure(h1, { idle: 'wave', axes: { wdth: [62, 125], wght: [100, 900] } })
//   <p data-text-pressure>…</p>   starts on its own, sized to its parent
//
// The element's text is split into one span per character ([data-letter]); a screen reader gets
// the plain text once. The letters spread across the element's full width (flex).
(() => {
  const RIPPLE_LIFE = 1.3;
  const MAX_RIPPLES = 6;
  const WAVE_PERIOD = 3.2;
  const PULSE_PERIOD = 2.8;
  const PULSE_DEPTH = 0.42;
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const map = ([lo, hi], p) => lo + (hi - lo) * p;

  const idlePressure = (mode, position, clock, spread) => {
    if (mode === 'wave') {
      const crest = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (position / spread - clock / WAVE_PERIOD));
      return crest * crest;
    }
    if (mode === 'pulse') {
      const lag = Math.abs(position - 0.5) * 0.4;
      const breath = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (clock / PULSE_PERIOD - lag));
      return PULSE_DEPTH * breath * breath * (3 - 2 * breath);
    }
    return 0;
  };

  const ripplePressure = (ripples, point, now, span) => {
    const band = Math.max(span * 0.14, 32);
    let total = 0;
    for (const r of ripples) {
      const age = (now - r.start) / 1000;
      if (age <= 0 || age >= RIPPLE_LIFE) continue;
      const offset = (dist(r, point) - age * span * 1.25) / band;
      if (offset <= -1 || offset >= 1) continue;
      const fade = 1 - age / RIPPLE_LIFE;
      const swell = (1 - offset * offset) ** 2 * fade * fade * Math.min(1, age / 0.06);
      total = 1 - (1 - total) * (1 - swell);
    }
    return total;
  };

  function textPressure(title, options = {}) {
    if (!title) return;
    const o = {
      radius: 0.5, // reach of the pointer's pull, as a share of the text width
      smoothing: 0.5, // 0 follows instantly, 1 glides slowly
      idle: 'wave', // 'none' | 'wave' | 'pulse'
      idleSpeed: 1,
      clickRipple: true,
      minFontSize: 24,
      axes: { wdth: [62, 125], wght: [100, 900] }, // the variable font's ranges, rest to full pressure
      ...options
    };
    const container = o.container || title.parentElement;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');

    // One span per character, spread across the full width.
    const text = title.textContent.trim();
    title.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    title.append(sr);
    const spans = [...text].map((ch) => {
      const s = document.createElement('span');
      s.dataset.letter = '';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? ' ' : ch;
      title.append(s);
      return s;
    });
    title.classList.add('text-pressure');

    // Size: the largest font at which the word still fits with every letter at `fitPressure`.
    // Only part of the word swells at once, so 0.75 keeps it inside the edges while staying large.
    // (The original's two characters per em suits a very condensed font; this works for any.)
    // At rest the letters spread out to fill the width.
    const fp = o.fitPressure ?? 0.75;
    const full = `'wdth' ${map(o.axes.wdth, fp).toFixed(1)}, 'wght' ${Math.round(map(o.axes.wght, fp))}`;
    const resize = () => {
      const cs = getComputedStyle(container);
      const w = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const saved = spans.map((s) => s.style.fontVariationSettings);
      title.style.fontSize = '100px';
      title.style.justifyContent = 'flex-start';
      spans.forEach((s) => (s.style.fontVariationSettings = full));
      const needed = spans.reduce((sum, s) => sum + s.getBoundingClientRect().width, 0);
      spans.forEach((s, i) => (s.style.fontVariationSettings = saved[i]));
      title.style.justifyContent = '';
      title.style.fontSize = Math.max(needed ? (100 * w) / needed : o.minFontSize, o.minFontSize) + 'px';
      wake();
    };

    const mouse = { x: 0, y: 0 };
    const cursor = { x: 0, y: 0, seen: false };
    const ripples = [];
    let visible = true;
    let raf = 0;
    let last = 0;
    let idleFrames = 0;
    let clock = 0;
    let engage = o.idle === 'wave' || o.idle === 'pulse' ? 0 : 1;
    const applied = [];

    const tick = (now) => {
      raf = 0;
      const elapsed = last ? Math.min(now - last, 64) : 1000 / 60;
      last = now;
      const idleMode = (o.idle === 'wave' || o.idle === 'pulse') && !reduce.matches ? o.idle : 'none';
      const lag = 1000 * o.smoothing * o.smoothing;
      const follow = lag > 1 ? 1 - Math.exp(-elapsed / lag) : 1;
      mouse.x += (cursor.x - mouse.x) * follow;
      mouse.y += (cursor.y - mouse.y) * follow;

      let present = 1;
      if (idleMode !== 'none') {
        const box = container.getBoundingClientRect();
        const inside = cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom;
        present = cursor.seen && inside ? 1 : 0;
      }
      engage += (present - engage) * (1 - Math.exp(-elapsed / 320));
      if (Math.abs(present - engage) < 0.002) engage = present;
      const idling = idleMode !== 'none' && engage < 1;
      if (idling) clock += (elapsed / 1000) * o.idleSpeed;
      while (ripples.length && now - ripples[0].start > RIPPLE_LIFE * 1000) ripples.shift();

      const tr = title.getBoundingClientRect();
      const maxDist = Math.max(tr.width * o.radius, 1);
      const spread = Math.max(o.radius * 2, 0.2);
      const centers = spans.map((s) => { const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

      let changed = false;
      spans.forEach((s, i) => {
        const c = centers[i];
        let p = clamp01(1 - dist(mouse, c) / maxDist);
        if (idling) {
          const resting = idlePressure(idleMode, (c.x - tr.left) / Math.max(tr.width, 1), clock, spread);
          p = resting + (p - resting) * engage;
        }
        if (ripples.length) p = 1 - (1 - p) * (1 - ripplePressure(ripples, c, now, tr.width));
        const settings = `'wdth' ${map(o.axes.wdth, p).toFixed(1)}, 'wght' ${Math.round(map(o.axes.wght, p))}`;
        if (applied[i] !== settings) { s.style.fontVariationSettings = settings; applied[i] = settings; changed = true; }
      });

      const moving = Math.abs(cursor.x - mouse.x) > 0.1 || Math.abs(cursor.y - mouse.y) > 0.1;
      const animating = moving || idling || engage !== present || ripples.length > 0;
      idleFrames = animating ? 0 : idleFrames + 1;
      if (visible && (animating || (changed && idleFrames < 60))) raf = requestAnimationFrame(tick);
      else last = 0;
    };

    function wake() { if (!raf && visible) raf = requestAnimationFrame(tick); }

    const track = (x, y) => { cursor.x = x; cursor.y = y; cursor.seen = true; wake(); };
    const leave = () => { cursor.seen = false; wake(); };
    addEventListener('mousemove', (e) => track(e.clientX, e.clientY));
    addEventListener('touchstart', (e) => e.touches[0] && track(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    addEventListener('touchmove', (e) => e.touches[0] && track(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    addEventListener('touchend', leave);
    addEventListener('touchcancel', leave);
    addEventListener('scroll', wake, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseleave', leave);
    document.fonts?.addEventListener?.('loadingdone', () => { resize(); wake(); });
    container.addEventListener('pointerdown', (e) => {
      if (!o.clickRipple) return;
      ripples.push({ x: e.clientX, y: e.clientY, start: performance.now() });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
      wake();
    });

    const box = container.getBoundingClientRect();
    mouse.x = cursor.x = box.left + box.width / 2;
    mouse.y = cursor.y = box.top + box.height / 2;
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(container);
    new ResizeObserver(resize).observe(container);
    resize();
  }

  window.textPressure = textPressure;

  // Auto-start: any element marked [data-text-pressure] (the footer name), sized to its parent.
  // Same settings as the home hero's name: heavy at rest, wider and heavier still near the pointer.
  document.querySelectorAll('[data-text-pressure]').forEach((el) =>
    textPressure(el, { container: el.parentElement, idle: 'wave', axes: { wdth: [62, 125], wght: [800, 900] }, fitPressure: 0.35 }));
})();
