// Glimmer site: mobile menu + gentle falling snow (page background and inside the Mac mockup)
(function () {
  // Проверка на своём компьютере: на localhost кнопки скачивания берут локальную копию установщика
  // (папка downloads/ не публикуется), на опубликованном сайте — файл из GitHub Releases
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    document.querySelectorAll('[data-download]').forEach(a => { a.href = 'downloads/Glimmer.dmg'; a.setAttribute('download', 'Glimmer.dmg'); });
  }

  // картинки и видео: без контекстного меню «Сохранить как…» и без перетаскивания в Finder
  document.addEventListener('contextmenu', e => { if (e.target.closest('img, video, .mac, .panel__stage, .effect')) e.preventDefault(); });
  document.addEventListener('dragstart', e => { if (e.target.closest('img, video')) e.preventDefault(); });

  // mobile menu
  const nav = document.querySelector('.nav');
  const toggle = document.getElementById('nav-toggle');
  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.querySelectorAll('.nav__links a').forEach(a => a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Snow caps: the snow lies on the top edge and drapes down over the rounded corners,
  // following their curve (instead of a flat slab sticking out past the corners).
  const SVG = 'http://www.w3.org/2000/svg';
  function snowcap(el) {
    const w = el.clientWidth;
    if (!w) return;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 4);
    const k = parseFloat(el.dataset.snowcap) || 1;
    const t = Math.max(6, Math.min(34, w * 0.04)) * k;   // snow thickness above the edge
    const drape = Math.max(r, t * 0.6);                    // how far it hangs down at the corners
    const H = t + drape;
    let seed = (el.dataset.seed = el.dataset.seed || String(Math.floor(Math.random() * 1e6))) * 1;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

    // top contour: soft lumps from corner to corner
    const n = Math.max(6, Math.round(w / 55));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = r * 0.55 + (w - r * 1.1) * (i / n);
      const edge = Math.sin(Math.PI * i / n);              // thinner near the corners
      pts.push([x, t - t * (0.55 + 0.45 * edge) * (0.82 + rnd() * 0.3)]);
    }
    let d = `M ${-1.2} ${t + drape} `;
    // left shoulder: curves from the side up onto the top
    d += `C ${-1.6} ${t + drape * 0.35}, ${r * 0.1} ${pts[0][1] + t * 0.15}, ${pts[0][0]} ${pts[0][1]} `;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
      d += `Q ${mx} ${Math.min(y0, y1) - t * 0.18 * rnd()}, ${x1} ${y1} `;
    }
    const [lx, ly] = pts[pts.length - 1];
    d += `C ${w - r * 0.1} ${ly + t * 0.15}, ${w + 1.6} ${t + drape * 0.35}, ${w + 1.2} ${t + drape} `;
    // bottom contour = the element's own top edge with its rounded corners
    d += `L ${w} ${t + r} A ${r} ${r} 0 0 0 ${w - r} ${t} L ${r} ${t} A ${r} ${r} 0 0 0 0 ${t + r} `;
    if (drape > r) d += `L 0 ${t + drape} `;
    d += 'Z';

    let svg = el.querySelector(':scope > svg.snowcap');
    if (!svg) {
      svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'snowcap');
      svg.setAttribute('aria-hidden', 'true');
      svg.appendChild(document.createElementNS(SVG, 'path'));
      el.appendChild(svg);
    }
    svg.setAttribute('viewBox', `-3 0 ${w + 6} ${H}`);
    svg.setAttribute('width', w + 6);
    svg.setAttribute('height', H);
    svg.style.left = '-3px';
    svg.style.top = `${-t - parseFloat(getComputedStyle(el).borderTopWidth || 0)}px`;
    svg.firstChild.setAttribute('d', d);
  }
  const caps = document.querySelectorAll('[data-snowcap]');
  const drawCaps = () => caps.forEach(snowcap);
  drawCaps();
  window.addEventListener('resize', drawCaps);
  window.addEventListener('load', drawCaps);

  function snowfall(canvas, opts) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, flakes = [], dpr = 1, running = true;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((w * h) / opts.area);
      flakes = Array.from({ length: Math.min(target, opts.max) }, () => make(true));
    }
    function make(anywhere) {
      const z = Math.random();
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -10,
        r: opts.size[0] + z * (opts.size[1] - opts.size[0]),
        vy: opts.speed[0] + z * (opts.speed[1] - opts.speed[0]),
        sway: Math.random() * Math.PI * 2,
        a: 0.35 + z * 0.6
      };
    }
    function draw() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.vy; f.sway += 0.012; f.x += Math.sin(f.sway) * 0.35;
        if (f.y > h + 10) Object.assign(f, make(false));
        ctx.globalAlpha = f.a;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    // pause when off-screen to save battery
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => {
        const was = running; running = e.isIntersecting;
        if (running && !was) draw();
      }).observe(canvas);
    }
    if (reduced) { draw(); running = false; } else draw();
  }

  const page = document.getElementById('sky-snow');
  if (page) snowfall(page, { area: 9000, max: 160, size: [0.6, 2.2], speed: [0.25, 0.9] });
  const mock = document.querySelector('.mac__snow');
  if (mock) snowfall(mock, { area: 2600, max: 260, size: [0.6, 2.4], speed: [0.35, 1.2] });
})();
