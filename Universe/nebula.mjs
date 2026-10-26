// Animated nebula and data constellation behind the dashboard (canvas 2D, no libraries).
// The clouds render on a small canvas and are scaled up, which keeps each frame cheap on weak GPUs.
// With motion off (or "reduce motion" set in the system) it draws one still frame.

const FPS = 24;

const PALETTE = {
  dark: {
    base: ['#0b1022', '#04060d'], additive: true,
    clouds: [[124, 58, 237, .34], [217, 70, 239, .22], [20, 184, 166, .24], [59, 130, 246, .26], [16, 185, 129, .12], [236, 72, 153, .16]],
    star: '226,232,255', starA: .85, nodes: ['167,139,250', '45,212,191', '244,114,182', '125,180,255'], line: '167,139,250', lineA: .3
  },
  light: {
    base: ['#f7f5ef', '#eeebf4'], additive: false,
    clouds: [[167, 139, 250, .5], [244, 114, 182, .34], [45, 212, 191, .4], [125, 180, 255, .42], [250, 204, 21, .16], [196, 181, 253, .4]],
    star: '88,64,140', starA: .45, nodes: ['124,58,237', '13,148,136', '190,24,93', '37,99,235'], line: '124,58,237', lineA: .22
  }
};

// Anchor (0-1), size (share of the short side), drift speeds (rad/s), phase, palette index.
const CLOUDS = [
  { ax: .12, ay: .18, r: .62, sx: .052, sy: .041, ph: 0, c: 0 },
  { ax: .88, ay: .12, r: .55, sx: .038, sy: .057, ph: 1.7, c: 1 },
  { ax: .70, ay: .78, r: .66, sx: .047, sy: .035, ph: 3.1, c: 2 },
  { ax: .20, ay: .85, r: .52, sx: .06, sy: .049, ph: 4.4, c: 3 },
  { ax: .50, ay: .45, r: .45, sx: .031, sy: .044, ph: 5.2, c: 4 },
  { ax: .95, ay: .55, r: .4, sx: .055, sy: .03, ph: 2.4, c: 5 }
];

const seeded = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function startNebula(canvas, { theme = 'dark', motion = true } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cloud = document.createElement('canvas'), cctx = cloud.getContext('2d');
  const rnd = seeded(2026);
  let W = 1, H = 1, dpr = 1, raf = 0, last = 0, stars = [], nodes = [], pulses = [];
  const t0 = performance.now();

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    cloud.width = Math.max(64, Math.round(W / 5)); cloud.height = Math.max(64, Math.round(H / 5));
    const area = W * H;
    stars = Array.from({ length: Math.min(220, Math.round(area / 9000)) }, () => ({ x: rnd(), y: rnd(), s: .5 + rnd() * 1.1, p: rnd() * 6.28, f: .5 + rnd() * 1.5, d: .003 + rnd() * .01 }));
    nodes = Array.from({ length: Math.min(70, Math.max(24, Math.round(area / 30000))) }, () => ({ x: rnd() * W, y: rnd() * H, vx: (rnd() - .5) * 12, vy: (rnd() - .5) * 12, c: Math.floor(rnd() * 4), r: 1 + rnd() * 1.4 }));
    pulses = [];
  }

  function draw(t, dt) {
    const P = PALETTE[theme];
    // nebula clouds on the small canvas
    const cw = cloud.width, ch = cloud.height, m = Math.min(cw, ch);
    const base = cctx.createLinearGradient(0, 0, cw, ch);
    base.addColorStop(0, P.base[0]); base.addColorStop(1, P.base[1]);
    cctx.globalCompositeOperation = 'source-over'; cctx.fillStyle = base; cctx.fillRect(0, 0, cw, ch);
    cctx.globalCompositeOperation = P.additive ? 'lighter' : 'source-over';
    for (const c of CLOUDS) {
      const x = (c.ax + .14 * Math.sin(t * c.sx + c.ph)) * cw, y = (c.ay + .12 * Math.cos(t * c.sy + c.ph * 1.3)) * ch;
      const r = c.r * m * (1 + .08 * Math.sin(t * .11 + c.ph));
      const [R, G, B, A] = P.clouds[c.c];
      const g = cctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${R},${G},${B},${A})`); g.addColorStop(.55, `rgba(${R},${G},${B},${(A * .38).toFixed(3)})`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      cctx.fillStyle = g; cctx.fillRect(0, 0, cw, ch);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cloud, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // stars
    for (const s of stars) {
      const y = (((s.y - t * s.d) % 1) + 1) % 1;
      ctx.fillStyle = `rgba(${P.star},${(P.starA * (.55 + .45 * Math.sin(t * s.f + s.p))).toFixed(3)})`;
      ctx.fillRect(s.x * W, y * H, s.s, s.s);
    }

    // data constellation: drifting nodes joined when close
    if (dt) for (const n of nodes) {
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
    }
    const L = Math.min(150, Math.max(90, W / 9)), L2 = L * L;
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 >= L2) continue;
        ctx.strokeStyle = `rgba(${P.line},${((1 - Math.sqrt(d2) / L) * P.lineA).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (const n of nodes) {
      const col = P.nodes[n.c];
      ctx.fillStyle = `rgba(${col},.16)`; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${col},.9)`; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill();
    }

    // a bright pulse now and then travels along a link, like a data point moving through the network
    if (dt) {
      if (pulses.length < 4 && rnd() < dt * .9) {
        const i = Math.floor(rnd() * nodes.length), a = nodes[i];
        for (let k = 1; k < nodes.length; k++) {
          const j = (i + k) % nodes.length, b = nodes[j];
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < L2) { pulses.push({ i, j, k: 0, v: .35 + rnd() * .4 }); break; }
        }
      }
      pulses = pulses.filter((p) => (p.k += dt * p.v) < 1);
    }
    for (const p of pulses) {
      const a = nodes[p.i], b = nodes[p.j], x = a.x + (b.x - a.x) * p.k, y = a.y + (b.y - a.y) * p.k;
      ctx.fillStyle = `rgba(${P.nodes[1]},.25)`; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
      ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,.95)' : `rgba(${P.nodes[0]},.95)`; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.283); ctx.fill();
    }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 2) return;
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    draw((now - t0) / 1000, dt);
  }

  function run() {
    cancelAnimationFrame(raf);
    if (motion) { last = performance.now(); raf = requestAnimationFrame(tick); } else draw(20, 0);
  }

  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { layout(); run(); }, 150); });
  layout(); run();

  return {
    setTheme(t) { theme = t; if (!motion) draw(20, 0); },
    setMotion(on) { motion = on; run(); }
  };
}
