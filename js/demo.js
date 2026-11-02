import { clamp, hash, rng, roundRect } from './util.js';

/* ---------- clips de ejemplo (generados) ---------- */
export const crowd = (() => {
  const r = rng(7),
    a = [];
  const cols = ['#c94b4b', '#e8d36a', '#5a7fd6', '#e9e9ef', '#3fae78', '#d77a3b'];
  for (let i = 0; i < 260; i++) a.push({ x: r() * 1400, y: r(), c: cols[Math.floor(r() * cols.length)] });
  return a;
})();
// Balón que rebota dentro del cuadro (piso en y=430, siempre visible)
export function ballPos(t) {
  return { x: (170 + t * 120) / 960, y: (430 - Math.abs(Math.sin(t * 1.3)) * 230) / 540 };
}
export function drawField(g, t, w, h) {
  const pan = t * 36;
  g.fillStyle = '#1a2030';
  g.fillRect(0, 0, w, 72);
  for (const d of crowd) {
    const x = ((((d.x - pan * 0.6) % 1400) + 1400) % 1400) - 200;
    g.fillStyle = d.c;
    g.fillRect(x, 6 + d.y * 50, 6, 7);
  }
  g.fillStyle = '#0d1220';
  g.fillRect(0, 60, w, 12);
  for (let i = -2; i < 16; i++) {
    const x = i * 80 - (pan % 160);
    g.fillStyle = i & 1 ? '#2d8744' : '#33954b';
    g.fillRect(x, 72, 80, h - 72);
  }
  g.strokeStyle = 'rgba(255,255,255,.85)';
  g.lineWidth = 4;
  const cx = 540 - pan;
  g.beginPath();
  g.moveTo(0, 92);
  g.lineTo(w, 92);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, 92);
  g.lineTo(cx, h);
  g.stroke();
  g.beginPath();
  g.arc(cx, 330, 95, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(1060 - pan, 180, 300, 320);
  const p = ballPos(t),
    x = p.x * w,
    y = p.y * h,
    gy = 454,
    lift = clamp((gy - 22 - y) / 230, 0, 1);
  g.fillStyle = 'rgba(0,0,0,' + (0.35 - lift * 0.2) + ')';
  g.beginPath();
  g.ellipse(x + 6, gy, 26 - lift * 8, 7 - lift * 2, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.arc(0, 0, 22, 0, Math.PI * 2);
  g.fillStyle = '#f4f3ee';
  g.fill();
  g.clip();
  g.rotate(t * 5);
  g.fillStyle = '#17191e';
  const pent = (cx, cy, r) => {
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  };
  pent(0, 0, 8);
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
    pent(Math.cos(a) * 19, Math.sin(a) * 19, 6);
  }
  g.restore();
  g.beginPath();
  g.arc(x, y, 22, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,.45)';
  g.lineWidth = 2;
  g.stroke();
}
export const city = (() => {
  const r = rng(42);
  return [0, 1, 2].map(l => {
    const a = [];
    let x = -100;
    while (x < 2400) {
      const w = 50 + r() * 90;
      a.push({ x, w, h: [120, 170, 230][l] * (0.5 + r() * 0.8), win: r() });
      x += w + r() * 14;
    }
    return a;
  });
})();
export function drawStreet(g, t, w, h) {
  const sky = g.createLinearGradient(0, 0, 0, 360);
  sky.addColorStop(0, '#24193f');
  sky.addColorStop(0.6, '#7b3c62');
  sky.addColorStop(1, '#e88752');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(690, 300, 10, 690, 300, 150);
  sun.addColorStop(0, 'rgba(255,214,140,1)');
  sun.addColorStop(0.35, 'rgba(255,190,120,.6)');
  sun.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = sun;
  g.fillRect(500, 120, 380, 260);
  const cols = ['#5a3561', '#3a2350', '#1d1530'],
    sp = [10, 26, 58];
  city.forEach((layer, l) => {
    g.fillStyle = cols[l];
    for (const b of layer) {
      const x = b.x - t * sp[l];
      if (x > w || x + b.w < 0) continue;
      g.fillRect(x, 410 - b.h, b.w, b.h);
      if (l === 2) {
        g.fillStyle = '#ffd27a';
        for (let yy = 410 - b.h + 12; yy < 396; yy += 18)
          for (let xx = x + 8; xx < x + b.w - 10; xx += 14) {
            if (hash(Math.floor(xx * 3 + yy * 7 + b.win * 99)) > 0.55) g.fillRect(xx, yy, 6, 8);
          }
        g.fillStyle = cols[l];
      }
    }
  });
  g.fillStyle = '#14111b';
  g.fillRect(0, 410, w, h - 410);
  g.fillStyle = '#d9c27a';
  for (let i = -1; i < 10; i++) {
    const x = i * 140 - ((t * 240) % 140);
    g.fillRect(x, 470, 70, 6);
  }
  const carX = -200 + t * 320;
  g.fillStyle = 'rgba(255,230,160,.18)';
  g.beginPath();
  g.moveTo(carX + 180, 440);
  g.lineTo(carX + 420, 410);
  g.lineTo(carX + 420, 470);
  g.closePath();
  g.fill();
  g.fillStyle = '#c8433a';
  roundRect(g, carX, 420, 190, 44, 10);
  g.fill();
  g.fillStyle = '#a93630';
  roundRect(g, carX + 38, 394, 104, 34, 12);
  g.fill();
  g.fillStyle = '#9cc4de';
  g.fillRect(carX + 50, 400, 36, 20);
  g.fillRect(carX + 94, 400, 36, 20);
  g.fillStyle = '#ffe9a8';
  g.fillRect(carX + 178, 430, 12, 10);
  g.fillStyle = '#0c0c10';
  for (const dx of [40, 150]) {
    g.beginPath();
    g.arc(carX + dx, 465, 17, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#777';
  for (const dx of [40, 150]) {
    g.beginPath();
    g.arc(carX + dx, 465, 7, 0, Math.PI * 2);
    g.fill();
  }
}
export function drawLake(g, t, w, h) {
  g.save();
  const z = 1 + t * 0.035;
  g.translate(w / 2, h / 2);
  g.scale(z, z);
  g.translate(-w / 2, -h / 2);
  const sky = g.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#86c3cc');
  sky.addColorStop(1, '#f6d6a8');
  g.fillStyle = sky;
  g.fillRect(-50, -50, w + 100, 360);
  g.fillStyle = '#fff3d2';
  g.beginPath();
  g.arc(300, 262, 42, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a93a6';
  g.beginPath();
  g.moveTo(-50, 300);
  [
    [80, 200],
    [190, 250],
    [330, 160],
    [470, 240],
    [600, 190],
    [760, 250],
    [1010, 210],
  ].forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(1010, 300);
  g.closePath();
  g.fill();
  g.fillStyle = '#4e6779';
  g.beginPath();
  g.moveTo(-50, 300);
  [
    [120, 250],
    [260, 280],
    [420, 230],
    [560, 275],
    [720, 240],
    [880, 270],
    [1010, 250],
  ].forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(1010, 300);
  g.closePath();
  g.fill();
  const wat = g.createLinearGradient(0, 300, 0, h);
  wat.addColorStop(0, '#6d9aaa');
  wat.addColorStop(1, '#1e3b54');
  g.fillStyle = wat;
  g.fillRect(-50, 300, w + 100, h);
  for (let i = 0; i < 40; i++) {
    const y = 306 + i * 6.2,
      sp = 10 + i * 2.2,
      x = 300 + Math.sin(t * 2 + i * 1.7) * sp * 0.6;
    g.fillStyle = 'rgba(255,240,205,' + (0.5 - i * 0.011) + ')';
    g.fillRect(x - sp, y, sp * 2 * (0.4 + hash(i) * 0.6), 2);
  }
  g.fillStyle = '#132232';
  for (let i = 0; i < 14; i++) {
    const x = 20 + i * 11,
      hh = 60 + hash(i + 3) * 70,
      sway = Math.sin(t * 1.5 + i) * 4;
    g.beginPath();
    g.moveTo(x, h);
    g.quadraticCurveTo(x + sway, h - hh * 0.6, x + sway * 1.6, h - hh);
    g.lineTo(x + 3, h);
    g.fill();
  }
  g.restore();
}

// Clips de ejemplo disponibles (clave → nombre, duración y función de dibujo)
export const DEMOS = {
  cancha: { name: 'Cancha', dur: 5, fn: drawField },
  avenida: { name: 'Avenida', dur: 4, fn: drawStreet },
  lago: { name: 'Lago', dur: 4.5, fn: drawLake },
};
