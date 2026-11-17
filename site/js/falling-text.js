// Falling text: a plain-JavaScript port of React Bits' <FallingText /> (words variant), using matter-js.
// Hovering the text drops its words into the `bounds` element; they can be dragged, thrown and
// swiped, then fly back into place once the pile has settled. Reduced motion leaves the text still.
//
//   fallingText(textElement, { bounds: sectionElement, floor: nameElement, trigger: 'hover', restoreDelay: 2.5 })
//
// The text element must not be positioned (no `relative`): the words are positioned against `bounds`.
(() => {
  const STEP = 1000 / 120;
  const WALL = 400;
  const SPRING =
    'linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)';
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const springEase = () =>
    typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)') ? SPRING : 'cubic-bezier(0.34, 1.4, 0.64, 1)';

  function fallingText(block, options = {}) {
    const Matter = window.Matter;
    if (!Matter || !block) return;
    const s = {
      bounds: block.parentElement,
      trigger: 'hover', // 'hover' | 'click' | 'auto'
      gravity: 1,
      bounciness: 0.2,
      scatter: 0.5,
      stagger: 0.03,
      order: 'random', // 'random' | 'sequence' | 'center' | 'together'
      draggable: true,
      mouseConstraintStiffness: 0.2,
      cursorPush: 0.5,
      restoreDelay: 2.5,
      ...options
    };
    const container = s.bounds;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Wrap each word in a piece; the spaces stay as text so the sentence reads the same.
    const words = block.textContent.trim().split(/\s+/);
    block.textContent = '';
    words.forEach((word, i) => {
      if (i) block.append(' ');
      const piece = document.createElement('span');
      piece.className = 'falling-text__piece';
      piece.dataset.piece = '';
      piece.textContent = word;
      block.append(piece);
    });
    block.classList.add('falling-text');

    let phase = 'idle';
    let engine = null;
    let pieces = [];
    let walls = [];
    let drag = null;
    let raf = 0;
    let last = 0;
    let clock = 0;
    let accumulator = 0;
    let quietSince = null;
    let overText = false; // pointer over the sentence's own area
    let armed = true; // after a restore, the pointer must leave the text before it can fall again
    let visible = true;
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, time: 0 };

    const local = (e) => {
      const box = container.getBoundingClientRect();
      return { x: e.clientX - box.left - container.clientLeft, y: e.clientY - box.top - container.clientTop };
    };

    const placeWalls = () => {
      if (!engine) return;
      const w = container.clientWidth;
      let h = container.clientHeight;
      // An optional floor element: the words land on its top edge instead of the bounds' bottom.
      if (s.floor) {
        const box = container.getBoundingClientRect();
        h = clamp(s.floor.getBoundingClientRect().top - box.top - container.clientTop, 40, h);
      }
      const [floor, left, right, ceiling] = walls;
      Matter.Body.setPosition(floor, { x: w / 2, y: h + WALL / 2 });
      Matter.Body.setPosition(left, { x: -WALL / 2, y: h / 2 });
      Matter.Body.setPosition(right, { x: w + WALL / 2, y: h / 2 });
      Matter.Body.setPosition(ceiling, { x: w / 2, y: -WALL / 2 });
      pieces.forEach((p) => Matter.Sleeping.set(p.body, false));
    };

    const draw = (alpha) => {
      for (const p of pieces) {
        const { body } = p;
        const x = p.px + (body.position.x - p.px) * alpha;
        const y = p.py + (body.position.y - p.py) * alpha;
        const a = p.pa + (body.angle - p.pa) * alpha;
        if (Math.abs(x - p.dx) < 0.01 && Math.abs(y - p.dy) < 0.01 && Math.abs(a - p.da) < 0.0001) continue;
        p.dx = x; p.dy = y; p.da = a;
        p.el.style.transform = `translate3d(${(x - p.w / 2).toFixed(2)}px, ${(y - p.h / 2).toFixed(2)}px, 0) rotate(${a.toFixed(4)}rad)`;
      }
    };

    const release = (p) => {
      p.released = true;
      Matter.Body.setStatic(p.body, false);
      Matter.Sleeping.set(p.body, false);
      const kick = clamp(s.scatter, 0, 1) * (p.knocked ? 0.4 : 1);
      Matter.Body.setVelocity(p.body, { x: (Math.random() - 0.5) * 6 * kick, y: -Math.random() * 2.5 * kick });
      Matter.Body.setAngularVelocity(p.body, (Math.random() - 0.5) * 0.12 * kick);
    };

    const frame = (now) => {
      raf = 0;
      if (!engine || !visible) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      clock += dt;
      for (const p of pieces) if (!p.released && (clock >= p.at || p.knocked)) release(p);
      accumulator += dt * 1000;
      while (accumulator >= STEP) {
        for (const p of pieces) { p.px = p.body.position.x; p.py = p.body.position.y; p.pa = p.body.angle; }
        Matter.Engine.update(engine, STEP);
        accumulator -= STEP;
      }
      draw(accumulator / STEP);
      const settled = pieces.every((p) => p.released && (p.body.isSleeping || p.body.speed < 0.05));
      if (s.restoreDelay > 0 && settled && !drag) {
        quietSince ??= now;
        if (now - quietSince > s.restoreDelay * 1000) { restore(); return; }
      } else quietSince = null;
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (!raf && engine && visible) { last = 0; raf = requestAnimationFrame(frame); }
    };

    const fall = () => {
      if (phase !== 'idle' || !armed) return;
      const elements = [...block.querySelectorAll('[data-piece]')];
      if (!elements.length) return;
      const box = container.getBoundingClientRect();
      const ox = box.left + container.clientLeft, oy = box.top + container.clientTop;
      const rects = elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height };
      });
      block.style.minHeight = `${block.offsetHeight}px`;
      const world = Matter.Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
      world.gravity.y = clamp(s.gravity, -3, 4) * 1.4;
      walls = [
        Matter.Bodies.rectangle(0, 0, 10000, WALL, { isStatic: true, friction: 0.8 }),
        Matter.Bodies.rectangle(0, 0, WALL, 10000, { isStatic: true, friction: 0.3 }),
        Matter.Bodies.rectangle(0, 0, WALL, 10000, { isStatic: true, friction: 0.3 }),
        Matter.Bodies.rectangle(0, 0, 10000, WALL, { isStatic: true, friction: 0.3 })
      ];
      const count = rects.length;
      const center = rects.reduce((sum, r) => sum + r.x + r.w / 2, 0) / count;
      const span = Math.max(1, ...rects.map((r) => Math.abs(r.x + r.w / 2 - center)));
      const shuffled = rects.map((_, i) => i).sort(() => Math.random() - 0.5);
      pieces = elements.map((el, i) => {
        const r = rects[i];
        const radius = Math.max(0, Math.min(4, r.w / 2 - 1, r.h / 2 - 1));
        const body = Matter.Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, Math.max(2, r.w - 1), Math.max(2, r.h - 1), {
          chamfer: radius > 0.5 ? { radius } : undefined,
          restitution: clamp(s.bounciness, 0, 1),
          friction: 0.4, frictionStatic: 0.8, frictionAir: 0.012, density: 0.0015, slop: 0.02
        });
        Matter.Body.setStatic(body, true);
        const rank = s.order === 'random' ? shuffled.indexOf(i)
          : s.order === 'center' ? (Math.abs(r.x + r.w / 2 - center) / span) * (count - 1) : i;
        Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: `${r.w}px`, height: `${r.h}px`, margin: '0',
          transform: `translate3d(${r.x}px, ${r.y}px, 0)` });
        return { el, body, w: r.w, h: r.h, x0: r.x, y0: r.y, px: body.position.x, py: body.position.y, pa: 0,
          dx: body.position.x, dy: body.position.y, da: 0, at: s.order === 'together' ? 0 : rank * Math.max(0, s.stagger), released: false };
      });
      Matter.Composite.add(world.world, [...walls, ...pieces.map((p) => p.body)]);
      // A falling word that lands on one still in place knocks it loose.
      const byBody = new Map(pieces.map((p) => [p.body, p]));
      Matter.Events.on(world, 'collisionStart', (event) => {
        const down = Math.sign(world.gravity.y) || 1;
        for (const pair of event.pairs) {
          const a = byBody.get(pair.bodyA), b = byBody.get(pair.bodyB);
          if (!a || !b || a.released === b.released) continue;
          const [moving, still] = a.released ? [a, b] : [b, a];
          if ((still.body.position.y - moving.body.position.y) * down > still.h * 0.25) still.knocked = true;
        }
      });
      engine = world;
      placeWalls();
      phase = 'falling';
      container.dataset.fallPhase = 'falling';
      clock = 0; accumulator = 0; quietSince = null;
      wake();
    };

    const restore = () => {
      if (phase !== 'falling') return;
      phase = 'restoring';
      container.dataset.fallPhase = 'restoring';
      if (drag && engine) { Matter.Composite.remove(engine.world, drag.constraint); drag = null; }
      cancelAnimationFrame(raf); raf = 0;
      const easing = springEase();
      const ordered = [...pieces].sort((a, b) => a.body.position.y - b.body.position.y);
      const animations = ordered.map((p, i) => {
        const angle = Math.atan2(Math.sin(p.body.angle), Math.cos(p.body.angle));
        const from = `translate3d(${(p.body.position.x - p.w / 2).toFixed(2)}px, ${(p.body.position.y - p.h / 2).toFixed(2)}px, 0) rotate(${angle.toFixed(4)}rad)`;
        const to = `translate3d(${p.x0}px, ${p.y0}px, 0) rotate(0rad)`;
        p.el.style.transform = to;
        return p.el.animate([{ transform: from }, { transform: to }], { duration: 760, delay: Math.min(i * 14, 360), easing, fill: 'backwards' });
      });
      Promise.all(animations.map((a) => a.finished.catch(() => null))).then(() => {
        if (phase !== 'restoring') return;
        reset();
        armed = !overText; // still hovering: wait for the pointer to leave and come back
      });
    };

    const reset = () => {
      cancelAnimationFrame(raf); raf = 0;
      if (engine) { Matter.Composite.clear(engine.world, false); Matter.Engine.clear(engine); }
      engine = null;
      for (const p of pieces) {
        p.el.getAnimations().forEach((a) => a.cancel());
        Object.assign(p.el.style, { position: '', left: '', top: '', width: '', height: '', margin: '', transform: '' });
      }
      pieces = []; walls = []; drag = null;
      block.style.minHeight = '';
      phase = 'idle';
      delete container.dataset.fallPhase;
      delete container.dataset.fallDragging;
    };

    // Triggers
    block.addEventListener('pointerenter', () => { overText = true; if (s.trigger === 'hover') fall(); });
    block.addEventListener('pointerleave', () => { overText = false; if (phase === 'idle') armed = true; });
    block.addEventListener('click', () => { if (s.trigger === 'click') fall(); });

    // Drag, throw and swipe, anywhere in the bounds once the words have fallen
    container.addEventListener('pointerdown', (e) => {
      if (!engine || phase !== 'falling' || !s.draggable || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const point = local(e);
      const hit = Matter.Query.point(pieces.filter((p) => p.released).map((p) => p.body), point)[0];
      if (!hit) return;
      e.preventDefault();
      container.setPointerCapture?.(e.pointerId);
      Matter.Sleeping.set(hit, false);
      const constraint = Matter.Constraint.create({
        pointA: point, bodyB: hit, pointB: { x: point.x - hit.position.x, y: point.y - hit.position.y },
        stiffness: clamp(s.mouseConstraintStiffness, 0.01, 1), damping: 0.08, length: 0
      });
      Matter.Composite.add(engine.world, constraint);
      drag = { constraint, id: e.pointerId };
      container.dataset.fallDragging = '';
      wake();
    });

    container.addEventListener('pointermove', (e) => {
      const point = local(e);
      const now = performance.now();
      const dt = Math.max(1, now - pointer.time);
      if (pointer.time && dt < 120) {
        const blend = Math.min(1, dt / 40);
        pointer.vx += ((point.x - pointer.x) / dt - pointer.vx) * blend;
        pointer.vy += ((point.y - pointer.y) / dt - pointer.vy) * blend;
      } else { pointer.vx = 0; pointer.vy = 0; }
      pointer.x = point.x; pointer.y = point.y; pointer.time = now;
      if (phase !== 'falling') return;
      if (drag && e.pointerId === drag.id) { drag.constraint.pointA = point; return; }
      const push = clamp(s.cursorPush, 0, 2);
      const speed = Math.hypot(pointer.vx, pointer.vy);
      if (!push || speed < 0.35) return;
      let touched = false;
      for (const p of pieces) {
        if (!p.released) continue;
        const { body } = p;
        const reach = Math.max(p.w, p.h) / 2 + 18;
        const distance = Math.hypot(body.position.x - point.x, body.position.y - point.y);
        if (distance > reach || now - (p.pushed || 0) < 60) continue;
        p.pushed = now;
        const kick = Math.min(20, speed * push * (1 - (distance / reach) ** 2) * 16);
        Matter.Sleeping.set(body, false);
        Matter.Body.setVelocity(body, { x: body.velocity.x + (pointer.vx / speed) * kick, y: body.velocity.y + (pointer.vy / speed) * kick - kick * 0.7 });
        Matter.Body.setAngularVelocity(body, body.angularVelocity + (Math.random() - 0.5) * 0.06 * push);
        touched = true;
      }
      if (touched) wake();
    });

    const up = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (engine) Matter.Composite.remove(engine.world, drag.constraint);
      drag = null;
      delete container.dataset.fallDragging;
    };
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);

    // Pause the simulation while off screen; keep the walls on the bounds' edges as it resizes.
    new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) wake(); }).observe(container);
    new ResizeObserver(() => { if (phase === 'falling') { placeWalls(); wake(); } }).observe(container);

    if (s.trigger === 'auto') (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(fall));
  }

  window.fallingText = fallingText;
})();
