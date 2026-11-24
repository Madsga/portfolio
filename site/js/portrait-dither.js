// Portrait dither: where the pointer moves over the portrait, it turns into a 1-bit ordered dither
// in the accent colour, and the trail fades back to the photo behind it. Drawn with WebGL.
// The <img> stays as the fallback: without WebGL, or with reduced motion, it shows as is.
//
//   portraitDither(wrapper, { area: heroSection, ink: '#CCFF00', ground: '#071B2D' })
//   wrapper holds the <img>; `area` is where pointer movement is listened for.
(() => {
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5); // top-left origin, like the image
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`;

  // u_mask holds the pointer's trail (0 to 1). Where it is set, each cell of an 8x8 Bayer grid
  // shows ink if the photo is brighter than the cell's threshold, ground if not. The trail's edge
  // is dithered against the same grid, so it dissolves instead of ending in a hard line.
  // Transparent parts of the cut-out stay transparent.
  const FRAG = `
    precision mediump float;
    uniform sampler2D u_img;
    uniform sampler2D u_mask;
    uniform vec2 u_res;      // canvas size, px
    uniform float u_cell;    // dither cell size, px
    uniform vec3 u_ink;
    uniform vec3 u_ground;
    varying vec2 v_uv;

    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    void main() {
      vec4 photo = texture2D(u_img, v_uv);
      vec2 cell = floor(v_uv * u_res / u_cell);
      vec2 cellUv = (cell + 0.5) * u_cell / u_res;      // sample the photo once per cell
      vec4 src = texture2D(u_img, cellUv);
      float threshold = bayer8(cell);
      float m = texture2D(u_mask, v_uv).r;
      float on = step(1.0 - m, threshold * 0.98 + 0.01);  // dithered edge of the trail
      if (on < 0.5 || photo.a < 0.5) { gl_FragColor = photo; return; }
      float lum = src.a > 0.0 ? dot(src.rgb / src.a, vec3(0.299, 0.587, 0.114)) : 0.0;
      lum = clamp((lum - 0.08) * 1.25, 0.0, 1.0);          // a touch more contrast
      vec3 c = lum > threshold ? u_ink : u_ground;
      gl_FragColor = vec4(c, 1.0);
    }`;

  const hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };

  function portraitDither(wrap, options = {}) {
    const img = wrap && wrap.querySelector('img');
    if (!img || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = {
      area: wrap,
      ink: '#CCFF00',
      ground: '#071B2D',
      radius: 0.13, // brush size, as a share of the portrait's width
      cell: 3, // dither cell size, CSS px
      fade: 0.9, // seconds for the trail to fade away
      ...options
    };

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'pointer-events-none absolute inset-0 size-full';
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(['u_img', 'u_mask', 'u_res', 'u_cell', 'u_ink', 'u_ground']
      .map((n) => [n, gl.getUniformLocation(prog, n)]));
    gl.uniform3fv(u.u_ink, hex(o.ink));
    gl.uniform3fv(u.u_ground, hex(o.ground));

    const makeTexture = (unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const photoTex = makeTexture(0);
    const maskTex = makeTexture(1);
    gl.uniform1i(u.u_img, 0);
    gl.uniform1i(u.u_mask, 1);

    // The trail: a small 2D canvas the brush paints into and that fades a little each frame.
    const mask = document.createElement('canvas');
    const mctx = mask.getContext('2d', { willReadFrequently: false });
    const MASK_SCALE = 0.25; // the trail is soft, so a quarter resolution is plenty

    let ready = false, w = 0, h = 0, cw = 0, ch = 0, dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cw = r.width; ch = r.height;
      dpr = Math.min(2, devicePixelRatio || 1);
      w = Math.max(1, Math.round(cw * dpr));
      h = Math.max(1, Math.round(ch * dpr));
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      mask.width = Math.max(1, Math.round(cw * MASK_SCALE));
      mask.height = Math.max(1, Math.round(ch * MASK_SCALE));
      mctx.fillStyle = '#000';
      mctx.fillRect(0, 0, mask.width, mask.height);
      uploadMask();
      draw();
    };
    const uploadMask = () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    };
    const draw = () => {
      if (!ready) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.u_res, w, h);
      gl.uniform1f(u.u_cell, o.cell * dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const start = () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, photoTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
      wrap.append(canvas);
      img.style.visibility = 'hidden'; // the canvas draws the portrait from here on
      resize();
    };

    // Brush: paint soft dots along the path between pointer samples, so fast moves leave no gaps.
    let last = null, raf = 0, prevT = 0, alive = 0;
    const dot = (x, y) => {
      const r = o.radius * cw * MASK_SCALE;
      const g = mctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      mctx.fillStyle = g;
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
    };
    const paint = (e) => {
      if (!ready) return;
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) * MASK_SCALE, y = (e.clientY - r.top) * MASK_SCALE;
      const reach = o.radius * r.width * MASK_SCALE;
      const near = x > -reach && y > -reach && x < mask.width + reach && y < mask.height + reach;
      if (!near) { last = null; return; }
      mctx.globalCompositeOperation = 'lighter';
      if (last) {
        const step = Math.max(1, reach / 3);
        const n = Math.min(40, Math.ceil(Math.hypot(x - last.x, y - last.y) / step));
        for (let i = 1; i <= n; i++) dot(last.x + ((x - last.x) * i) / n, last.y + ((y - last.y) * i) / n);
      } else dot(x, y);
      mctx.globalCompositeOperation = 'source-over';
      last = { x, y };
      alive = o.fade + 0.2;
      wake();
    };
    const tick = (now) => {
      raf = 0;
      const dt = prevT ? Math.min(0.064, (now - prevT) / 1000) : 1 / 60;
      prevT = now;
      // Fade toward black; the amount per frame is set so the trail is gone after o.fade seconds.
      mctx.globalCompositeOperation = 'source-over';
      mctx.fillStyle = `rgba(0,0,0,${Math.min(1, (dt / o.fade) * 2.6).toFixed(3)})`;
      mctx.fillRect(0, 0, mask.width, mask.height);
      uploadMask();
      draw();
      alive -= dt;
      if (alive > 0) raf = requestAnimationFrame(tick);
      else {
        prevT = 0;
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, mask.width, mask.height);
        uploadMask();
        draw();
      }
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

    o.area.addEventListener('pointermove', paint);
    o.area.addEventListener('pointerleave', () => { last = null; });

    new ResizeObserver(() => ready && resize()).observe(wrap);
    if (img.complete && img.naturalWidth) start();
    else img.addEventListener('load', start, { once: true });
  }

  window.portraitDither = portraitDither;

  // Scroll dither: the same 8x8 Bayer grid laid over a whole section, as a vertical gradient.
  // `amount` 0 is no ink anywhere, 1 is solid ink; in between, the ink is densest at the `from` edge
  // and thins out across the section (`spread` 1 = the gradient spans the full height). Cells that are
  // not switched yet stay transparent, so the section shows through.
  //
  //   const set = scrollDither(heroSection, { ink: '#CCFF00', cell: 2, from: 'top' });  set(0.4);
  const SCROLL_FRAG = `
    precision mediump float;
    uniform float u_cell;
    uniform float u_amount;
    uniform float u_height;  // canvas height, px
    uniform float u_fromTop; // 1: densest at the top, 0: at the bottom
    uniform float u_spread;
    uniform vec3 u_ink;
    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
    void main() {
      float threshold = bayer8(floor(gl_FragCoord.xy / u_cell));
      float up = gl_FragCoord.y / u_height;                  // 0 at the bottom, 1 at the top
      float away = mix(up, 1.0 - up, u_fromTop);             // 0 at the dense edge, 1 at the far one
      float density = u_amount * (1.0 + u_spread) - away * u_spread;
      if (density <= threshold * 0.98 + 0.01) discard;
      gl_FragColor = vec4(u_ink, 1.0);
    }`;

  function scrollDither(section, options = {}) {
    const o = { ink: '#CCFF00', cell: 2, from: 'top', spread: 1, ...options };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'pointer-events-none absolute inset-0 z-20 size-full';
    canvas.style.translate = 'none'; // stays put while the section's content drifts
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return () => {};
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, SCROLL_FRAG);
    if (!vs || !fs) return () => {};
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uCell = gl.getUniformLocation(prog, 'u_cell');
    const uAmount = gl.getUniformLocation(prog, 'u_amount');
    const uHeight = gl.getUniformLocation(prog, 'u_height');
    gl.uniform1f(gl.getUniformLocation(prog, 'u_fromTop'), o.from === 'bottom' ? 0 : 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_spread'), o.spread);
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_ink'), hex(o.ink));
    section.append(canvas);

    let amount = 0, dpr = 1;
    const draw = () => {
      canvas.style.visibility = amount > 0 ? '' : 'hidden';
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uCell, o.cell * dpr);
      gl.uniform1f(uAmount, amount);
      gl.uniform1f(uHeight, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(section.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(section.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    };
    new ResizeObserver(resize).observe(section);
    resize();
    return (value) => {
      const next = Math.min(1, Math.max(0, value));
      if (next === amount) return;
      amount = next;
      draw();
    };
  }

  window.scrollDither = scrollDither;
})();
