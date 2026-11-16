// Glimmer site — the live desktop in the hero mockup.
// A small port of what the app does: snow piles up on the window, the Dock and the floor; the window can be
// dragged and flicked; snow can be swept with the cursor and rolled into snowballs; three stacked balls
// become a snowman; the gnome crew and the snowplow clear the snow. The drawings of the gnomes, the cart,
// the snowplow and the snowman are ported shape by shape from the app (main.swift).
(function () {
  const canvas = document.querySelector('.mac__snow');
  if (!canvas || !canvas.getContext) return;
  const screen = canvas.parentElement;
  const winEl = screen.querySelector('.mac__window'), dockEl = screen.querySelector('.mac__dock');
  if (!winEl || !dockEl) return;
  const ctx = canvas.getContext('2d');

  // ---------- units ----------
  // Everything is simulated in "virtual points": the screen is always 1000 wide, whatever its size on the page.
  const VW = 1000, A = 0.8, G = 1300, CELL = 4, PI = Math.PI;
  const GS = 1.45 * A, CS = 1.35 * A, PS = A;          // gnome / cart / plough scale (same ratios as in the app)
  const MAX_R = 27, SHATTER = 560, SMASH = 640;
  let VH = 625, k = 1, dpr = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ss = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const rgb = (r, g, b, a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a === undefined ? 1 : a})`;

  // ---------- snow surfaces (height maps) ----------
  const mk = (name, cap, rad) => ({ name, cap, rad, x0: 0, x1: 1, y: 0, bottom: 0, cell: CELL, h: new Float32Array(0), dirty: 0 });
  const S = { win: mk('win', 30, 12), dock: mk('dock', 26, 16), floor: mk('floor', 44, 0) };
  const ORDER = [S.win, S.dock, S.floor];

  function layout(s, x0, x1, y, bottom) {
    s.x0 = x0; s.x1 = x1; s.y = y; s.bottom = bottom;
    const n = Math.max(4, Math.round((x1 - x0) / CELL));
    if (s.h.length !== n) {
      const o = s.h, h = new Float32Array(n);
      for (let i = 0; i < n; i++) h[i] = o.length ? o[Math.min(o.length - 1, Math.floor(i * o.length / n))] : 0;
      s.h = h;
    }
    s.cell = (x1 - x0) / n;
  }
  function hAt(s, x) {
    const n = s.h.length, f = (x - s.x0) / s.cell - 0.5, i = Math.floor(f);
    const a = s.h[clamp(i, 0, n - 1)], b = s.h[clamp(i + 1, 0, n - 1)];
    return a + (b - a) * clamp(f - i, 0, 1);
  }
  const topAt = (s, x) => s.y - hAt(s, x);
  const inX = (s, x, pad) => x >= s.x0 - (pad || 0) && x <= s.x1 + (pad || 0);
  const W5 = [0.08, 0.24, 0.36, 0.24, 0.08];
  function addSnow(s, x, area) {
    const n = s.h.length, i0 = Math.round((x - s.x0) / s.cell - 0.5);
    for (let d = -2; d <= 2; d++) {
      const i = i0 + d, part = area * W5[d + 2];
      if (i < 0 || i >= n) { if (s !== S.floor) grain(i < 0 ? s.x0 - 2 : s.x1 + 2, s.y - 2, rnd(-20, 20), rnd(0, 40), part); continue; }
      s.h[i] += part / s.cell;
    }
    s.dirty = 10;
  }
  function takeSnow(s, x, radius, maxArea) {
    const n = s.h.length;
    const i0 = clamp(Math.floor((x - radius - s.x0) / s.cell), 0, n - 1), i1 = clamp(Math.ceil((x + radius - s.x0) / s.cell), 0, n - 1);
    let avail = 0;
    for (let i = i0; i <= i1; i++) avail += s.h[i] * s.cell;
    if (avail < 0.05) return 0;
    const f = Math.min(1, maxArea / avail);
    for (let i = i0; i <= i1; i++) s.h[i] *= 1 - f;
    s.dirty = 10;
    return avail * f;
  }
  function maxH(s, x, radius) {
    let m = 0;
    for (let px = x - radius; px <= x + radius; px += s.cell) if (inX(s, px)) m = Math.max(m, hAt(s, px));
    return m;
  }
  function relax(s) {
    const h = s.h, n = h.length, md = 0.9 * s.cell;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n - 1; i++) {
        const d = h[i] - h[i + 1];
        if (d > md) { const m = (d - md) * 0.25; h[i] -= m; h[i + 1] += m; }
        else if (d < -md) { const m = (-d - md) * 0.25; h[i] += m; h[i + 1] -= m; }
      }
    }
    if (s !== S.floor) {          // too much snow at an edge spills off
      for (const i of [0, n - 1]) if (h[i] > 12) {
        const ex = (h[i] - 12) * 0.3; h[i] -= ex;
        grain(i ? s.x1 + 1.5 : s.x0 - 1.5, s.y - h[i], rnd(-12, 12) + (i ? 25 : -25), rnd(-10, 30), ex * s.cell);
      }
    }
    const under = S.dock;         // only a narrow gap under the Dock
    for (let i = 0; i < n; i++) {
      let cap = s.cap;
      if (s === S.floor) { const x = s.x0 + (i + 0.5) * s.cell; if (x > under.x0 - 3 && x < under.x1 + 3) cap = Math.max(4, VH - under.bottom - 3); }
      if (h[i] > cap) h[i] = cap;
      if (h[i] < 0) h[i] = 0;
    }
    if (s.dirty > 0) s.dirty--;
  }
  function seed(s, base, lump) {
    const n = s.h.length, p1 = rnd(0, 6), p2 = rnd(0, 6);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const e = s === S.floor ? 1 : Math.min(1, 0.55 + Math.min(i, n - 1 - i) * s.cell / 40);
      s.h[i] = Math.max(0, (base + lump * (0.6 * Math.sin(u * 9 + p1) + 0.4 * Math.sin(u * 23 + p2)) + rnd(-0.6, 0.6)) * e);
    }
  }

  // ---------- particles ----------
  const flakes = [], grains = [], debris = [], puffs = [];
  function newFlake(anywhere) {
    const z = Math.random();
    return { x: rnd(0, VW), y: anywhere ? rnd(0, VH) : -8, r: 0.9 + z * 2.1, vy: 28 + z * 62, sw: rnd(0, 6.28), a: 0.4 + z * 0.55 };
  }
  // a lump of loose snow in the air; lands on whatever is under it and becomes part of that pile
  function grain(x, y, vx, vy, area, opt) {
    if (grains.length > 900 || area < 0.15) return;
    grains.push(Object.assign({ x, y, vx, vy, area, r: clamp(Math.sqrt(area) * 0.55, 0.9, 3.4), fade: 0, life: 1, skip: null }, opt));
  }
  function launch(s, frac, vx, vy, spread, opt) {
    const h = s.h, n = h.length;
    for (let i = 0; i < n; i++) {
      const a = h[i] * frac;
      if (a < 0.35) continue;
      h[i] -= a;
      const area = a * s.cell, cnt = Math.ceil(area / 11), x = s.x0 + (i + 0.5) * s.cell;
      for (let j = 0; j < cnt; j++) grain(x + rnd(-2, 2), s.y - h[i] - rnd(0, a) - 1, vx + rnd(-spread, spread), vy + rnd(-spread, spread * 0.3), area / cnt, opt);
    }
    s.dirty = 10;
  }

  // ---------- snowballs and snowmen ----------
  const balls = [], men = [];
  function newBall(x, y, r) {
    const b = { x, y, vx: 0, vy: 0, r, area: r * r, rot: rnd(0, 6), rest: 0, safe: 0.3, on: null, ground: false, stuck: null, off: 0, dead: false, pushed: false };
    balls.push(b);
    return b;
  }
  function chainTop(b) { return balls.find(o => o.stuck === b && !o.dead); }
  function depth(b) { let d = 0; while (b.stuck) { b = b.stuck; d++; } return d; }

  function shatter(b) {
    if (b.dead) return;
    b.dead = true;
    const total = b.area * 1.5, s = b.on && S[b.on] ? S[b.on] : (b.y > VH - 90 ? S.floor : null);
    if (s && inX(s, b.x)) addSnow(s, b.x, total * 0.5);
    const rest = s ? total * 0.5 : total, n = clamp(Math.round(b.r), 6, 16);
    for (let i = 0; i < n; i++) grain(b.x + rnd(-b.r, b.r) * 0.6, b.y + rnd(-b.r, b.r) * 0.6, b.vx * 0.25 + rnd(-150, 150), -rnd(40, 260), rest / n);
  }
  function smash(m) {
    if (m.dead) return;
    m.dead = true;
    const [r0, rm, rt] = m.r, total = (r0 * r0 + rm * rm + rt * rt) * 1.5;
    const s = m.on && S[m.on] ? S[m.on] : S.floor;
    for (const dx of [-r0 * 0.5, 0, r0 * 0.5]) if (inX(s, m.x + dx)) addSnow(s, m.x + dx, total * 0.2);
    for (let i = 0; i < 20; i++) grain(m.x + rnd(-r0, r0), m.y - rnd(0, m.o[2] + rt), m.vx * 0.3 + rnd(-170, 170), -rnd(40, 300), total * 0.4 / 20);
    const yt = m.y - m.o[2], ym = m.y - m.o[1];
    const add = (kind, x, y, size) => debris.push({ kind, x, y, vx: m.vx * 0.3 + rnd(-190, 190), vy: -rnd(140, 380), rot: 0, vr: rnd(-9, 9), life: 3, rt, rm, size, landed: false });
    add('hat', m.x, yt - rt * 0.42); add('nose', m.x, yt); add('wrap', m.x, yt + rt * 0.82); add('tail', m.x - rt * 0.42, yt + rt * 0.82);
    for (const sd of [-1, 1]) { add('eye', m.x + sd * rt * 0.3, yt - rt * 0.2); add('arm' + (sd < 0 ? 'L' : 'R'), m.x + sd * rm * 0.78, ym - rm * 0.18); }
    for (let i = 0; i < 3; i++) add('peb' + i, m.x, ym - rm * (0.22 - i * 0.34));
  }
  function makeSnowman(a, b, c) {
    const r = [a.r, b.r, c.r], o1 = (r[0] + r[1]) * 0.88, o2 = o1 + (r[1] + r[2]) * 0.88;
    const m = { x: a.x, y: a.y, vx: 0, vy: 0, r, o: [0, o1, o2], safe: 0.6, on: a.on, ground: true, dead: false, pushed: false };
    for (const x of [a, b, c]) x.dead = true;
    men.push(m);
    for (let i = 0; i < 16; i++) grain(m.x + rnd(-r[1], r[1]), m.y - rnd(0, o2), rnd(-50, 50), -rnd(10, 70), 3, { fade: 1 });
    return m;
  }
  const manHit = (m, x, y, pad) => m.r.some((r, i) => Math.hypot(x - m.x, y - (m.y - m.o[i])) <= r + (pad || 2));

  // circle against a box whose top is raised by the snow lying on it
  function hitBox(o, r, s, bottom, dy0) {
    const cy0 = o.y + (dy0 || 0);
    const top = s.y - (inX(s, o.x) ? hAt(s, o.x) * 0.55 : 0);
    const cx = clamp(o.x, s.x0, s.x1), cy = clamp(cy0, top, bottom);
    let dx = o.x - cx, dy = cy0 - cy, d2 = dx * dx + dy * dy, nx, ny, pen;
    if (d2 >= r * r) return 0;
    if (d2 < 1e-6) {
      const up = cy0 - top, lf = o.x - s.x0, rt = s.x1 - o.x, m = Math.min(up, lf, rt);
      if (m === up) { nx = 0; ny = -1; pen = up + r; } else if (m === lf) { nx = -1; ny = 0; pen = lf + r; } else { nx = 1; ny = 0; pen = rt + r; }
    } else { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = r - d; }
    o.x += nx * pen; o.y += ny * pen;
    const vn = o.vx * nx + o.vy * ny;
    let impact = 0;
    if (vn < 0) { impact = -vn; o.vx -= 1.05 * vn * nx; o.vy -= 1.05 * vn * ny; }
    if (ny < -0.5) { o.on = s.name; o.ground = true; }
    return impact;
  }
  function hitWorld(o, r, dy0) {
    let impact = 0;
    const fy = S.floor.y - hAt(S.floor, clamp(o.x, 0, VW)) * 0.55;
    if (o.y + (dy0 || 0) + r > fy) {
      o.y = fy - r - (dy0 || 0);
      if (o.vy > 0) { impact = o.vy; o.vy *= -0.05; }
      o.on = 'floor'; o.ground = true;
    }
    impact = Math.max(impact, hitBox(o, r, S.win, S.win.bottom, dy0));
    if (!o.pushed) impact = Math.max(impact, hitBox(o, r, S.dock, VH + 40, dy0));   // the plough pushes things past the Dock
    if (!o.pushed) {
      if (o.x < r) { o.x = r; if (o.vx < 0) { impact = Math.max(impact, -o.vx); o.vx *= -0.05; } }
      if (o.x > VW - r) { o.x = VW - r; if (o.vx > 0) { impact = Math.max(impact, o.vx); o.vx *= -0.05; } }
    }
    return impact;
  }

  // ---------- pointer ----------
  const ptr = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, inside: false, mouse: true, t: 0 };
  let grab = null, lastTouch = 0, helperEnd = 0, clock = 0, clearing = false;
  let rect = canvas.getBoundingClientRect();
  const toV = e => ({ x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k });
  const touched = () => { lastTouch = clock; };

  function pileAt(p) {
    for (const s of ORDER) {
      if (!inX(s, p.x)) continue;
      const h = hAt(s, p.x);
      if (h > 2.5 && p.y >= s.y - h - 5 && p.y <= (s === S.floor ? VH + 5 : s.y + 7)) return s;
    }
    return null;
  }
  function pick(p, dry) {
    for (let i = men.length - 1; i >= 0; i--) if (manHit(men[i], p.x, p.y, 3)) return { type: 'man', obj: men[i], ox: men[i].x - p.x, oy: men[i].y - p.y };
    for (let i = balls.length - 1; i >= 0; i--) { const b = balls[i]; if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 4) return { type: 'ball', obj: b, ox: b.x - p.x, oy: b.y - p.y }; }
    const s = pileAt(p);
    if (s) {
      if (dry) return { type: 'pile' };
      const got = takeSnow(s, p.x, 6, 12), r = 4.5, b = newBall(p.x, topAt(s, p.x) - r, r);
      b.area += got * 0.5; b.r = Math.sqrt(b.area);
      return { type: 'ball', obj: b, ox: 0, oy: -r * 0.6 };
    }
    if (p.x >= S.win.x0 && p.x <= S.win.x1 && p.y >= S.win.y && p.y <= S.win.bottom) return { type: 'win', ox: S.win.x0 - p.x, oy: S.win.y - p.y };
    return null;
  }
  function hitAt(p) {            // right click / double click: break what is under the cursor
    for (let i = men.length - 1; i >= 0; i--) if (manHit(men[i], p.x, p.y, 3)) { men[i].vx = rnd(-120, 120); smash(men[i]); return true; }
    for (let i = balls.length - 1; i >= 0; i--) { const b = balls[i]; if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 4) { shatter(b); return true; } }
    return false;
  }
  screen.addEventListener('pointerdown', e => {
    if (e.target.closest('.mac__act')) return;
    rect = canvas.getBoundingClientRect();
    const p = toV(e);
    ptr.x = ptr.px = p.x; ptr.y = ptr.py = p.y; ptr.vx = ptr.vy = 0; ptr.mouse = e.pointerType === 'mouse'; ptr.inside = true;
    touched(); wake(true);
    if (e.button === 2) { hitAt(p); return; }
    const g = pick(p);
    if (!g) return;
    grab = g;
    if (g.type === 'ball') { g.obj.stuck = null; g.obj.pushed = false; }
    if (g.type === 'man') g.obj.pushed = false;
    try { screen.setPointerCapture(e.pointerId); } catch (err) {}
    screen.style.cursor = 'grabbing';
    e.preventDefault();
  });
  screen.addEventListener('touchstart', e => { if (grab) e.preventDefault(); }, { passive: false });
  screen.addEventListener('touchmove', e => { if (grab) e.preventDefault(); }, { passive: false });
  screen.addEventListener('pointermove', e => {
    const p = toV(e);
    if (Math.hypot(p.x - ptr.x, p.y - ptr.y) > 0.5) ptr.t = clock;
    ptr.x = p.x; ptr.y = p.y; ptr.mouse = e.pointerType === 'mouse'; ptr.inside = true;
    if (grab) { touched(); return; }
    if (ptr.mouse) { const g = pick(p, true); screen.style.cursor = g ? 'grab' : ''; }
  });
  function release() {
    if (!grab) return;
    if (grab.type !== 'win') { grab.obj.safe = 0.08; }
    grab = null; screen.style.cursor = '';
  }
  screen.addEventListener('pointerup', release);
  screen.addEventListener('pointercancel', release);
  screen.addEventListener('pointerleave', () => { ptr.inside = false; });
  screen.addEventListener('dblclick', e => { if (!e.target.closest('.mac__act')) hitAt(toV(e)); });

  // ---------- helpers: the gnome crew ----------
  const TUNICS = [[[0.18, 0.52, 0.30], [0.86, 0.18, 0.20]], [[0.20, 0.40, 0.75], [0.98, 0.78, 0.22]], [[0.80, 0.55, 0.16], [0.20, 0.55, 0.32]], [[0.50, 0.27, 0.62], [0.86, 0.18, 0.20]]];
  let crew = null, plough = null, queued = null;
  const floorTop = x => S.floor.y - hAt(S.floor, clamp(x, 0, VW)) * 0.5;
  const dockTop = x => S.dock.y - hAt(S.dock, clamp(x, S.dock.x0 + 1, S.dock.x1 - 1)) * 0.15;

  function newGnome(i) {
    const t = TUNICS[i];
    return { i, x: 0, y: 0, left: true, pose: 'walk', speed: 60, t: rnd(0, 6), scoopT: Math.random(), scooped: false, shovel: i < 3,
      tunic: rgb(t[0][0], t[0][1], t[0][2]), dark: rgb(t[0][0] * 0.75, t[0][1] * 0.75, t[0][2] * 0.75), mitten: rgb(t[1][0], t[1][1], t[1][2]),
      lx: -2.2, ly: 0, rx: 2.2, ry: 0, ty: 4, tr: 0, ar: 0, rot: 0, st: '', w: '' };
  }
  function animGnome(g, dt) {       // same motion as Gnome.animate in the app
    const sin = Math.sin, cos = Math.cos;
    switch (g.pose) {
      case 'stand':
        g.t += dt * 2; g.lx = -2.2; g.ly = 0; g.rx = 2.2; g.ry = 0; g.ty = 4 + sin(g.t) * 0.25; g.tr = 0; g.ar = g.shovel ? 0.15 : -0.25; break;
      case 'walk': case 'push':
        g.t += dt * Math.max(g.speed / A, 10) * 0.32;
        g.lx = -2.2 + sin(g.t) * 2.2; g.ly = Math.max(0, cos(g.t)) * 1.3; g.rx = 2.2 - sin(g.t) * 2.2; g.ry = Math.max(0, -cos(g.t)) * 1.3;
        g.ty = 4 + Math.abs(sin(g.t)) * 0.8; g.tr = g.pose === 'push' ? 0.12 : 0;
        g.ar = g.pose === 'push' ? -0.35 : (g.shovel ? 0.2 + sin(g.t) * 0.18 : sin(g.t) * 0.35); break;
      case 'climb':
        g.t += dt * 7; g.lx = -2.6; g.ly = 1.5 + sin(g.t) * 2.4; g.rx = 1.8; g.ry = 1.5 - sin(g.t) * 2.4;
        g.ty = 4 + sin(g.t * 2) * 0.4; g.tr = 0.08; g.ar = -1.9 + sin(g.t) * 0.35; break;
      case 'scoop': {
        const prev = g.scoopT; g.scoopT += dt / 0.42; if (g.scoopT >= 1) g.scoopT -= 1;
        const p = g.scoopT; if (prev < 0.6 && p >= 0.6) g.scooped = true;
        g.ar = p < 0.45 ? 0.1 + 0.55 * (p / 0.45) : p < 0.68 ? 0.65 - 2.75 * ((p - 0.45) / 0.23) : -2.1 + 2.2 * ((p - 0.68) / 0.32);
        g.tr = p < 0.45 ? 0.16 * (p / 0.45) : Math.max(0, 0.16 - (p - 0.45) * 0.7);
        g.ty = 4 - (p < 0.45 ? 0.6 * (p / 0.45) : 0); g.lx = -3.2; g.ly = 0; g.rx = 2.6; g.ry = 0; break;
      }
      case 'lift':
        g.t += dt * 4; g.ar = -2.4 + sin(g.t) * 0.12; g.tr = -0.05; g.ty = 4 + sin(g.t) * 0.3; g.lx = -3.0; g.ly = 0; g.rx = 2.8; g.ry = 0; break;
      case 'pull':
        g.t += dt * 5; g.ar = -2.25 + sin(g.t) * 0.18; g.tr = -0.18; g.ty = 4; g.lx = -3.4; g.ly = 0; g.rx = 3.0; g.ry = 0; break;
    }
  }
  function armPoint(g, lx, ly) {     // a point of the arm (hand, shovel blade) in screen coordinates
    const a = g.ar, ax = -1.6 + lx * Math.cos(a) - ly * Math.sin(a), ay = g.ty + 8.2 + lx * Math.sin(a) + ly * Math.cos(a);
    return { x: g.x + ax * GS * (g.left ? 1 : -1), y: g.y - ay * GS };
  }
  function cartPoint(c, lx, ly) {
    const r = c.rot;
    return { x: c.x + (lx * Math.cos(r) - ly * Math.sin(r)) * CS, y: c.y - (lx * Math.sin(r) + ly * Math.cos(r)) * CS };
  }
  function cartPlace(c, lx, ly, p, rot) {
    c.rot = rot;
    c.x = p.x - (lx * Math.cos(rot) - ly * Math.sin(rot)) * CS;
    c.y = p.y + (lx * Math.sin(rot) + ly * Math.cos(rot)) * CS;
  }
  function moveG(g, tx, sp, dt) {
    const dx = tx - g.x;
    if (Math.abs(dx) < 0.8) { g.x = tx; return true; }
    const st = Math.sign(dx) * Math.min(Math.abs(dx), sp * dt);
    g.x += st; g.left = st < 0; g.pose = 'walk'; g.speed = sp;
    return false;
  }
  function moveCart(c, tx, sp, dt) {
    const dx = tx - c.x;
    if (Math.abs(dx) < 0.8) { c.x = tx; return true; }
    const st = Math.sign(dx) * Math.min(Math.abs(dx), sp * dt);
    c.x += st; c.wheel -= st / (5.5 * CS);
    return false;
  }
  function callGnomes() {
    const c = { ph: 'walkIn', t: 0, turn: 0, hs: 0, g: [0, 1, 2, 3].map(newGnome), cart: { x: VW + 190, y: 0, rot: 0, load: 0, wheel: 0 }, rope: null, lumps: [], from: null };
    c.g.forEach((g, i) => { g.x = VW + 30 + i * 34; g.y = floorTop(VW); });
    c.g[3].x = c.cart.x + 29 * CS + 4;
    crew = c;
  }
  // one digger: scoop while there is snow in front of the shovel; returns true when that spot is clean
  function dig(c, g, dt) {
    const D = S.dock, bx = g.x + (g.left ? -15 : 15);
    if (g.scooped) {
      g.scooped = false;
      const got = takeSnow(D, bx, 15, 55);
      if (got > 1) {
        const from = armPoint(g, -13, -10), to = cartPoint(c.cart, rnd(-9, 8), 26);
        const T = 0.5 + Math.abs(to.x - from.x) / 620;
        c.lumps.push({ x: from.x, y: from.y, vx: (to.x - from.x) / T, vy: (to.y - from.y - 0.5 * G * T * T) / T, t: 0, T, area: got });
      }
    }
    if (maxH(D, bx, 11) > 1.5) { g.pose = 'scoop'; return false; }
    g.pose = 'stand';
    return true;
  }
  function stepCrew(dt) {
    const c = crew, g = c.g, cart = c.cart, D = S.dock, d0 = D.x0, d1 = D.x1;
    c.t += dt;
    const handX = () => cart.x + 29 * CS + 4;
    const climbUp = (q, wallX, topX) => {                 // walk to the wall, climb it, step onto the top
      if (q.st === 'toWall') { q.y = floorTop(q.x); if (moveG(q, wallX, 62, dt)) { q.st = 'up'; q.left = wallX > topX; } }
      else if (q.st === 'up') { q.pose = 'climb'; q.y -= 55 * dt; if (q.y <= dockTop(topX)) { q.x = topX; q.y = dockTop(topX); q.st = 'top'; return true; } }
      return false;
    };
    const climbDown = (q, edgeX, wallX) => {
      if (q.st === 'toEdge') { q.y = dockTop(q.x); if (moveG(q, edgeX, 62, dt)) { q.st = 'dn'; q.x = wallX; q.left = wallX > edgeX; } }
      else if (q.st === 'dn') { q.pose = 'climb'; q.y += 55 * dt; if (q.y >= floorTop(q.x)) { q.y = floorTop(q.x); q.st = 'floor'; return true; } }
      return false;
    };

    if (c.ph === 'walkIn') {
      let all = true;
      for (let i = 0; i < 3; i++) { all = moveG(g[i], d1 + 18 + i * 24, 72, dt) && all; g[i].y = floorTop(g[i].x); }
      const arrived = moveCart(cart, d1 + 128, 72, dt);
      cart.y = floorTop(cart.x); g[3].x = handX(); g[3].y = floorTop(g[3].x); g[3].left = true; g[3].pose = arrived ? 'stand' : 'push'; g[3].speed = 72;
      if (all && arrived) { c.ph = 'climb'; c.t = 0; c.turn = 0; g.forEach(q => { q.st = 'queue'; q.pose = 'stand'; q.left = true; }); }
    } else if (c.ph === 'climb') {
      // whoever is up starts digging at once; the snow flies down into the cart parked by the wall
      let ready = true;
      for (let i = 0; i < 3; i++) {
        const q = g[i];
        if (q.st === 'queue') { q.pose = 'stand'; q.y = floorTop(q.x); if (c.turn === i) q.st = 'toWall'; }
        if (q.st === 'toWall' || q.st === 'up') { if (climbUp(q, d1 + 7, d1 - 8)) { q.st = 'spot'; c.turn++; } }
        else if (q.st === 'spot') { q.y = dockTop(q.x); if (moveG(q, d1 - 32 - 36 * i, 48, dt)) { q.st = 'dig'; q.left = false; } }
        else if (q.st === 'dig') { q.y = dockTop(q.x); if (!dig(c, q, dt)) ready = false; }
        if (q.st !== 'dig') ready = false;
      }
      g[3].pose = 'stand';
      if ((ready && !c.lumps.length) || c.t > 22) { c.ph = 'hoist'; c.hs = 0; c.t = 0; }
    } else if (c.ph === 'hoist') {
      // two gnomes pull the cart up on a rope, nose first; the fourth one pushes from below
      if (c.hs === 0) {
        const a = moveG(g[1], d1 - 40, 50, dt), b = moveG(g[2], d1 - 16, 50, dt), e = moveG(g[0], d1 - 150, 50, dt);
        for (let i = 0; i < 3; i++) g[i].y = dockTop(g[i].x);
        if (a) { g[1].left = false; g[1].pose = 'pull'; } if (b) { g[2].left = false; g[2].pose = 'pull'; } if (e) { g[0].left = true; g[0].pose = 'stand'; }
        const arrived = moveCart(cart, d1 + 3 + 21 * CS, 60, dt);
        cart.y = floorTop(cart.x); g[3].x = handX(); g[3].y = floorTop(g[3].x); g[3].left = true; g[3].pose = arrived ? 'stand' : 'push'; g[3].speed = 60;
        if (a && b && arrived) { c.hs = 1; c.t = 0; c.from = { x: d1 + 3, y: cart.y - 21 * CS }; }
      } else if (c.hs === 1) {
        const u = c.t / 1.9, p = { x: lerp(c.from.x, d1 + 5, ss(u)), y: lerp(c.from.y, D.y - 8, ss(u)) };
        cartPlace(cart, -21, 21, p, -1.3 * ss(u * 2.5));
        c.rope = [armPoint(g[1], -4.8, -3), armPoint(g[2], -4.8, -3), cartPoint(cart, -21, 21)];
        g[3].pose = 'lift'; g[3].left = true; g[3].x = Math.max(d1 + 30, g[3].x - 30 * dt); g[3].y = floorTop(g[3].x);
        if (u >= 1) { c.hs = 2; c.t = 0; c.from = { x: cart.x, y: cart.y, rot: cart.rot }; }
      } else if (c.hs === 2) {
        const u = ss(c.t / 0.8), tx = d1 - 60;
        cart.x = lerp(c.from.x, tx, u); cart.y = lerp(c.from.y, dockTop(tx), u); cart.rot = lerp(c.from.rot, 0, u);
        c.rope = [armPoint(g[1], -4.8, -3), armPoint(g[2], -4.8, -3), cartPoint(cart, -21, 21)];
        g[3].pose = 'stand';
        if (c.t >= 0.8) { c.hs = 3; c.t = 0; c.rope = null; g[1].pose = g[2].pose = 'stand'; g[3].st = 'toWall'; }
      } else {
        cart.y = dockTop(cart.x);
        if (g[3].st === 'toWall' || g[3].st === 'up') climbUp(g[3], d1 + 7, d1 - 8);
        else { g[3].y = dockTop(g[3].x); if (moveG(g[3], handX(), 45, dt)) { g[3].left = true; g[3].pose = 'stand'; c.ph = 'work'; c.t = 0; g.forEach(q => { q.w = ''; }); } }
      }
    } else if (c.ph === 'work') {
      // each digger clears its own stretch of the Dock, right to left; the cart follows
      const zr = d1 - 108, w = (zr - d0) / 3;
      let done = true;
      for (let i = 0; i < 3; i++) {
        const q = g[i], secL = d0 + i * w;
        q.y = dockTop(q.x);
        if (q.w === '') q.w = 'go';
        if (q.w === 'go') { if (moveG(q, secL + w + 15, 58, dt)) { q.w = 'dig'; q.left = true; } }
        else if (q.w === 'dig') {
          if (dig(c, q, dt)) {
            if (q.x - 15 <= secL + 3 || q.x <= d0 + 14) { q.w = 'done'; q.pose = 'stand'; }
            else { q.x -= 28 * dt; q.pose = 'walk'; q.speed = 28; q.left = true; }
          }
        }
        if (q.w !== 'done') done = false;
      }
      const moved = !moveCart(cart, Math.min(cart.x, g[2].x + 22 * CS + 30), 42, dt);
      cart.y = dockTop(cart.x); g[3].x = handX(); g[3].y = dockTop(g[3].x); g[3].left = true; g[3].pose = moved ? 'push' : 'stand'; g[3].speed = 42;
      if ((done && !c.lumps.length) || c.t > 75) { c.ph = 'down'; c.t = 0; c.turn = 0; g.forEach(q => { q.st = 'top'; }); }
    } else if (c.ph === 'down') {
      // the diggers climb down on the left, the cart is rolled to the edge
      for (let i = 0; i < 3; i++) {
        const q = g[i];
        if (q.st === 'top') { q.y = dockTop(q.x); q.pose = 'stand'; if (c.turn === i) q.st = 'toEdge'; }
        if (q.st === 'toEdge' || q.st === 'dn') { if (climbDown(q, d0 + 8, d0 - 7)) { c.turn++; q.st = 'away'; } }
        else if (q.st === 'away') { q.y = floorTop(q.x); if (moveG(q, d0 - 122 - 24 * i, 62, dt)) { q.st = 'wait'; q.left = false; q.pose = 'stand'; } }
      }
      const arrived = moveCart(cart, d0 + 26, 55, dt);
      cart.y = dockTop(cart.x); g[3].x = handX(); g[3].y = dockTop(g[3].x); g[3].left = true; g[3].pose = arrived ? 'stand' : 'push'; g[3].speed = 55;
      if (c.turn >= 3 && arrived) { c.ph = 'lower'; c.t = 0; c.from = { x: cart.x, y: cart.y, rot: 0 }; g[3].pose = 'pull'; }
    } else if (c.ph === 'lower') {
      // the cart goes over the left edge on the rope and is set down on the floor
      const K = [c.from, { x: d0 - 6, y: D.y + 14, rot: 1.25 }, { x: d0 - 8, y: floorTop(d0 - 8) - 26, rot: 1.25 }, { x: d0 - 46, y: floorTop(d0 - 46), rot: 0 }];
      const u = c.t / 2.2, seg = u < 0.3 ? 0 : u < 0.75 ? 1 : 2, a = [0, 0.3, 0.75, 1], v = ss((u - a[seg]) / (a[seg + 1] - a[seg]));
      cart.x = lerp(K[seg].x, K[seg + 1].x, v); cart.y = lerp(K[seg].y, K[seg + 1].y, v); cart.rot = lerp(K[seg].rot, K[seg + 1].rot, v);
      g[3].pose = 'pull'; g[3].left = true;
      c.rope = [armPoint(g[3], -4.8, -3), cartPoint(cart, 19, 21)];
      for (let i = 0; i < 3; i++) { const q = g[i]; if (q.st === 'away') { q.y = floorTop(q.x); if (moveG(q, d0 - 122 - 24 * i, 62, dt)) { q.st = 'wait'; q.left = false; q.pose = 'stand'; } } }
      if (u >= 1) { c.ph = 'g3down'; c.t = 0; c.rope = null; g[3].st = 'toEdge'; }
    } else if (c.ph === 'g3down') {
      cart.y = floorTop(cart.x);
      if (climbDown(g[3], d0 + 8, d0 - 7) || c.t > 8) { c.ph = 'leave'; c.t = 0; }
    } else if (c.ph === 'leave') {
      // everyone walks off to the left and takes the snow away
      for (let i = 0; i < 3; i++) { moveG(g[i], -90, 72, dt); g[i].y = floorTop(g[i].x); }
      moveCart(cart, -160, 72, dt); cart.y = floorTop(cart.x);
      g[3].x = handX(); g[3].y = floorTop(g[3].x); g[3].left = true; g[3].pose = 'push'; g[3].speed = 72;
      if (cart.x < -110 || c.t > 20) { crew = null; helperEnd = clock; return; }
    }
    for (const q of g) animGnome(q, dt);
    for (let i = c.lumps.length - 1; i >= 0; i--) {
      const l = c.lumps[i];
      l.t += dt; l.vy += G * dt; l.x += l.vx * dt; l.y += l.vy * dt;
      if (l.t >= l.T) { cart.load += l.area; c.lumps.splice(i, 1); }
    }
  }

  // ---------- helpers: the snowplow ----------
  function callPlough() { plough = { x: VW + 60, load: 0, moundH: 0, phase: 0, smoke: 0, wheel: 0, auger: 0 }; }
  function stepPlough(dt) {
    const p = plough, F = S.floor, dx = 125 * dt;
    p.x -= dx; p.phase += dt; p.wheel += dx / (10 * PS); p.auger += dt * 14;
    const blade = p.x - 48 * PS;
    // the auger eats the snow in front of it…
    const i0 = clamp(Math.floor((blade - 3 - F.x0) / F.cell), 0, F.h.length - 1), i1 = clamp(Math.ceil((blade + dx + 8 - F.x0) / F.cell), 0, F.h.length - 1);
    for (let i = i0; i <= i1; i++) if (F.h[i] > 1.2) { p.load += (F.h[i] - 1.2) * F.cell; F.h[i] = 1.2; }
    // …and blows it out of the chute
    const out = Math.min(p.load, 1100 * dt);
    p.load -= out;
    if (out > 2) {
      const tip = { x: p.x - 53 * PS, y: floorTop(p.x) - 52 * PS }, n = Math.min(7, Math.ceil(out / 9));
      for (let i = 0; i < n; i++) grain(tip.x, tip.y, -rnd(120, 300), -rnd(260, 470), 8, { fade: 1, life: rnd(0.7, 1.2) });
    }
    const target = Math.min(78, Math.sqrt(p.load / 0.8)) * 0.7;
    p.moundH += (target - p.moundH) * Math.min(1, dt * (target > p.moundH ? 3 : 1.5));
    p.smoke += dt;
    if (p.smoke > 0.22) { p.smoke = 0; puffs.push({ x: p.x + 31 * PS, y: floorTop(p.x) - 50 * PS, t: 0, d: rnd(5, 8) * PS }); }
    // snowballs and snowmen in the way are pushed along
    const front = blade - (p.moundH > 1 ? (p.moundH * 1.7 + 6) * PS : 0);
    for (const o of balls.concat(men)) {
      const r = o.r.length ? o.r[0] : o.r;
      if (o.stuck || (grab && grab.obj === o)) continue;
      if (o.y + r > S.floor.y - 46 && o.x + r > front && o.x < p.x + 20) { o.x = front - r; o.vx = -125; o.pushed = true; o.safe = 0.3; }
    }
    if (p.x < -80) { plough = null; helperEnd = clock; }
  }

  // ---------- actions ----------
  const busy = () => !!(crew || plough);
  function act(name, fromUser, fromPanel) {
    if (fromUser) { touched(); wake(true); }
    if (effect !== 0) {
      if (name === 'shake') { fxShake(); return; }
      if (name === 'clear') { fxClear(); return; }
      if (fromPanel) return;                     // in the app these buttons are greyed out outside of Snow
      setEffect(0);
    }
    if (name === 'gnomes' || name === 'plough') {
      if (busy()) { queued = name; return; }
      clearing = false;
      name === 'gnomes' ? callGnomes() : callPlough();
    } else if (name === 'shake') {
      launch(S.win, 1, 0, -330, 190, { skip: S.win });
      launch(S.dock, 1, 0, -380, 210, { skip: S.dock });
      for (const o of balls.concat(men)) if (o.on === 'win' || o.on === 'dock') { o.vy = -rnd(280, 420); o.vx = rnd(-160, 160); o.y -= 3; o.stuck = null; }
    } else if (name === 'clear') {
      clearing = true;
      balls.forEach(b => { b.dead = true; }); men.forEach(m => { m.dead = true; });
      grains.forEach(g => { g.fade = 1; g.life = Math.min(g.life, 0.4); });
    } else if (name === 'snowman') {
      // three snowballs dropped one onto another
      clearing = false;
      const x = clamp(S.dock.x0 - 110, 70, VW - 70), base = floorTop(x);
      [[20, 0], [15, 0.45], [11, 0.9]].forEach(([r, delay], i) => setTimeout(() => {
        const b = newBall(x + rnd(-1.5, 1.5), base - 52 - i * 42, r); b.safe = 3;
      }, delay * 1000));
    }
  }
  document.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    act(el.dataset.act, true, el.classList.contains('mac__act'));
    if (el.classList.contains('mac__act')) { el.classList.add('is-hit'); setTimeout(() => el.classList.remove('is-hit'), 260); }
    else if (window.matchMedia('(max-width: 900px)').matches) screen.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  // ---------- the other effects: rain, sakura, leaves, fireflies, starfall ----------
  // Same numbers as in the app (WeatherScene: spawnDrops, spawnSettling, updateFireflies, spawnMeteor…),
  // scaled to the mockup: SP — speeds, SZ — sizes. Rates are the app defaults (rate = 30).
  const SP = 0.66, SZ = 0.85;
  const FX_WALL = ['assets/img/wall-snow.jpg', 'assets/img/fx/wall-rain.jpg', 'assets/img/fx/wall-sakura.jpg',
    'assets/img/fx/wall-autumn.jpg', 'assets/img/fx/wall-fireflies.jpg', 'assets/img/fx/wall-sky.jpg'];
  const SAKURA = [rgb(1.00, 0.80, 0.87), rgb(1.00, 0.71, 0.80), rgb(0.98, 0.88, 0.92)];
  const LEAVES = [rgb(0.89, 0.45, 0.13), rgb(0.78, 0.22, 0.12), rgb(0.93, 0.69, 0.16), rgb(0.55, 0.33, 0.14)];
  let effect = 0, fxAcc = 0, wind = 0, nextFlash = 0, flash = null, nextMeteor = 0;
  const drops = [], splashes = [], petals = [], flies = [], meteors = [], sparks = [];
  const stack = { win: new Float32Array(0), dock: new Float32Array(0), floor: new Float32Array(0) };   // petals lying on each surface
  const panelImg = screen.querySelector('.mac__panel img'), wallImg = screen.querySelector('.mac__wall');
  const pick1 = a => a[Math.floor(Math.random() * a.length)];

  function stackOf(name) {
    const sf = S[name], n = sf.h.length;
    if (stack[name].length !== n) stack[name] = new Float32Array(n);
    return stack[name];
  }
  // top of the petal layer on a surface
  function petalTop(sf, x) {
    const st = stackOf(sf.name), i = clamp(Math.floor((x - sf.x0) / sf.cell), 0, st.length - 1);
    return sf.y - st[i];
  }
  function addPetal(sf, x, amt) {
    const st = stackOf(sf.name), i0 = Math.floor((x - sf.x0) / sf.cell);
    for (let d = -1; d <= 1; d++) { const i = i0 + d; if (i >= 0 && i < st.length) st[i] = Math.min(sf === S.floor ? 9 : 6, st[i] + amt * (d ? 0.25 : 0.5)); }
  }

  function setEffect(e) {
    if (e === effect) return;
    effect = e;
    // like clearAll() in the app: everything of the old effect disappears
    for (const sf of ORDER) sf.h.fill(0);
    grains.length = 0; debris.length = 0; puffs.length = 0;
    balls.forEach(b => { b.dead = true; }); men.forEach(m => { m.dead = true; });
    balls.length = 0; men.length = 0; crew = null; plough = null; queued = null; clearing = false;
    if (grab && grab.type !== 'win') release();
    drops.length = splashes.length = petals.length = flies.length = meteors.length = sparks.length = 0;
    for (const k2 in stack) stack[k2].fill(0);
    fxAcc = 0; nextFlash = clock + rnd(3, 8); flash = null; nextMeteor = clock + 0.5;
    if (e === 0) { seed(S.win, 8, 2.5); seed(S.dock, 9, 2.5); seed(S.floor, 14, 4); for (const sf of ORDER) for (let i = 0; i < 6; i++) relax(sf); }
    if (e === 4) for (let i = 0; i < 26; i++) addFly(true);
    if (e === 2 || e === 3) {                       // the first petals are already on their way down
      for (let i = 0; i < 70; i++) { spawnPetal(e === 2); const f = petals[petals.length - 1]; f.y = rnd(-10, VH * 0.85); f.vy = rnd(15, 30) * SP; }
    }
    panelImg.src = `assets/img/fx/panel-${e}.png`;
    screen.classList.toggle('is-snow', e === 0);
    // the wallpaper follows the effect, like "Match wallpaper to effect" in the app
    const next = new Image();
    next.onload = () => {
      const fade = wallImg.cloneNode();
      fade.src = next.src; fade.style.opacity = '0'; fade.style.transition = 'opacity .45s';
      wallImg.after(fade);
      requestAnimationFrame(() => requestAnimationFrame(() => { fade.style.opacity = '1'; }));
      setTimeout(() => { wallImg.src = next.src; fade.remove(); }, 520);
    };
    next.src = FX_WALL[e];
  }

  function addFly(anywhere) {
    const s2 = rnd(14, 22) * SZ;
    flies.push({ x: rnd(10, VW - 10), y: rnd(40, VH - 30), vx: 0, vy: 0, size: s2, wander: rnd(0, 6.28), phase: rnd(0, 6.28),
      pulse: rnd(1.2, 2.6), orbit: rnd(25, 110) * SP, a: anywhere ? 1 : 0 });
  }

  function spawnPetal(sak) {
    const r = sak ? rnd(2.4, 3.6) : rnd(3.2, 4.8);
    petals.push({ x: rnd(0, VW), y: -10, vx: rnd(-6, 6) * SP, vy: rnd(5, 15) * SP, rot: rnd(0, 6.28), vr: rnd(-3, 3),
      w: r * (sak ? 2.4 : 2.8) * SZ, h: r * 1.6 * SZ, c: pick1(sak ? SAKURA : LEAVES), on: null, ox: 0, oy: 0, age: 0 });
  }

  function stepFx(dt) {
    const tops = [S.win, S.dock];
    const still = ptr.inside && ptr.mouse && clock - ptr.t > 0.6;
    const ps = Math.hypot(ptr.vx, ptr.vy);

    if (effect === 1) {                                   // rain: fast slanted streaks, splashes, lightning
      fxAcc += 30 * 6.5 * dt;
      while (fxAcc >= 1 && drops.length < 600) {
        fxAcc -= 1;
        const vx = -rnd(35, 70) * SP, vy = rnd(650, 900) * SP;
        drops.push({ x: rnd(0, VW + 80), y: -14, vx, vy, len: rnd(9, 15) * SZ, a: rnd(0.35, 0.6) });
      }
      if (fxAcc > 1) fxAcc = 1;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i], oy = d.y, nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
        let hit = null;
        for (const sf of tops) if (oy <= sf.y && ny > sf.y && nx >= sf.x0 && nx <= sf.x1) { hit = sf.y; break; }
        if (hit === null && ny >= VH - 1) hit = VH - 1;
        if (hit !== null) {
          if (splashes.length < 240) for (let q = 0; q < 3; q++) splashes.push({ x: nx, y: hit, dx: rnd(-14, 14) * SP, dy: -rnd(6, 18) * SP, t: 0 });
          drops.splice(i, 1);
        } else if (nx < -60) drops.splice(i, 1);
        else { d.x = nx; d.y = ny; }
      }
      for (let i = splashes.length - 1; i >= 0; i--) { splashes[i].t += dt; if (splashes[i].t > 0.28) splashes.splice(i, 1); }
      if (clock >= nextFlash) { nextFlash = clock + rnd(9, 22); flash = { t: 0 }; }
      if (flash) { flash.t += dt; if (flash.t > 0.52) flash = null; }
    }

    else if (effect === 2 || effect === 3) {              // sakura / leaves: drift down and pile up on the window, Dock, floor
      const sak = effect === 2;
      fxAcc += 30 * (sak ? 0.4 : 0.35) * dt;
      while (fxAcc >= 1) { fxAcc -= 1; spawnPetal(sak); }
      const g = (sak ? 0.35 : 0.45) * 150 * SP, damp = sak ? 1.4 : 1.2, amp = (sak ? 3.4 : 4.2) * 15 * SP, freq = sak ? 1.1 : 1.6;
      wind += dt;
      for (const f of petals) {
        f.age += dt;
        if (f.on) {
          if (f.on === 'win') { f.x = S.win.x0 + f.ox; f.y = S.win.y + f.oy; }
          // the cursor gently stirs them up
          if (ptr.inside && ptr.mouse && ps > 250 && !grab) {
            const R = (sak ? 55 : 85) * SP, dx = f.x - ptr.x, dy = f.y - ptr.y, d = Math.hypot(dx, dy);
            if (d < R) { const kk = 1 - d / R; f.on = null; f.vx = ptr.vx * 0.2 * kk + dx / Math.max(d, 1) * 70 * kk * SP; f.vy = ptr.vy * 0.2 * kk + dy / Math.max(d, 1) * 70 * kk * SP - 20 * kk; f.vr = rnd(-4, 4); }
          }
          continue;
        }
        f.vy += g * dt;
        if (f.vy > 12 * SP) f.vx += Math.sin(wind * freq - f.y * 0.015) * amp * dt;
        f.vx *= Math.max(0, 1 - damp * dt); f.vy *= Math.max(0, 1 - damp * dt);
        if (ptr.inside && ptr.mouse && ps > 250 && !grab) {
          const R = (sak ? 55 : 85) * SP, dx = f.x - ptr.x, dy = f.y - ptr.y, d = Math.hypot(dx, dy);
          if (d < R) { const kk = 1 - d / R; f.vx += ptr.vx * 0.2 * kk * dt * 8 + dx / Math.max(d, 1) * 70 * kk * SP * dt * 8; f.vy += ptr.vy * 0.2 * kk * dt * 8 + dy / Math.max(d, 1) * 70 * kk * SP * dt * 8 - 20 * kk * dt * 8; }
        }
        const oy = f.y;
        f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
        for (const sf of [S.win, S.dock, S.floor]) {
          if (!inX(sf, f.x)) continue;
          const top = petalTop(sf, f.x);
          if (f.vy > 0 && oy <= top + 1 && f.y >= top - 0.5) {
            f.y = top - f.h * 0.3; f.on = sf.name; f.vx = f.vy = 0; f.vr = 0;
            f.rot = (Math.random() - 0.5) * 0.9 + (Math.random() < 0.5 ? 0 : PI);
            if (sf === S.win) { f.ox = f.x - S.win.x0; f.oy = f.y - S.win.y; }
            addPetal(sf, f.x, f.h * 0.35);
            break;
          }
        }
      }
      // old ones fade out (the app keeps the newest few hundred)
      const cap = 320;
      if (petals.length > cap) petals.splice(0, petals.length - cap);
      for (let i = petals.length - 1; i >= 0; i--) { const f = petals[i]; if (f.y > VH + 20 || f.x < -60 || f.x > VW + 60) petals.splice(i, 1); }
      for (const k2 in stack) { const st = stack[k2]; for (let i = 0; i < st.length; i++) st[i] = Math.max(0, st[i] - dt * 0.05); }
    }

    else if (effect === 4) {                              // fireflies: wander, pulse, circle around a resting cursor
      while (flies.length < 48) addFly(false);
      for (const f of flies) {
        f.wander += rnd(-1, 1) * 4 * dt;
        let ax = Math.cos(f.wander) * 35 * SP, ay = Math.sin(f.wander) * 35 * SP;
        if (still) {
          const dx = ptr.x - f.x, dy = ptr.y - f.y, dist = Math.max(Math.hypot(dx, dy), 1), ux = dx / dist, uy = dy / dist;
          const radial = clamp(dist - f.orbit, -80 * SP, 260 * SP) * 1.2;
          ax += ux * radial - uy * 55 * SP; ay += uy * radial + ux * 55 * SP;
        }
        f.vx = (f.vx + ax * dt) * Math.max(0, 1 - dt); f.vy = (f.vy + ay * dt) * Math.max(0, 1 - dt);
        const sp = Math.hypot(f.vx, f.vy), mx = 95 * SP;
        if (sp > mx) { f.vx *= mx / sp; f.vy *= mx / sp; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.x < 4) { f.x = 4; f.vx = Math.abs(f.vx); } if (f.x > VW - 4) { f.x = VW - 4; f.vx = -Math.abs(f.vx); }
        if (f.y < 30) { f.y = 30; f.vy = Math.abs(f.vy); } if (f.y > VH - 14) { f.y = VH - 14; f.vy = -Math.abs(f.vy); }
        f.phase += dt * f.pulse;
        f.a = Math.min(1, f.a + dt * 2);
      }
    }

    else if (effect === 5) {                              // starfall: meteors with a glowing head, sparks where they hit
      if (clock >= nextMeteor && meteors.length < 12) {
        nextMeteor = clock + rnd(0.6, 2.2);
        const ang = rnd(0.6, 1.0), sp = rnd(800, 1200) * SP, dir = Math.random() < 0.5 ? 1 : -1;
        meteors.push({ x: dir < 0 ? rnd(VW * 0.3, VW + 150) : rnd(-150, VW * 0.7), y: -20, vx: dir * Math.cos(ang) * sp, vy: Math.sin(ang) * sp, len: rnd(110, 190) * SZ });
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i], oy = m.y, nx = m.x + m.vx * dt, ny = m.y + m.vy * dt;
        let hit = null;
        for (const sf of tops) if (oy <= sf.y && ny > sf.y && nx >= sf.x0 && nx <= sf.x1) { hit = sf.y; break; }
        if (hit === null && ny >= VH - 1) hit = VH - 1;
        if (hit !== null) {
          for (let q = 0; q < 14; q++) { const a = rnd(0.15, 2.99), v = rnd(60, 220) * SP; sparks.push({ x: nx, y: hit, dx: Math.cos(a) * v * 0.5, dy: -(Math.sin(a) * v * 0.5 - 20 * SP), t: 0, c: pick1(['#FFD980', '#FF9A4D', '#FFFFFF']) }); }
          meteors.splice(i, 1);
        } else if (nx < -260 || nx > VW + 260) meteors.splice(i, 1);
        else { m.x = nx; m.y = ny; }
      }
      for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].t += dt; if (sparks[i].t > 0.55) sparks.splice(i, 1); }
    }
  }

  function fxShake() {
    for (const f of petals) if (f.on === 'win' || f.on === 'dock') { f.on = null; f.vx = rnd(-90, 90) * SP; f.vy = -rnd(160, 260) * SP; f.vr = rnd(-6, 6); }
    stackOf('win').fill(0); stackOf('dock').fill(0);
  }
  function fxClear() { petals.length = 0; for (const k2 in stack) stack[k2].fill(0); }

  function drawFx() {
    if (effect === 1) {
      ctx.strokeStyle = rgb(0.75, 0.86, 1); ctx.lineCap = 'round'; ctx.lineWidth = 1.2 * SZ;
      for (const d of drops) {
        const v = Math.hypot(d.vx, d.vy);
        ctx.globalAlpha = d.a; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.vx / v * d.len, d.y - d.vy / v * d.len); ctx.stroke();
      }
      ctx.fillStyle = rgb(0.8, 0.9, 1);
      for (const s2 of splashes) { const u = s2.t / 0.28; ctx.globalAlpha = 0.8 * (1 - u); ctx.beginPath(); ctx.arc(s2.x + s2.dx * u, s2.y + s2.dy * u, 1, 0, 2 * PI); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (flash) {
        const t = flash.t, a = t < 0.04 ? 0.22 * t / 0.04 : t < 0.12 ? lerp(0.22, 0.05, (t - 0.04) / 0.08) : t < 0.17 ? lerp(0.05, 0.18, (t - 0.12) / 0.05) : lerp(0.18, 0, (t - 0.17) / 0.35);
        ctx.fillStyle = `rgba(217,230,255,${Math.max(0, a)})`; ctx.fillRect(0, 0, VW, VH + 2);
      }
    } else if (effect === 2 || effect === 3) {
      const sak = effect === 2;
      for (const f of petals) {
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = f.c;
        const w = f.w, h = f.h;
        ctx.beginPath();
        if (sak) ctx.ellipse(0, 0, w / 2 - 0.3, h / 2 - 0.3, 0, 0, 2 * PI);
        else { ctx.moveTo(-w / 2, 0); ctx.bezierCurveTo(-w * 0.2, -h / 2, w * 0.2, -h / 2, w / 2, 0); ctx.bezierCurveTo(w * 0.2, h / 2, -w * 0.2, h / 2, -w / 2, 0); }
        ctx.fill(); ctx.restore();
      }
    } else if (effect === 4) {
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        const al = f.a * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(f.phase))), r = f.size / 2;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(217,255,115,${al})`); g.addColorStop(1, 'rgba(217,255,115,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 2 * PI); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (effect === 5) {
      ctx.globalCompositeOperation = 'lighter';
      for (const m of meteors) {
        const v = Math.hypot(m.vx, m.vy), tx = m.x - m.vx / v * m.len, ty = m.y - m.vy / v * m.len;
        const g = ctx.createLinearGradient(tx, ty, m.x, m.y);
        g.addColorStop(0, 'rgba(217,235,255,0)'); g.addColorStop(1, 'rgba(217,235,255,1)');
        ctx.strokeStyle = g; ctx.lineWidth = 3 * SZ; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(m.x, m.y); ctx.stroke();
        const hg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 8 * SZ);
        hg.addColorStop(0, 'rgba(255,255,255,1)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(m.x, m.y, 8 * SZ, 0, 2 * PI); ctx.fill();
      }
      for (const s2 of sparks) {
        const u = s2.t / 0.55, e = 1 - (1 - u) * (1 - u);
        ctx.globalAlpha = 1 - u; ctx.fillStyle = s2.c; ctx.beginPath(); ctx.arc(s2.x + s2.dx * e, s2.y + s2.dy * e, 1.5 * (1 - 0.7 * u), 0, 2 * PI); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  document.querySelectorAll('[data-fx]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); touched(); wake(true);
    setEffect(+el.dataset.fx);
    el.classList.add('is-hit'); setTimeout(() => el.classList.remove('is-hit'), 260);
  }));
  // preload the panel pictures so switching does not blink
  for (let i = 0; i < 6; i++) { const im = new Image(); im.src = `assets/img/fx/panel-${i}.png`; }

  // ---------- simulation step ----------
  let prevWin = null, winV = { x: 0, y: 0 };
  function frameStart(dt) {
    // window being dragged
    if (grab && grab.type === 'win') {
      const w = S.win.x1 - S.win.x0, h = S.win.bottom - S.win.y;
      const x0 = clamp(ptr.x + grab.ox, 4, VW - w - 4), y0 = clamp(ptr.y + grab.oy, 42, Math.max(42, VH - h - 16));
      S.win.x0 = x0; S.win.x1 = x0 + w; S.win.y = y0; S.win.bottom = y0 + h;
      winEl.style.left = (x0 / VW * 100) + '%'; winEl.style.top = (y0 / VH * 100) + '%';
    }
    // …carries what stands on it; a sharp jerk throws the snow into the air
    if (prevWin) {
      const dx = S.win.x0 - prevWin.x, dy = S.win.y - prevWin.y;
      const raw = { x: dx / dt, y: dy / dt }, nv = { x: winV.x * 0.45 + raw.x * 0.55, y: winV.y * 0.45 + raw.y * 0.55 };
      const jerk = Math.hypot(nv.x - winV.x, nv.y - winV.y);
      const riders = balls.concat(men).filter(o => o.on === 'win' && !o.stuck && !(grab && grab.obj === o));
      for (const o of riders) { o.x += dx; o.y += dy; }
      if (effect !== 0 && jerk > 210) for (const f of petals) if (f.on === 'win') { f.on = null; f.vx = winV.x * 0.8; f.vy = Math.min(winV.y * 0.8, 0) - 40; f.vr = rnd(-6, 6); }
      if (effect !== 0 && jerk > 210) stackOf('win').fill(0);
      if (jerk > 210) {
        const f = clamp((jerk - 170) / 420, 0.12, 1);
        launch(S.win, f, winV.x * 0.85, Math.min(winV.y * 0.85, 0) - 40 * f, 60 + 60 * f);
        if (f > 0.35) for (const o of riders) { o.vx = winV.x * 0.8; o.vy = Math.min(winV.y * 0.8, 0) - 60; o.y -= 2; o.safe = Math.max(o.safe, 0.05); }
      }
      winV = nv;
    }
    prevWin = { x: S.win.x0, y: S.win.y };

    // pointer speed; sweeping the snow with the cursor
    ptr.vx = (ptr.x - ptr.px) / dt; ptr.vy = (ptr.y - ptr.py) / dt;
    const sp = Math.hypot(ptr.vx, ptr.vy);
    if (effect === 0 && !grab && ptr.inside && ptr.mouse && sp > 160 && sp < 6000) {
      for (const s of ORDER) {
        if (!inX(s, ptr.x)) continue;
        const h = hAt(s, ptr.x);
        if (h < 1.2 || ptr.y < s.y - h - 3 || ptr.y > s.y + 4) continue;
        const got = takeSnow(s, ptr.x, 7, sp * dt * 1.3);
        const n = Math.min(5, Math.ceil(got / 5));
        for (let i = 0; i < n; i++) grain(ptr.x + rnd(-4, 4), s.y - h - 1, ptr.vx * 0.45 + rnd(-50, 50), -Math.abs(sp) * 0.22 - rnd(40, 150), got / n);
        touched();
        break;
      }
    }
    ptr.px = ptr.x; ptr.py = ptr.y;
  }
  function step(dt) {
    clock += dt;
    if (effect !== 0) { stepFx(dt); return; }
    // falling snow
    for (const f of flakes) {
      f.y += f.vy * dt; f.sw += dt * 0.8; f.x += Math.sin(f.sw) * 14 * dt;
      let landed = false;
      if (!clearing) for (const s of ORDER) {
        if (!inX(s, f.x)) continue;
        const top = topAt(s, f.x);
        if (s === S.floor ? f.y >= top : (f.y >= top && f.y <= s.y + 8)) { if (!(crew && s === S.dock)) addSnow(s, f.x, f.r * f.r * 2.2); landed = true; break; }
        if (s !== S.floor && f.y > s.y + 8 && f.y < s.bottom) { landed = true; break; }   // behind the window / the Dock
      }
      if (landed || f.y > VH + 6) Object.assign(f, newFlake(false));
    }

    // loose snow in the air
    for (let i = grains.length - 1; i >= 0; i--) {
      const g = grains[i];
      g.vy += G * dt; g.vx *= 1 - 0.7 * dt; g.x += g.vx * dt; g.y += g.vy * dt;
      let gone = g.x < -60 || g.x > VW + 60 || g.y > VH + 30;
      if (g.fade) { g.life -= dt; if (g.life <= 0) gone = true; }
      else if (g.vy > 0) for (const s of ORDER) {
        if (s === g.skip || !inX(s, g.x)) continue;
        const top = topAt(s, g.x);
        if (g.y >= top && (s === S.floor || g.y - g.vy * dt <= top + 12)) { if (!clearing) addSnow(s, g.x, g.area); gone = true; break; }
      }
      if (gone) grains.splice(i, 1);
    }
    if (clearing) {
      let left = 0;
      for (const s of ORDER) for (let i = 0; i < s.h.length; i++) { s.h[i] *= 1 - Math.min(1, 5 * dt); left = Math.max(left, s.h[i]); }
      if (left < 0.15) { for (const s of ORDER) s.h.fill(0); clearing = false; }
    }
    for (const s of ORDER) relax(s);

    // snowballs
    for (const b of balls) {
      if (b.dead || b.stuck) continue;
      const held = grab && grab.obj === b, px = b.x;
      if (held) { b.vx = clamp((ptr.x + grab.ox - b.x) * 20, -2400, 2400); b.vy = clamp((ptr.y + grab.oy - b.y) * 20, -2400, 2400); }
      else b.vy += G * dt;
      const wasOn = b.on;
      b.x += b.vx * dt; b.y += b.vy * dt; b.ground = false; b.on = null;
      let impact = hitWorld(b, b.r);
      for (const m of men) if (!m.dead) for (let i = 0; i < 3; i++) {       // a snowman is solid
        const dx = b.x - m.x, dy = b.y - (m.y - m.o[i]), d = Math.hypot(dx, dy), min = b.r + m.r[i];
        if (d < min && d > 0.01) { const nx = dx / d, ny = dy / d; b.x += nx * (min - d); b.y += ny * (min - d); const vn = b.vx * nx + b.vy * ny; if (vn < 0) { impact = Math.max(impact, -vn); b.vx -= vn * nx; b.vy -= vn * ny; } }
      }
      if (b.ground) { b.vx *= 1 - Math.min(1, 2.4 * dt); b.rot += (b.x - px) / b.r; }
      if (held && b.ground && b.on && b.r < MAX_R) {                           // rolling over snow — the ball grows
        const moved = Math.abs(b.x - px);
        if (moved > 0.15) { const got = takeSnow(S[b.on], b.x, b.r * 0.8 + 2, moved * 1.7); b.area += got * 0.55; b.r = Math.min(MAX_R, Math.sqrt(b.area)); }
      }
      if (b.safe > 0) b.safe -= dt;
      b.rest = (b.ground && Math.hypot(b.vx, b.vy) < 14 && !held) ? b.rest + dt : 0;
      if (!held && b.safe <= 0 && impact > SHATTER) { if (!b.on) b.on = wasOn; shatter(b); }
      if (b.pushed && b.x < -b.r - 20) b.dead = true;
    }
    // ball against ball; a ball set down on top of another one sticks to it
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const p = balls[i], q = balls[j];
      if (p.dead || q.dead || (p.stuck && q.stuck) || p.stuck === q || q.stuck === p) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = p.r + q.r;
      if (d >= min || d < 0.01) continue;
      const nx = dx / d, ny = dy / d, pen = min - d;
      const wp = p.stuck ? 0 : 1 / (p.area), wq = q.stuck ? 0 : 1 / (q.area), ws = wp + wq || 1;
      p.x -= nx * pen * wp / ws; p.y -= ny * pen * wp / ws; q.x += nx * pen * wq / ws; q.y += ny * pen * wq / ws;
      const rv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (rv < 0) { p.vx += nx * rv * wp / ws; p.vy += ny * rv * wp / ws; q.vx -= nx * rv * wq / ws; q.vy -= ny * rv * wq / ws; }
      const u = p.y < q.y ? p : q, l = u === p ? q : p;
      const heldU = grab && grab.obj === u, heldL = grab && grab.obj === l;
      if (!heldU && !heldL && !u.stuck && (l.ground || l.stuck) && Math.abs(u.x - l.x) < 0.6 * l.r && Math.abs(rv) < 520 && depth(l) < 2 && !chainTop(l) && !chainTop(u)) {
        u.stuck = l; u.off = clamp(u.x - l.x, -0.22 * l.r, 0.22 * l.r); u.vx = u.vy = 0; u.rest = 0;
      } else if (!heldU && !u.stuck && Math.abs(rv) > SHATTER && u.safe <= 0) shatter(u);
    }
    for (let pass = 0; pass < 2; pass++) for (const u of balls) {
      if (!u.stuck) continue;
      const l = u.stuck;
      if (l.dead) { u.stuck = null; continue; }
      u.x = l.x + u.off; u.y = l.y - (u.r + l.r) * 0.88; u.on = l.on; u.rest += dt * 0.5; u.vx = l.vx; u.vy = l.vy;
    }
    for (const a of balls) {                                                    // three in a stack → a snowman
      if (a.dead || a.stuck || a.rest < 0.2 || (grab && grab.obj === a)) continue;
      const b = chainTop(a), c = b && chainTop(b);
      if (b && c && c.rest > 0.2 && !(grab && (grab.obj === b || grab.obj === c))) { makeSnowman(a, b, c); break; }
    }

    // snowmen
    for (const m of men) {
      if (m.dead) continue;
      const held = grab && grab.obj === m, wasOn = m.on;
      if (held) { m.vx = clamp((ptr.x + grab.ox - m.x) * 18, -2200, 2200); m.vy = clamp((ptr.y + grab.oy - m.y) * 18, -2200, 2200); }
      else m.vy += G * dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.ground = false; m.on = null;
      let impact = hitWorld(m, m.r[0]);
      if (m.ground) m.vx *= 1 - Math.min(1, 6 * dt);
      if (m.safe > 0) m.safe -= dt;
      if (!held && m.safe <= 0 && impact > SMASH) { if (!m.on) m.on = wasOn; smash(m); }
      if (m.pushed && m.x < -m.r[0] - 30) m.dead = true;
    }
    for (let i = balls.length - 1; i >= 0; i--) if (balls[i].dead) { if (grab && grab.obj === balls[i]) release(); balls.splice(i, 1); }
    for (let i = men.length - 1; i >= 0; i--) if (men[i].dead) { if (grab && grab.obj === men[i]) release(); men.splice(i, 1); }

    // hat, carrot, scarf… of a broken snowman
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      if (!d.landed) {
        d.vy += G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
        let top = floorTop(clamp(d.x, 0, VW));
        for (const s of [S.win, S.dock]) if (inX(s, d.x) && d.y <= s.y + 14) top = Math.min(top, topAt(s, d.x) + 2);
        if (d.vy > 0 && d.y >= top) { d.y = top; d.landed = true; }
      } else d.life -= dt;
      if (d.life <= 0 || d.x < -40 || d.x > VW + 40) debris.splice(i, 1);
    }
    for (let i = puffs.length - 1; i >= 0; i--) { puffs[i].t += dt; if (puffs[i].t > 1.1) puffs.splice(i, 1); }

    if (crew) stepCrew(dt);
    if (plough) stepPlough(dt);
    if (!busy() && queued) { const q = queued; queued = null; act(q); }
  }

  // ---------- drawing ----------
  const SNOW = '#F2F7FF';
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const fill = c => { ctx.fillStyle = c; ctx.fill(); };
  const stroke = (c, w, cap) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = cap || 'butt'; ctx.lineJoin = 'round'; ctx.stroke(); };
  const circ = (x, y, r, c) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); fill(c); };
  const ell = (cx, cy, w, h, c) => { ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, 2 * PI); fill(c); };
  const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
  const shadow = on => { ctx.shadowColor = on ? 'rgba(20,40,90,.30)' : 'transparent'; ctx.shadowBlur = on ? 4 * k * dpr : 0; ctx.shadowOffsetY = on ? 2 * k * dpr : 0; };

  // a snowball: the light stays top-left, the specks turn with the ball. up = 1 when drawn in y-up space
  function drawBall(x, y, r, rot, up) {
    const s = up ? 1 : -1, g = ctx.createRadialGradient(x - r * 0.32, y + s * r * 0.36, r * 0.1, x, y, r);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.62, '#EEF4FD'); g.addColorStop(1, '#CFDDF2');
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); fill(g);
    ctx.strokeStyle = 'rgba(160,185,225,.55)'; ctx.lineWidth = Math.max(0.5, r * 0.035); ctx.stroke();
    if (rot !== undefined && r > 3) {
      ctx.fillStyle = 'rgba(175,198,230,.6)';
      for (let i = 0; i < 5; i++) { const a = rot * s + i * 1.37, d = r * (0.25 + 0.11 * i); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.5, r * 0.07), 0, 2 * PI); ctx.fill(); }
    }
  }

  function drawFloor() {
    const s = S.floor, n = s.h.length;
    ctx.beginPath(); ctx.moveTo(-2, VH + 4); ctx.lineTo(-2, s.y - s.h[0]);
    for (let i = 0; i < n - 1; i++) { const x = s.x0 + (i + 0.5) * s.cell, x2 = x + s.cell; ctx.quadraticCurveTo(x, s.y - s.h[i], (x + x2) / 2, s.y - (s.h[i] + s.h[i + 1]) / 2); }
    ctx.lineTo(VW + 2, s.y - s.h[n - 1]); ctx.lineTo(VW + 2, VH + 4); ctx.closePath();
    const g = ctx.createLinearGradient(0, s.y - 44, 0, VH); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#DCE7F8');
    shadow(true); fill(g); shadow(false);
  }
  // snow on the window / the Dock: lies on the top edge and drapes over the rounded corners
  function drawCap(s) {
    const n = s.h.length; let sum = 0;
    for (let i = 0; i < n; i++) sum += s.h[i];
    const avg = sum / n; if (avg < 0.3) return;
    const r = s.rad, y = s.y, x0 = s.x0, x1 = s.x1, m = Math.min(1, avg / 5), drape = r * m;
    const eff = i => { const x = (i + 0.5) * s.cell, e = Math.min(x, x1 - x0 - x); return s.h[i] * Math.min(1, 0.45 + 0.55 * e / (r * 1.6)); };
    const i0 = Math.ceil(r * 0.5 / s.cell), i1 = n - 1 - i0;
    const fx = x0 + (i0 + 0.5) * s.cell, fy = y - eff(i0), lx = x0 + (i1 + 0.5) * s.cell, ly = y - eff(i1);
    ctx.beginPath(); ctx.moveTo(x0 - 1.2 * m, y + drape);
    ctx.bezierCurveTo(x0 - 1.6 * m, y + drape * 0.35, x0 + r * 0.1, fy + 2 * m, fx, fy);
    for (let i = i0; i < i1; i++) { const x = x0 + (i + 0.5) * s.cell, x2 = x + s.cell; ctx.quadraticCurveTo(x, y - eff(i), (x + x2) / 2, y - (eff(i) + eff(i + 1)) / 2); }
    ctx.lineTo(lx, ly);
    ctx.bezierCurveTo(x1 - r * 0.1, ly + 2 * m, x1 + 1.6 * m, y + drape * 0.35, x1 + 1.2 * m, y + drape);
    const a0 = Math.asin(clamp((r - drape) / r, 0, 1));
    ctx.arc(x1 - r, y + r, r, -a0, -PI / 2, true); ctx.lineTo(x0 + r, y); ctx.arc(x0 + r, y + r, r, -PI / 2, -(PI - a0), true);
    ctx.closePath();
    shadow(true); fill(SNOW); shadow(false);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 0.8; ctx.stroke();
  }

  function drawGnome(g) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale((g.left ? 1 : -1) * GS, -GS); ctx.rotate(g.rot);
    for (const [x, y] of [[g.lx, g.ly], [g.rx, g.ry]]) {
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = rgb(0.35, 0.30, 0.28); ctx.fillRect(-1.4, 2, 2.8, 3); ell(-0.6, 1.6, 5.6, 3.2, rgb(0.30, 0.18, 0.11)); ctx.restore();
    }
    ctx.translate(0, g.ty); ctx.rotate(g.tr);
    ctx.beginPath(); ctx.moveTo(-5.6, 0); ctx.lineTo(5.6, 0); ctx.quadraticCurveTo(5.2, 7, 3.8, 10); ctx.lineTo(-3.8, 10); ctx.quadraticCurveTo(-5.2, 7, -5.6, 0); ctx.closePath(); fill(g.tunic);
    ctx.fillStyle = rgb(0.22, 0.14, 0.09); ctx.fillRect(-5.4, 2.4, 10.8, 1.6);
    rr(-1.5, 2.1, 3, 2.2, 0.4); fill(rgb(0.98, 0.80, 0.25));
    const fur = rgb(0.97, 0.96, 0.93);
    circ(-0.8, 12.4, 3.7, rgb(1.0, 0.83, 0.72)); circ(-1.0, 11.0, 1.1, rgb(1, 0.6, 0.62, 0.6)); circ(-2.7, 13.4, 0.55, rgb(0.1, 0.1, 0.1));
    for (const [x, y, r] of [[-2.6, 9.4, 2.9], [0.4, 9.0, 3.1], [-1.2, 7.0, 2.8], [-3.6, 7.6, 2.0], [1.6, 7.2, 2.2], [-1.0, 5.2, 2.0]]) circ(x, y, r, fur);
    circ(-4.0, 11.8, 1.9, rgb(0.96, 0.55, 0.50));
    ctx.beginPath(); ctx.moveTo(-5.2, 14.6); ctx.quadraticCurveTo(-3.2, 27, 5.5, 27.5); ctx.quadraticCurveTo(3.0, 21, 4.6, 14.6); ctx.closePath(); fill(rgb(0.86, 0.14, 0.18));
    rr(-5.8, 13.4, 11, 2.6, 1.3); fill(fur); circ(6.0, 27.4, 1.9, fur);
    ctx.translate(-1.6, 8.2); ctx.rotate(g.ar);
    if (g.shovel) { line(-1.5, 1.5, -11.5, -8); stroke(rgb(0.62, 0.42, 0.22), 1.3, 'round'); }
    line(0, 0, -4.2, -2.6); stroke(g.dark, 2.6, 'round');
    if (g.shovel) {
      ctx.beginPath(); ctx.moveTo(-10.5, -6.2); ctx.lineTo(-15.5, -8.6); ctx.lineTo(-13.6, -12.4); ctx.lineTo(-9.2, -9.6); ctx.closePath();
      fill(rgb(0.72, 0.76, 0.82)); stroke(rgb(0.45, 0.48, 0.55), 0.6);
    }
    circ(-4.8, -3.0, 1.6, g.mitten);
    ctx.restore();
  }
  function drawCart(c) {
    const wood = rgb(0.62, 0.40, 0.21), dark = rgb(0.44, 0.27, 0.13);
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(CS, -CS); ctx.rotate(c.rot);
    const hh = Math.min(26, Math.sqrt(Math.max(0, c.load)) * 0.32);
    if (hh >= 0.8) {
      ctx.beginPath(); ctx.moveTo(-20, 19); ctx.bezierCurveTo(-18, 19 + hh * 0.7, -11, 19 + hh, -4, 19 + hh);
      ctx.quadraticCurveTo(0, 19 + hh * 1.08, 5, 19 + hh * 0.92); ctx.bezierCurveTo(11, 19 + hh * 0.9, 17, 19 + hh * 0.5, 18, 19); ctx.closePath();
      fill(rgb(0.97, 0.97, 0.97)); stroke(rgb(0.82, 0.91, 1, 0.9), 1);
    }
    line(17, 17, 27, 23); stroke(dark, 2, 'round'); rr(25.5, 21.8, 4, 2.6, 1.2); fill(rgb(0.20, 0.20, 0.22));
    ctx.beginPath(); ctx.moveTo(-21, 21); ctx.lineTo(19, 21); ctx.lineTo(16.5, 8); ctx.lineTo(-18.5, 8); ctx.closePath(); fill(wood); stroke(dark, 1.2);
    ctx.beginPath(); for (const y of [12.5, 16.8]) { ctx.moveTo(-19.5, y); ctx.lineTo(18, y); } for (const x of [-8, 6]) { ctx.moveTo(x, 8.5); ctx.lineTo(x + 0.6, 20.5); } stroke(dark, 0.8);
    rr(-22, 20, 42, 2.2, 1); fill(rgb(0.55, 0.57, 0.62));
    for (const x of [-11, 10]) {
      ctx.save(); ctx.translate(x, 5.5); ctx.rotate(c.wheel);
      circ(0, 0, 5.5, rgb(0.25, 0.18, 0.12));
      ctx.beginPath(); for (let q = 0; q < 3; q++) { const a = q / 3 * PI; ctx.moveTo(Math.cos(a) * 4.2, Math.sin(a) * 4.2); ctx.lineTo(-Math.cos(a) * 4.2, -Math.sin(a) * 4.2); } stroke(wood, 1.1);
      circ(0, 0, 1.2, rgb(0.7, 0.7, 0.7)); ctx.restore();
    }
    ctx.restore();
  }
  function drawPlough(p) {
    const body = rgb(0.13, 0.62, 0.64), bodyDark = rgb(0.08, 0.42, 0.45), metal = rgb(0.30, 0.32, 0.36), tire = rgb(0.13, 0.13, 0.15), glassC = rgb(0.72, 0.90, 1.0);
    for (const s of puffs) { const u = s.t / 1.1, d = s.d * (1 + 1.6 * u); ctx.globalAlpha = 0.5 * (1 - u); circ(s.x + 14 * PS * u, s.y - 26 * PS * u, d / 2, rgb(0.75, 0.75, 0.75)); ctx.globalAlpha = 1; }
    ctx.save(); ctx.translate(p.x, floorTop(p.x)); ctx.scale(PS, -PS);
    rr(29, 28, 4, 18, 1.5); fill(metal); rr(28, 45, 6, 3, 1); fill(tire);
    ctx.beginPath(); ctx.moveTo(-14, 28); ctx.lineTo(-14, 40); ctx.quadraticCurveTo(-13, 55, 0, 56); ctx.lineTo(22, 56); ctx.quadraticCurveTo(27, 56, 27, 51); ctx.lineTo(27, 28); ctx.closePath(); fill(body);
    rr(-32, 12, 66, 19, 6); fill(body); rr(-32, 12, 66, 5, 2.5); fill(bodyDark);
    ctx.beginPath(); for (let q = 0; q < 3; q++) { const x = -30 + q * 4; ctx.moveTo(x, 19); ctx.lineTo(x + 3, 28); } stroke(rgb(1.0, 0.85, 0.3), 1.6, 'round');
    ctx.beginPath(); ctx.moveTo(-9, 33); ctx.lineTo(-9, 40); ctx.quadraticCurveTo(-8.5, 50.5, 1, 51); ctx.lineTo(14, 51); ctx.lineTo(14, 33); ctx.closePath(); fill(glassC);
    rr(17, 38, 7, 10, 2); fill(glassC);
    ctx.beginPath(); ctx.moveTo(-5, 36); ctx.lineTo(4, 49); ctx.moveTo(0, 35); ctx.lineTo(7, 45); stroke('rgba(255,255,255,.65)', 1.6, 'round');
    ctx.beginPath(); ctx.moveTo(-3, 55); ctx.bezierCurveTo(0, 61, 8, 61, 14, 60); ctx.bezierCurveTo(20, 60, 26, 59, 26, 54); ctx.closePath(); fill(rgb(0.98, 0.98, 0.98)); stroke(rgb(0.8, 0.9, 1), 0.8);
    const flash = (Math.sin(p.phase * 7) + 1) / 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash; ctx.translate(19, 60); ctx.scale(0.8 + 0.5 * flash, 0.8 + 0.5 * flash); ell(0, 0, 10, 8, rgb(1.0, 0.55, 0.1, 0.45)); ctx.restore();
    ctx.globalAlpha = 0.55 + 0.45 * flash; rr(16, 58, 6, 4, 2); fill(rgb(1.0, 0.62, 0.12)); ctx.globalAlpha = 1;
    for (const x of [-15, 21]) {
      ctx.save(); ctx.translate(x, 10); ctx.rotate(p.wheel);
      circ(0, 0, 10, tire); circ(0, 0, 5.5, rgb(0.82, 0.82, 0.82)); ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 2 * PI); stroke(rgb(0.6, 0.6, 0.6), 0.8);
      for (let q = 0; q < 5; q++) { const a = q / 5 * 2 * PI; circ(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 0.9, metal); }
      ctx.beginPath(); for (let q = 0; q < 8; q++) { const a = q / 8 * 2 * PI; ctx.moveTo(Math.cos(a) * 7.6, Math.sin(a) * 7.6); ctx.lineTo(Math.cos(a) * 9.6, Math.sin(a) * 9.6); } stroke(rgb(0.32, 0.32, 0.32), 1.4);
      ctx.restore();
    }
    const chute = () => { ctx.beginPath(); ctx.moveTo(-36, 26); ctx.bezierCurveTo(-36, 44, -42, 54, -53, 52); };
    chute(); stroke(bodyDark, 7, 'round'); chute(); stroke(body, 4.2, 'round');
    line(-50, 56, -58, 53); stroke(metal, 2.2, 'round');
    ctx.beginPath(); ctx.moveTo(-30, 1); ctx.lineTo(-30, 27); ctx.lineTo(-40, 27); ctx.quadraticCurveTo(-48, 27, -48, 19); ctx.lineTo(-48, 1); ctx.closePath(); fill(metal);
    circ(-38, 11, 8, tire);
    ctx.save(); ctx.translate(-38, 11); ctx.rotate(p.auger); ctx.beginPath();
    for (let q = 0; q < 2; q++) { const a = q * PI; ctx.moveTo(0, 0); ctx.bezierCurveTo(Math.cos(a) * 6, Math.sin(a) * 6, Math.cos(a + 1.4) * 8, Math.sin(a + 1.4) * 8, Math.cos(a + 2.4) * 7, Math.sin(a + 2.4) * 7); }
    stroke(rgb(1.0, 0.78, 0.25), 2, 'round'); ctx.restore();
    rr(-49, 0, 20, 2.5, 1); fill(rgb(0.85, 0.85, 0.85));
    const h = p.moundH;
    if (h >= 1) {
      const w = h * 1.7 + 6, x0 = -48;
      ctx.beginPath(); ctx.moveTo(x0 + 1, 0); ctx.lineTo(x0 + 1, h * 0.85); ctx.quadraticCurveTo(x0 - h * 0.02, h * 1.02, x0 - h * 0.18, h);
      ctx.bezierCurveTo(x0 - h * 0.45, h * 0.9, x0 - w * 0.7, h * 0.12, x0 - w, 0); ctx.closePath(); fill(rgb(0.97, 0.97, 0.97)); stroke(rgb(0.82, 0.91, 1, 0.9), 1);
    }
    ctx.restore();
  }

  // parts of the snowman (SnowmanArt in the app), all in y-up space
  const COAL = rgb(0.16, 0.15, 0.17), WOOD = rgb(0.40, 0.27, 0.17), HAT = rgb(0.20, 0.38, 0.80), HAT2 = rgb(0.42, 0.62, 0.95), SCARF = rgb(0.10, 0.60, 0.55), STRIPE = rgb(0.96, 0.94, 0.86);
  const ART = {
    hat(rt) {
      const w = rt * 0.98;
      const dome = () => { ctx.beginPath(); ctx.moveTo(-w * 0.92, rt * 0.08); ctx.bezierCurveTo(-w * 0.95, rt * 0.65, -w * 0.45, rt * 0.95, 0, rt * 0.95); ctx.bezierCurveTo(w * 0.45, rt * 0.95, w * 0.95, rt * 0.65, w * 0.92, rt * 0.08); ctx.closePath(); };
      dome(); fill(HAT);
      ctx.save(); dome(); ctx.clip(); ctx.fillStyle = HAT2; ctx.fillRect(-w * 0.88, rt * 0.38, w * 1.76, rt * 0.16); ctx.restore();
      rr(-w, -rt * 0.14, w * 2, rt * 0.3, rt * 0.12); fill(HAT2);
      ctx.beginPath(); for (let x = -w + rt * 0.14; x < w - rt * 0.08; x += rt * 0.17) { ctx.moveTo(x, -rt * 0.1); ctx.lineTo(x, rt * 0.12); } stroke(rgb(0.20, 0.38, 0.80, 0.45), Math.max(0.6, rt * 0.04));
      drawBall(rt * 0.05, rt * 1.0, rt * 0.275, undefined, true);
    },
    wrap(rt) { rr(-rt * 0.92, -rt * 0.18, rt * 1.84, rt * 0.36, rt * 0.17); fill(SCARF); ctx.fillStyle = STRIPE; for (let q = 0; q < 3; q++) ctx.fillRect(-rt * 0.55 + q * rt * 0.5, -rt * 0.18, rt * 0.12, rt * 0.36); },
    tail(rt) {
      const w = rt * 0.34, h = rt * 0.78;
      rr(-w / 2, -h, w, h, rt * 0.06); fill(SCARF); ctx.fillStyle = STRIPE; for (let q = 0; q < 2; q++) ctx.fillRect(-w / 2, -h * (0.45 + q * 0.25), w, rt * 0.09);
      ctx.beginPath(); for (let q = 0; q < 4; q++) { const fx = -w / 2 + w * (q + 0.5) / 4; ctx.moveTo(fx, -h); ctx.lineTo(fx + rt * 0.02, -h - rt * 0.16); } stroke(SCARF, Math.max(0.7, rt * 0.05), 'round');
    },
    nose(rt) {
      ctx.beginPath(); ctx.moveTo(0, rt * 0.1); ctx.quadraticCurveTo(rt * 0.25, rt * 0.08, rt * 0.48, -rt * 0.05); ctx.quadraticCurveTo(rt * 0.22, -rt * 0.1, 0, -rt * 0.1); ctx.closePath(); fill(rgb(0.97, 0.52, 0.16));
      ctx.beginPath(); ctx.moveTo(rt * 0.14, rt * 0.06); ctx.lineTo(rt * 0.17, -rt * 0.04); ctx.moveTo(rt * 0.28, rt * 0.03); ctx.lineTo(rt * 0.3, -rt * 0.05); stroke(rgb(0.78, 0.36, 0.10), Math.max(0.5, rt * 0.035));
    },
    eye(rt) { ell(0, 0, rt * 0.15, rt * 0.2, COAL); circ(rt * 0.025, rt * 0.04, Math.max(0.4, rt * 0.03), '#fff'); },
    cheek(rt) { ell(0, 0, rt * 0.28, rt * 0.16, rgb(1.0, 0.55, 0.62, 0.45)); },
    mouth(rt) { ctx.beginPath(); ctx.arc(0, 0, rt * 0.28, PI * 1.2, PI * 1.8); stroke(COAL, Math.max(0.8, rt * 0.06), 'round'); },
    peb(r, seed) { ctx.beginPath(); for (let q = 0; q < 7; q++) { const a = q / 7 * 2 * PI, wob = 1 + 0.18 * Math.sin((seed * 3 + q) * 1.7), x = Math.cos(a) * r * wob * 1.1, y = Math.sin(a) * r * wob * 0.9; q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); fill(COAL); },
    arm(rm, side) {
      const len = rm * 1.15, tx = side * len, ty = len * 0.55, mx = side * len * 0.52, my = len * 0.25;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(side * len * 0.5, len * 0.18, tx, ty);
      ctx.moveTo(tx, ty); ctx.lineTo(tx + side * rm * 0.22, ty + rm * 0.05); ctx.moveTo(tx, ty); ctx.lineTo(tx + side * rm * 0.08, ty + rm * 0.24);
      ctx.moveTo(mx, my); ctx.lineTo(mx + side * rm * 0.05, my - rm * 0.2); stroke(WOOD, Math.max(1.3, rm * 0.09), 'round');
    }
  };
  function drawMan(m) {
    const [r0, rm, rt] = m.r, ym = m.o[1], yt = m.o[2];
    const put = (fn, x, y, rot) => { ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); fn(); ctx.restore(); };
    ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, -1);
    for (const sd of [-1, 1]) put(() => ART.arm(rm, sd), sd * rm * 0.78, ym + rm * 0.18);
    shadow(true); drawBall(0, 0, r0, undefined, true); shadow(false); drawBall(0, ym, rm, undefined, true); drawBall(0, yt, rt, undefined, true);
    for (let q = 0; q < 3; q++) put(() => ART.peb(Math.max(1.1, rm * 0.085), q), rm * 0.02 * (q - 1), ym + rm * (0.22 - q * 0.34));
    put(() => ART.tail(rt), -rt * 0.42, yt - rt * 0.82, -0.12);
    for (const sd of [-1, 1]) put(() => ART.cheek(rt), sd * rt * 0.52, yt - rt * 0.12);
    put(() => ART.wrap(rt), 0, yt - rt * 0.82);
    for (const sd of [-1, 1]) put(() => ART.eye(rt), sd * rt * 0.3, yt + rt * 0.2);
    put(() => ART.mouth(rt), 0, yt + rt * 0.12); put(() => ART.nose(rt), -rt * 0.02, yt); put(() => ART.hat(rt), 0, yt + rt * 0.42);
    ctx.restore();
  }
  function drawDebris(d) {
    ctx.save(); ctx.translate(d.x, d.y); ctx.scale(1, -1); ctx.rotate(d.rot); ctx.globalAlpha = clamp(d.life / 0.6, 0, 1);
    const kd = d.kind;
    if (kd === 'hat') ART.hat(d.rt); else if (kd === 'nose') ART.nose(d.rt); else if (kd === 'wrap') ART.wrap(d.rt); else if (kd === 'tail') ART.tail(d.rt);
    else if (kd === 'eye') ART.eye(d.rt); else if (kd === 'armL') ART.arm(d.rm, -1); else if (kd === 'armR') ART.arm(d.rm, 1); else ART.peb(Math.max(1.1, d.rm * 0.085), +kd.slice(3));
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    ctx.clearRect(0, 0, VW, VH + 2);
    if (effect !== 0) { drawFx(); return; }
    ctx.fillStyle = '#fff';
    for (const f of flakes) { ctx.globalAlpha = f.a; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 2 * PI); ctx.fill(); }
    ctx.globalAlpha = 1;
    drawCap(S.win); drawCap(S.dock); drawFloor();
    if (crew) {
      drawCart(crew.cart);
      if (crew.rope) { ctx.beginPath(); crew.rope.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); stroke(rgb(0.80, 0.68, 0.45), 1.3, 'round'); }
      for (const g of crew.g) drawGnome(g);
      for (const l of crew.lumps) drawBall(l.x, l.y, clamp(Math.sqrt(l.area) * 0.55, 2, 4.5));
    }
    if (plough) drawPlough(plough);
    for (const m of men) drawMan(m);
    for (const b of balls) { shadow(true); drawBall(b.x, b.y, b.r, b.rot); shadow(false); }
    for (const g of grains) { ctx.globalAlpha = g.fade ? clamp(g.life * 1.6, 0, 1) : 1; ctx.fillStyle = '#F7FAFF'; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 2 * PI); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const d of debris) drawDebris(d);
  }

  // on touch screens there is no cursor and no right click
  if (window.matchMedia('(hover: none)').matches) {
    const hint = document.querySelector('.play__hint');
    if (hint) hint.innerHTML = '<b>This desktop is live — play with it.</b> Switch effects in the Glimmer panel. Drag the window and flick it. Touch the snow and drag to roll a snowball — stack three and you get a snowman. Double-tap to smash.';
  }

  // ---------- layout, loop ----------
  let seeded = false;
  function resize() {
    rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    k = rect.width / VW; VH = rect.height / k;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const box = el => { const r = el.getBoundingClientRect(); return [(r.left - rect.left) / k, (r.right - rect.left) / k, (r.top - rect.top) / k, (r.bottom - rect.top) / k]; };
    const w = box(winEl), d = box(dockEl);
    layout(S.win, w[0], w[1], w[2], w[3]); layout(S.dock, d[0], d[1], d[2], d[3]); layout(S.floor, 0, VW, VH, VH + 40);
    S.win.rad = parseFloat(getComputedStyle(winEl).borderTopLeftRadius) / k || 12;
    S.dock.rad = parseFloat(getComputedStyle(dockEl).borderTopLeftRadius) / k || 16;
    prevWin = null;
    const want = k < 0.5 ? 90 : 150;
    while (flakes.length < want) flakes.push(newFlake(true));
    flakes.length = want;
    if (!seeded) {
      seeded = true;
      seed(S.win, 14, 3.5); seed(S.dock, 15, 3); seed(S.floor, 24, 5);
      for (const s of ORDER) for (let i = 0; i < 6; i++) relax(s);
      // what the app can do, right from the first frame: a snowman on the window and a couple of snowballs
      const mx = S.win.x0 + (S.win.x1 - S.win.x0) * 0.2, r = [19, 14.5, 10.5], o1 = (r[0] + r[1]) * 0.88;
      men.push({ x: mx, y: S.win.y - hAt(S.win, mx) * 0.55 - r[0], vx: 0, vy: 0, r, o: [0, o1, o1 + (r[1] + r[2]) * 0.88], safe: 0.6, on: 'win', ground: true, dead: false, pushed: false });
      const bx = S.win.x0 + (S.win.x1 - S.win.x0) * 0.78;
      newBall(bx, S.win.y - hAt(S.win, bx) * 0.55 - 9, 9).on = 'win';
      newBall(VW - 58, floorTop(VW - 58) - 12, 12).on = 'floor';
    }
    draw();
  }

  let running = false, visible = true, last = 0, seen = 0, calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const auto = { gnomes: false, plough: false };
  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.033, (t - last) / 1000 || 0.016);
    last = t;
    if (dt > 0) {
      frameStart(dt);
      const sub = (grab || balls.length > 2) ? 2 : 1;
      for (let i = 0; i < sub; i++) step(dt / sub);
      seen += dt;
      // nobody is playing — show the helpers on our own, once each
      if (effect === 0 && !busy() && clock - lastTouch > 6) {
        if (!auto.gnomes && seen > 5) { auto.gnomes = true; act('gnomes'); }
        else if (auto.gnomes && !auto.plough && clock - helperEnd > 9 && clock - lastTouch > 9) { auto.plough = true; act('plough'); }
      }
      draw();
    }
    requestAnimationFrame(frame);
  }
  function wake(user) { if (user) calm = false; if (!calm && !running && visible && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(frame); } }
  function sleep() { running = false; }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? wake() : sleep(); }, { threshold: 0.05 }).observe(canvas);
  // local testing only: http://localhost…/?demo=gnomes&ff=12 runs an action and fast-forwards the simulation
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const ff = sec => { for (let i = 0; i < sec * 60; i++) { frameStart(1 / 60); step(1 / 60); } draw(); };
    window.__desk = { act, ff, setEffect, get effect() { return effect; }, petals, flies, drops, meteors, S, balls, men, grains, ptr, get crew() { return crew; }, get plough() { return plough; }, set grab(g) { grab = g; }, pick, release, hitAt };
    const q = new URLSearchParams(location.search);
    if (q.get('demo') || q.get('ff')) {
      auto.gnomes = auto.plough = true; calm = true;
      if (q.get('fx')) setEffect(+q.get('fx'));
      (q.get('demo') || '').split(',').filter(Boolean).forEach(d => act(d));
      ff(parseFloat(q.get('pre') || '0'));
      (q.get('then') || '').split(',').filter(Boolean).forEach(d => act(d));
      ff(parseFloat(q.get('ff') || '0'));
      return;
    }
  }
  if (calm) { auto.gnomes = auto.plough = true; draw(); }   // starts on the first touch
  else wake();
})();
