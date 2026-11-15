// Shared behaviour: the name's lens (fisheye) on hover and its vertical stretch on scroll.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const names = [...document.querySelectorAll('[data-name]')];

  // Split each name into words and letters. Each letter is a fixed-width slot (.l)
  // holding a glyph (.g), so the glyph can swell without pushing its neighbours.
  names.forEach((el) => {
    const text = el.textContent.trim();
    el.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.append(sr);
    text.split(' ').forEach((word) => {
      const w = document.createElement('span');
      w.className = 'word';
      w.setAttribute('aria-hidden', 'true');
      [...word].forEach((ch) => {
        const l = document.createElement('span');
        l.className = 'l';
        const g = document.createElement('span');
        g.className = 'g';
        g.textContent = ch;
        l.append(g);
        w.append(l);
      });
      el.append(w);
    });
  });

  // Fit the name to the full width of its parent: one line on wide screens,
  // one word per line (each fitted on its own) on narrow ones.
  function fit() {
    const narrow = innerWidth <= 700;
    names.forEach((el) => {
      const cs = getComputedStyle(el.parentElement);
      const avail = el.parentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const words = [...el.querySelectorAll('.word')];
      el.style.fontSize = '100px';
      words.forEach((w) => (w.style.fontSize = ''));
      if (!el.dataset.frozen) {
        el.querySelectorAll('.l').forEach((l) => (l.style.width = l.getBoundingClientRect().width / 100 + 'em'));
        el.dataset.frozen = '1';
      }
      if (narrow) {
        words.forEach((w) => {
          w.style.fontSize = (100 * avail) / w.getBoundingClientRect().width + 'px';
        });
      } else {
        const first = words[0].getBoundingClientRect();
        const last = words[words.length - 1].getBoundingClientRect();
        el.style.fontSize = (100 * avail) / (last.right - first.left) + 'px';
      }
    });
    onScroll();
  }

  // Lens: letters near the pointer grow, widen and get heavier, and push their
  // neighbours outward, like a fisheye passing over the word.
  function lens(el) {
    const glyphs = [...el.querySelectorAll('.g')];
    let raf = 0, px = 0, py = 0;
    const paint = () => {
      raf = 0;
      glyphs.forEach((g) => {
        const r = g.parentElement.getBoundingClientRect();
        const size = parseFloat(getComputedStyle(g).fontSize);
        const sigma = size * 0.75;
        const dx = r.left + r.width / 2 - px;
        const dy = (r.top + r.height / 2 - py) * 0.6;
        const f = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        const push = (dx / sigma) * f * size * 0.16;
        g.style.transform = `translateX(${push.toFixed(1)}px) scale(${(1 + 0.38 * f).toFixed(3)})`;
        g.style.fontVariationSettings = `"wdth" ${(100 + 25 * f).toFixed(1)}, "wght" ${(800 + 100 * f).toFixed(0)}`;
      });
    };
    el.addEventListener('pointermove', (e) => {
      px = e.clientX; py = e.clientY;
      el.classList.add('lens');
      if (!raf) raf = requestAnimationFrame(paint);
    });
    const reset = () => {
      el.classList.remove('lens');
      glyphs.forEach((g) => { g.style.transform = ''; g.style.fontVariationSettings = ''; });
    };
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointercancel', reset);
  }

  // Stretch: while the pinned hero is scrolled through, the letters grow upward.
  // When the next section arrives they spring back to rest.
  const pin = document.querySelector('[data-pin]');
  const heroName = pin && pin.querySelector('[data-name]');
  const fade = pin ? [...pin.querySelectorAll('[data-fade]')] : [];
  function onScroll() {
    if (!pin || reduce) return;
    const travel = pin.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, scrollY / travel));
    const letters = [...heroName.querySelectorAll('.l')];
    const done = p >= 0.985;
    heroName.classList.toggle('snap', done);
    const h = letters[0].offsetHeight;
    const max = Math.max(1.5, (innerHeight * 0.86) / h);
    letters.forEach((l, i) => {
      const lag = 0.72 + 0.28 * Math.abs(Math.sin(i * 1.7 + 0.6));
      const s = done ? 1 : 1 + p * (max - 1) * lag;
      l.style.transform = `scaleY(${s.toFixed(3)})`;
    });
    fade.forEach((f) => (f.style.opacity = done ? 1 : Math.max(0, 1 - p * 3)));
  }

  if (!reduce) {
    document.documentElement.classList.add('motion');
    names.forEach(lens);
    addEventListener('scroll', onScroll, { passive: true });
  }
  addEventListener('resize', fit);
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

  // Portrait: sharpen on tap for touch screens (hover and keyboard focus are in CSS).
  document.querySelectorAll('[data-portrait]').forEach((p) => {
    p.addEventListener('click', () => p.classList.toggle('clear'));
  });
  // Email links: open a blank email. If no mail app takes over (the page keeps
  // focus), copy the address instead and say so, so a click never does nothing.
  document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
    a.addEventListener('click', () => {
      const address = a.getAttribute('href').slice(7).split('?')[0];
      let left = false;
      const gone = () => (left = true);
      addEventListener('blur', gone, { once: true });
      document.addEventListener('visibilitychange', gone, { once: true });
      setTimeout(async () => {
        removeEventListener('blur', gone);
        document.removeEventListener('visibilitychange', gone);
        if (left) return;
        let copied = false;
        try { await navigator.clipboard.writeText(address); copied = true; } catch (e) {}
        toast(copied ? `No mail app opened, so the address is copied: ${address}` : `Write to ${address}`);
      }, 900);
    });
  });
  let toastEl, toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className =
        'fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 translate-y-4 rounded-xl bg-toast px-[1.2rem] py-[.8rem] ' +
        'font-[system-ui,sans-serif] text-[1rem]/[1.35] text-white shadow-[0_12px_32px_rgba(0,0,0,.3)] select-all ' +
        'pointer-events-none opacity-0 transition-[opacity,translate] duration-250 ' +
        'data-show:pointer-events-auto data-show:translate-y-0 data-show:opacity-100';
      toastEl.setAttribute('role', 'status');
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.toggleAttribute('data-show', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.removeAttribute('data-show'), 6000);
  }
})();
