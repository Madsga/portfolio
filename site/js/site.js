// Shared behaviour: the hero name's stretch on scroll, the portrait's tap-to-focus and the email fallback.
// Both names' pointer effect is js/text-pressure.js.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Stretch: as the hero scrolls away, the name's letters grow upward;
  // once the hero has gone, they spring back to rest.
  const hero = document.querySelector('[data-hero]');
  const heroName = hero && hero.querySelector('[data-pressure]');
  const fade = hero ? [...hero.querySelectorAll('[data-fade]')] : [];
  function onScroll() {
    if (!hero || !heroName || reduce) return;
    const p = Math.min(1, Math.max(0, scrollY / hero.offsetHeight));
    const letters = [...heroName.querySelectorAll('[data-letter]')];
    if (!letters.length) return;
    const done = p >= 0.985;
    heroName.classList.toggle('snap', done);
    const h = letters[0].offsetHeight || 1;
    const max = Math.max(1.5, (hero.offsetHeight * 0.8) / h);
    letters.forEach((l, i) => {
      const lag = 0.72 + 0.28 * Math.abs(Math.sin(i * 1.7 + 0.6));
      const s = done ? 1 : 1 + p * (max - 1) * lag;
      l.style.transform = `scaleY(${s.toFixed(3)})`;
    });
    fade.forEach((f) => (f.style.opacity = done ? 1 : Math.max(0, 1 - p * 3)));
  }

  if (!reduce) {
    document.documentElement.classList.add('motion');
    addEventListener('scroll', onScroll, { passive: true });
  }
  addEventListener('resize', onScroll);
  onScroll();

  // Portrait: sharpen on tap for touch screens (hover and keyboard focus are in CSS).
  document.querySelectorAll('[data-portrait]').forEach((p) => {
    p.addEventListener('click', () => p.classList.toggle('clear'));
  });
  // Footer name: capitals a quarter of the width tall, full-bleed and cropped at the bottom edge.
  // In Archivo with leading-none, the baseline sits .834em below the line's top, so .166em above its bottom.
  // js/text-pressure.js sets the font size; this stretches and places it whenever that changes.
  document.querySelectorAll('[data-foot-name]').forEach((box) => {
    const name = box.querySelector('[data-text-pressure]');
    if (!name) return;
    const place = () => {
      const fs = parseFloat(name.style.fontSize || getComputedStyle(name).fontSize);
      const capH = 0.245 * box.clientWidth;
      const scale = capH / (0.686 * fs);
      name.style.transform = `translateY(${(0.166 * fs * scale).toFixed(1)}px) scaleY(${scale.toFixed(3)})`;
      box.style.setProperty('--foot-name-h', capH.toFixed(1) + 'px');
    };
    new ResizeObserver(place).observe(name);
    addEventListener('resize', place);
    document.fonts?.ready.then(place);
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
