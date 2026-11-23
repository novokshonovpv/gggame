// Drawing the islands: the Motodrome's asphalt, the motocross track, the airport's markings
// and its planes, and the player's garage.

import type { Plane, World } from "./sim.ts";
import type { Pt, Track } from "./zones.ts";

type View = { x0: number; y0: number; x1: number; y1: number };
const FONT = "Unbounded, system-ui, sans-serif";

const inView = (v: View, r: { x0: number; y0: number; x1: number; y1: number }, m = 0) => !(r.x1 < v.x0 - m || r.x0 > v.x1 + m || r.y1 < v.y0 - m || r.y0 > v.y1 + m);

const closed = (ctx: CanvasRenderingContext2D, line: Pt[]) => {
  ctx.beginPath();
  line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
};

// The line moved sideways by d (left of the direction of travel is negative).
const offset = (line: Pt[], d: number) =>
  line.map((q, i) => {
    const a = line[(i - 1 + line.length) % line.length];
    const b = line[(i + 1) % line.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: q.x - (dy / l) * d, y: q.y + (dx / l) * d };
  });

const offsets = new WeakMap<Track, Map<number, Pt[]>>();
const off = (tr: Track, d: number) => {
  let m = offsets.get(tr);
  if (!m) offsets.set(tr, (m = new Map()));
  let l = m.get(d);
  if (!l) m.set(d, (l = offset(tr.line, d)));
  return l;
};

// Gates: a flag each side, the next one yellow; the start/finish line chequered.
function gates(ctx: CanvasRenderingContext2D, tr: Track, world: World, t: number, half: number) {
  const job = world.job && world.job.track === tr ? world.job : null;
  const G = tr.gates.length;
  const P = tr.gates;
  for (let i = 0; i < G; i++) {
    const q = P[i];
    const k = tr.line.indexOf(q);
    const n = tr.line[(k + 1) % tr.line.length] ?? P[(i + 1) % G];
    const a = Math.atan2(n.y - q.y, n.x - q.x) + Math.PI / 2;
    const next = job && (job.idx + 1) % G === i;
    if (i > 0 || tr.surface === "dirt")
      for (const sgn of [-1, 1]) {
        const fx = q.x + Math.cos(a) * (half + 6) * sgn;
        const fy = q.y + Math.sin(a) * (half + 6) * sgn;
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(fx - 1, fy - 1, 2, 2);
        ctx.fillStyle = next ? "#ffd23a" : i === 0 ? "#fff" : sgn < 0 ? "#e53935" : "#1e88e5";
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + 9 + Math.sin(t * 6 + i) * 1.5, fy - 4);
        ctx.lineTo(fx, fy - 8);
        ctx.fill();
      }
    if (i === 0) {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(a);
      const cells = Math.ceil((half * 2) / 9);
      for (let c = 0; c < cells; c++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (c + j) % 2 === 0 ? "#111" : "#f4f4f4";
          ctx.fillRect(-half + c * 9, -9 + j * 9, 9, 9);
        }
      ctx.restore();
    }
  }
}

function title(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, sub: string) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#f3ead8";
  ctx.font = `900 40px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x, y);
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(sub, x, y + 32);
  ctx.restore();
}

// Tyre barriers: black stacks, painted red and white on the Motodrome, blue and white at the motocross.
function tyres(ctx: CanvasRenderingContext2D, v: View, tr: Track) {
  const paint = tr.surface === "asphalt" ? ["#e53935", "#f4f4f4"] : ["#1e88e5", "#f4f4f4"];
  tr.tyres.forEach((p, i) => {
    if (p.x < v.x0 - 20 || p.x > v.x1 + 20 || p.y < v.y0 - 20 || p.y > v.y1 + 20) return;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(p.x + 2.5, p.y + 3, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1b1d";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = paint[Math.floor(i / 2) % 2];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#3a3a3e";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function drawTracks(ctx: CanvasRenderingContext2D, v: View, world: World, t: number, road: CanvasPattern, dirt: CanvasPattern) {
  for (const tr of world.map.tracks) {
    if (tr.id === "enduro" || !inView(v, tr.rect, 80)) continue;
    // (barriers last, over the track edges)
    const after = () => tyres(ctx, v, tr);
    const L = tr.line;
    const w = tr.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (tr.surface === "asphalt") {
      // Kerbs, white edge lines, asphalt.
      closed(ctx, L);
      ctx.strokeStyle = "#f4f4f4";
      ctx.lineWidth = w + 14;
      ctx.stroke();
      ctx.setLineDash([16, 16]);
      ctx.strokeStyle = "#d32f2f";
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "#f4f4f4";
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = road;
      ctx.lineWidth = w - 5;
      ctx.stroke();
      // Rubber on the racing line.
      ctx.strokeStyle = "rgba(20,20,22,0.18)";
      ctx.lineWidth = w * 0.35;
      ctx.stroke();
      // Grid boxes.
      ctx.strokeStyle = "rgba(240,240,230,0.9)";
      ctx.lineWidth = 2;
      for (const g of tr.grid) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-12, -16);
        ctx.lineTo(12, -16);
        ctx.moveTo(-12, -16);
        ctx.lineTo(-12, 0);
        ctx.moveTo(12, -16);
        ctx.lineTo(12, 0);
        ctx.stroke();
        ctx.restore();
      }
      gates(ctx, tr, world, t, w / 2);
      after();
      const best = world.bestLaps.ring;
      title(ctx, (tr.rect.x0 + tr.rect.x1) / 2, tr.rect.y0 + (tr.rect.y1 - tr.rect.y0) * 0.36, "МОТОДРОМ 67", best ? "гонка на 2 круга · выезжай на старт" : "выезжай на старт — гонка с тремя гонщиками");
    } else {
      // Packed dirt with ruts, taped edges.
      closed(ctx, L);
      ctx.strokeStyle = "rgba(70,45,24,0.45)";
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = dirt;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = w - 16;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(40,26,14,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([22, 9]);
      for (const d of [-18, -6, 8, 20]) {
        closed(ctx, off(tr, d));
        ctx.stroke();
      }
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2.2;
      for (const d of [-w / 2 - 4, w / 2 + 4]) {
        ctx.strokeStyle = d < 0 ? "rgba(255,255,255,0.85)" : "rgba(30,136,229,0.85)";
        closed(ctx, off(tr, d));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      gates(ctx, tr, world, t, w / 2);
      after();
      const best = world.bestLaps.mx;
      title(ctx, (tr.rect.x0 + tr.rect.x1) / 2, tr.rect.y0 + (tr.rect.y1 - tr.rect.y0) * 0.24, "МОТОКРОСС", best ? `рекорд круга ${best.toFixed(2)} с` : "выезжай на старт — круг на время");
    }
  }
}

// Runway, taxiway and apron markings.
export function drawAirportGround(ctx: CanvasRenderingContext2D, v: View, world: World) {
  const ap = world.map.airport;
  if (!ap || !inView(v, ap.rect, 200)) return;
  const rw = ap.runway;
  const cy = (rw.y0 + rw.y1) / 2;
  const H = rw.y1 - rw.y0;
  ctx.fillStyle = "rgba(245,245,240,0.92)";
  if (inView(v, rw, 40)) {
    // Edge lines and centre dashes.
    ctx.fillRect(rw.x0 + 10, rw.y0 + 8, rw.x1 - rw.x0 - 20, 3);
    ctx.fillRect(rw.x0 + 10, rw.y1 - 11, rw.x1 - rw.x0 - 20, 3);
    const xa = Math.max(rw.x0 + 420, Math.floor((v.x0 - 200) / 200) * 200);
    const xb = Math.min(rw.x1 - 420, v.x1 + 200);
    for (let x = xa; x < xb; x += 200) ctx.fillRect(x, cy - 2.5, 110, 5);
    // Threshold bars, numbers and touchdown marks at both ends.
    for (const [x0, dir, num] of [
      [rw.x0 + 30, 1, "09"],
      [rw.x1 - 30, -1, "27"],
    ] as const) {
      for (let k = 0; k < 8; k++) {
        const y = rw.y0 + 22 + k * ((H - 44) / 8);
        if (Math.abs(y + 8 - cy) < 18) continue;
        ctx.fillRect(dir > 0 ? x0 : x0 - 120, y, 120, 16);
      }
      ctx.save();
      ctx.translate(x0 + dir * 180, cy);
      ctx.rotate(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.font = `900 64px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(num, 0, 0);
      ctx.restore();
      for (const sgn of [-1, 1]) ctx.fillRect(dir > 0 ? x0 + 420 : x0 - 420 - 180, cy + sgn * 50 - 10, 180, 20);
    }
  }
  // Taxiway centre lines (yellow).
  ctx.fillStyle = "rgba(255,206,58,0.85)";
  for (const q of ap.taxi) {
    if (!inView(v, q, 20)) continue;
    if (q.x1 - q.x0 > q.y1 - q.y0) ctx.fillRect(q.x0 + 20, (q.y0 + q.y1) / 2 - 1.5, q.x1 - q.x0 - 40, 3);
    else ctx.fillRect((q.x0 + q.x1) / 2 - 1.5, q.y0, 3, q.y1 - q.y0);
  }
  // Stands: a lead-in line for each parked plane and a box round it.
  for (const p of ap.planes) {
    if (p.x < v.x0 - 200 || p.x > v.x1 + 200) continue;
    ctx.fillRect(p.x - 1.5, p.y - 130, 3, 300);
    ctx.strokeStyle = "rgba(255,206,58,0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - 115, p.y - 130, 230, 270);
  }
  // The runway race's start line and lift-off marker.
  const rs = ap.raceStart;
  ctx.fillStyle = "rgba(56,182,255,0.9)";
  ctx.fillRect(rs.x + 34, rw.y0 + 12, 6, 50);
  ctx.save();
  ctx.font = `800 14px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("✈ ГОНКА С САМОЛЁТОМ", rs.x - 30, rw.y0 - 30);
  ctx.restore();
}

const LIVERY = [
  ["#f4f4f4", "#1c4fd8"],
  ["#f4f4f4", "#d32f2f"],
  ["#f4f4f4", "#d9b778"],
];

// An airliner from above: fuselage 200 units, wings swept back.
function planeShape(ctx: CanvasRenderingContext2D, livery: number, shadow: boolean) {
  const [body, tail] = LIVERY[livery % LIVERY.length];
  ctx.fillStyle = shadow ? "rgba(0,0,0,1)" : "#d8dde3";
  // Wings and tailplane.
  ctx.beginPath();
  ctx.moveTo(22, -9);
  ctx.lineTo(-22, -96);
  ctx.lineTo(-38, -96);
  ctx.lineTo(-18, -9);
  ctx.lineTo(-18, 9);
  ctx.lineTo(-38, 96);
  ctx.lineTo(-22, 96);
  ctx.lineTo(22, 9);
  ctx.closePath();
  ctx.moveTo(-72, -6);
  ctx.lineTo(-92, -34);
  ctx.lineTo(-100, -34);
  ctx.lineTo(-90, 0);
  ctx.lineTo(-100, 34);
  ctx.lineTo(-92, 34);
  ctx.lineTo(-72, 6);
  ctx.closePath();
  ctx.fill();
  if (!shadow) {
    // Engines under the wings.
    ctx.fillStyle = "#9aa3ad";
    for (const w of [-42, 42]) {
      ctx.beginPath();
      ctx.ellipse(8, w, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Fuselage.
  ctx.fillStyle = shadow ? "rgba(0,0,0,1)" : body;
  ctx.beginPath();
  ctx.moveTo(100, 0);
  ctx.quadraticCurveTo(96, -11, 78, -11);
  ctx.lineTo(-86, -9);
  ctx.quadraticCurveTo(-102, -4, -104, 0);
  ctx.quadraticCurveTo(-102, 4, -86, 9);
  ctx.lineTo(78, 11);
  ctx.quadraticCurveTo(96, 11, 100, 0);
  ctx.fill();
  if (shadow) return;
  // Fin, cheat line, cockpit windows.
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(-66, -2.5);
  ctx.lineTo(-104, -2.5);
  ctx.lineTo(-104, 2.5);
  ctx.lineTo(-66, 2.5);
  ctx.fill();
  ctx.fillRect(-60, -1, 130, 2);
  ctx.fillStyle = "#26323d";
  ctx.beginPath();
  ctx.moveTo(92, -5);
  ctx.lineTo(84, -7);
  ctx.lineTo(84, 7);
  ctx.lineTo(92, 5);
  ctx.fill();
  ctx.fillStyle = tail;
  ctx.font = `900 9px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.rotate(Math.PI / 2);
  ctx.restore();
}

function plane(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, z: number, livery: number, alpha: number) {
  const s = 1 + z * 0.8;
  // Shadow on the ground, further off and fainter the higher it is.
  ctx.save();
  ctx.globalAlpha = 0.28 * (1 - z * 0.6) * alpha;
  ctx.translate(x + 14 + z * 260, y + 20 + z * 340);
  ctx.rotate(a);
  planeShape(ctx, livery, true);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.scale(s, s);
  planeShape(ctx, livery, false);
  ctx.restore();
}

const planeIn = (v: View, x: number, y: number, z: number) => x > v.x0 - 400 - z * 400 && x < v.x1 + 400 && y > v.y0 - 400 && y < v.y1 + 400 + z * 400;

// Parked planes and planes on the ground.
export function drawPlanesLow(ctx: CanvasRenderingContext2D, v: View, world: World) {
  const ap = world.map.airport;
  if (!ap) return;
  for (const p of ap.planes) if (planeIn(v, p.x, p.y, 0)) plane(ctx, p.x, p.y, p.a, 0, p.livery, 1);
  for (const q of world.planes) if (q.z < 0.25 && planeIn(v, q.x, q.y, q.z)) plane(ctx, q.x, q.y, q.a, q.z, q.livery, q.fade);
}

// Planes in the air, over the rooftops.
export function drawPlanesHigh(ctx: CanvasRenderingContext2D, v: View, world: World) {
  for (const q of world.planes as Plane[]) if (q.z >= 0.25 && planeIn(v, q.x, q.y, q.z)) plane(ctx, q.x, q.y, q.a, q.z, q.livery, q.fade);
}

// Runway edge lights and plane beacons for the night overlay.
export function airportLights(world: World, v: View, glow: (x: number, y: number, r: number, a: number) => void, t: number) {
  const ap = world.map.airport;
  if (!ap) return;
  const rw = ap.runway;
  if (inView(v, rw, 100)) {
    const xa = Math.max(rw.x0, Math.floor((v.x0 - 100) / 160) * 160);
    for (let x = xa; x < Math.min(rw.x1, v.x1 + 100); x += 160) {
      glow(x, rw.y0 + 4, 26, 0.75);
      glow(x, rw.y1 - 4, 26, 0.75);
    }
  }
  for (const q of world.planes) {
    glow(q.x + Math.cos(q.a) * 90, q.y + Math.sin(q.a) * 90, 90, 0.6);
    if (Math.floor(t * 2) % 2 === 0) glow(q.x, q.y, 50, 0.9);
  }
}

// The player's garage: a roll-up door and the sign.
export function drawHome(ctx: CanvasRenderingContext2D, v: View, world: World, t: number) {
  const lot = world.map.homeLot;
  if (!lot) return;
  const T = 32;
  const x0 = lot.x0 * T;
  const y0 = lot.y0 * T;
  const x1 = (lot.x1 + 1) * T;
  const y1 = (lot.y1 + 1) * T;
  if (x1 < v.x0 - 60 || x0 > v.x1 + 60 || y1 < v.y0 - 60 || y0 > v.y1 + 60) return;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  ctx.save();
  ctx.fillStyle = "rgba(255,159,26,0.16)";
  ctx.strokeStyle = "#ff9f1a";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -t * 12;
  ctx.beginPath();
  ctx.roundRect(cx - 40, cy - 28, 80, 56, 7);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  // A garage front: roof, roll-up door slats.
  ctx.fillStyle = "#ff9f1a";
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy - 6);
  ctx.lineTo(cx, cy - 17);
  ctx.lineTo(cx + 16, cy - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - 13, cy - 6, 26, 15);
  ctx.fillStyle = "rgba(30,20,10,0.75)";
  for (let k = 0; k < 4; k++) ctx.fillRect(cx - 10, cy - 4 + k * 3.4, 20, 1.6);
  ctx.fillStyle = "#fff";
  ctx.font = `800 6.5px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ТВОЙ ГАРАЖ", cx, cy + 19, 74);
  ctx.restore();
}
