// Glimmer site: mobile menu + gentle falling snow (page background and inside the Mac mockup)
(function () {
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
