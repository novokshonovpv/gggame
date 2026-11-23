// The islands without a browser: a Motodrome race and a motocross lap ridden by an autopilot,
// the runway race against a plane, and planes coming and going. `node tools/zones-sim.ts`
import { CityMap } from "../src/city/map.ts";
import { BIKE, type Input, World } from "../src/city/sim.ts";

const map = new CityMap(67);
const idle: Input = { gas: false, brake: false, left: false, right: false, hb: false, action: false, kick: false, fire: false, swap: false, sprint: false };
const dt = 1 / 60;

function rider(bikeId: string) {
  const w = new World(map);
  w.view = { x0: w.px - 450, y0: w.py - 250, x1: w.px + 450, y1: w.py + 250 };
  const v = w.spawnPlayerBike(bikeId, w.px, w.py, 0, true);
  return { w, v };
}
const step = (w: World, inp: Input) => {
  w.view = { x0: w.px - 450, y0: w.py - 250, x1: w.px + 450, y1: w.py + 250 };
  w.step(dt, inp);
  const ev = w.events.filter((e) => e.type === "msg" || e.type === "countdown" || e.type === "lap" || e.type === "jobDone" || e.type === "jobFail");
  w.events.length = 0;
  return ev;
};
// Steer along a line: aim a few points ahead, ease off for bends.
function autopilot(w: World, line: { x: number; y: number }[], k: { i: number }, pace = 1): Input {
  const v = w.player.bike!;
  const L = line.length;
  for (let n = 0; n < 8; n++) {
    const q = line[k.i];
    const n = line[(k.i + 1) % L];
    const ahead = (q.x - v.x) * (n.x - q.x) + (q.y - v.y) * (n.y - q.y);
    if (Math.hypot(q.x - v.x, q.y - v.y) > 60 && ahead > 0) break;
    k.i = (k.i + 1) % L;
  }
  const aim = line[(k.i + 2) % L];
  let diff = Math.atan2(aim.y - v.y, aim.x - v.x) - v.a;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  let bend = 0;
  for (let j = 0; j < 9; j++) {
    const a = line[(k.i + j) % L];
    const b = line[(k.i + j + 1) % L];
    const c = line[(k.i + j + 2) % L];
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    bend += Math.abs(d);
  }
  const target = Math.max(90, v.model.vmax * pace * (1 - bend * 0.5));
  return { ...idle, gas: v.fwd < target, brake: v.fwd > target + 25, left: diff < -0.06, right: diff > 0.06 };
}

// ---- the Motodrome ----
for (const pace of [1.0, 0.8]) {
  const { w } = rider("2t");
  const tr = map.tracks.find((t) => t.id === "ring")!;
  const b = w.player.bike!;
  b.x = tr.gates[0].x;
  b.y = tr.gates[0].y + 30;
  b.a = -Math.PI / 2;
  const log: string[] = [];
  let k = { i: 0 };
  let started = false;
  let worst = 0;
  for (let i = 0; i < 300 * 60; i++) {
    const job = w.job;
    if (job?.kind === "circuit" && !started && !(job.go! > 0)) {
      started = true;
      k = { i: 0 };
    }
    const inp = job?.kind === "circuit" && !(job.go! > 0) && w.player.bike ? autopilot(w, tr.line, k, pace) : idle;
    const s = performance.now();
    for (const e of step(w, inp)) if (e.type === "msg" || e.type === "jobDone" || e.type === "jobFail" || e.type === "countdown") log.push(`${(i / 60).toFixed(1)}s ${e.type === "msg" ? e.text : e.type === "countdown" ? `countdown ${e.n}` : e.type}`);
    worst = Math.max(worst, performance.now() - s);
    if (i % (20 * 60) === 0 && w.job?.kind === "circuit") log.push(`  t=${i / 60} at ${Math.round(w.px / 32)},${Math.round(w.py / 32)} v ${Math.round(w.player.bike?.fwd ?? 0)} k ${k.i} place ${w.racePlace()} idx ${w.job.idx} racers ${w.job.racers!.map((v) => `${v.racer?.laps}:${v.racer?.i}`).join(" ")} mode ${w.player.mode}`);
    if (started && !w.job) break;
  }
  console.log(`MOTODROME pace ${pace} (worst step ${worst.toFixed(1)} ms)\n  ` + log.slice(0, 30).join("\n  "));
}

// ---- motocross lap ----
{
  const { w } = rider("2t");
  const tr = map.tracks.find((t) => t.id === "mx")!;
  const b = w.player.bike!;
  const g0 = tr.gates[0];
  const g1 = tr.line[3];
  b.x = g0.x - (g1.x - g0.x) * 0.5;
  b.y = g0.y - (g1.y - g0.y) * 0.5;
  b.a = Math.atan2(g1.y - g0.y, g1.x - g0.x);
  const k = { i: 0 };
  const log: string[] = [];
  for (let i = 0; i < 260 * 60; i++) {
    if (!w.player.bike) {
      // Thrown off: get back on.
      step(w, idle);
      if (w.player.mode === "foot") step(w, { ...idle, action: true });
      continue;
    }
    for (const e of step(w, autopilot(w, tr.line, k, 0.85))) if (e.type === "msg" || e.type === "lap") log.push(`${(i / 60).toFixed(1)}s ${e.type === "msg" ? e.text : `lap ${e.time.toFixed(1)} ${e.track}`}`);
    if (log.some((l) => l.includes("lap "))) break;
  }
  console.log("MOTOCROSS\n  " + log.slice(0, 14).join("\n  "));
}

// ---- the runway race, on each bike ----
for (const id of ["z3", "2t"]) {
  const { w } = rider(id);
  const ap = map.airport!;
  const b = w.player.bike!;
  b.x = ap.raceStart.x;
  b.y = ap.raceStart.y;
  const log: string[] = [];
  for (let i = 0; i < 80 * 60; i++) {
    const job = w.job;
    const racing = job?.kind === "plane" && !(job.go! > 0);
    const v = w.player.bike;
    let inp = idle;
    if (racing && v) {
      const dy = job!.goal!.y - v.y;
      const want = Math.atan2(dy, 300);
      let diff = want - v.a;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      inp = { ...idle, gas: true, left: diff < -0.03, right: diff > 0.03 };
    }
    for (const e of step(w, inp)) if (e.type !== "countdown") log.push(`${(i / 60).toFixed(1)}s ${e.type === "msg" ? e.text : e.type}`);
    if (racing && !w.job) break;
    if (i > 10 && !w.job && !job) break;
  }
  const q = w.planes[0];
  console.log(`RUNWAY on ${id} (${BIKE[id].name}): plane x ${q ? Math.round(q.x) : "-"} phase ${q?.phase}\n  ` + log.slice(-4).join("\n  "));
}

// ---- planes come and go ----
{
  const { w } = rider("z3");
  const ap = map.airport!;
  const b = w.player.bike!;
  b.x = (ap.runway.x0 + ap.runway.x1) / 2;
  b.y = ap.runway.y0 - 300;
  const seen: string[] = [];
  for (let i = 0; i < 200 * 60; i++) {
    step(w, idle);
    for (const q of w.planes) {
      const tag = `${q.phase}`;
      if (!seen.includes(tag)) seen.push(tag);
    }
  }
  console.log("PLANES phases seen:", seen.join(", "), "| now", w.planes.length);
}

// ---- the drift pad: circles with the handbrake ----
{
  const { w } = rider("2t");
  const D = map.drift!;
  const b = w.player.bike!;
  const spot = map.jobs.find((j) => j.kind === "drift")!;
  b.x = spot.x;
  b.y = spot.y;
  const log: string[] = [];
  for (let i = 0; i < 60 * 60; i++) {
    const v = w.player.bike;
    let inp = idle;
    if (w.job?.kind === "drift" && v) {
      // Head for the middle, then circle it with the handbrake on.
      const cx = (D.x0 + D.x1) / 2;
      const cy = (D.y0 + D.y1) / 2;
      const far = Math.hypot(v.x - cx, v.y - cy) > 260;
      let diff = Math.atan2(cy - v.y, cx - v.x) - v.a;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      inp = far ? { ...idle, gas: true, left: diff < -0.1, right: diff > 0.1 } : { ...idle, gas: true, right: true, hb: v.speed > 90 };
    }
    for (const e of step(w, inp)) if (e.type === "msg" || e.type === "jobDone" || e.type === "jobFail") log.push(`${(i / 60).toFixed(1)}s ${e.type === "msg" ? e.text : e.type}`);
    if (i > 60 && !w.job) break;
  }
  console.log("DRIFT\n  " + log.slice(-3).join("\n  "));
}

// ---- slalom lap by autopilot ----
{
  const { w } = rider("ex125");
  const tr = map.tracks.find((t) => t.id === "slalom")!;
  const b = w.player.bike!;
  b.x = tr.gates[0].x - 60;
  b.y = tr.gates[0].y;
  const k = { i: 0 };
  const log: string[] = [];
  for (let i = 0; i < 90 * 60; i++) {
    if (!w.player.bike) {
      step(w, idle);
      continue;
    }
    for (const e of step(w, autopilot(w, tr.line, k, 0.6))) if (e.type === "msg" || e.type === "lap") log.push(`${(i / 60).toFixed(1)}s ${e.type === "msg" ? e.text : `lap ${e.time.toFixed(1)} ${e.track}`}`);
    if (log.some((l) => l.includes("lap "))) break;
  }
  console.log("SLALOM\n  " + log.slice(0, 6).join("\n  "));
}

// ---- stunt ramps and the garage yard ----
{
  const { w } = rider("2t");
  w.owned = ["z3", "ex125", "t5", "2t"];
  w.bikeId = "2t";
  const home = map.home!;
  const b = w.player.bike!;
  b.x = home.start.x;
  b.y = home.start.y;
  step(w, idle);
  for (let i = 0; i < 30; i++) step(w, idle);
  console.log("YARD bikes:", w.vehicles.filter((v) => v.homeBay >= 0).map((v) => `${v.homeBay}:${v.model.id}`).join(" "), "| jumps on map", map.jumps.length);
  // A run at a stunt ramp.
  const o = map.jumps[1];
  b.x = o.x - Math.cos(o.a) * 260;
  b.y = o.y - Math.sin(o.a) * 260;
  b.a = o.a;
  const log: string[] = [];
  for (let i = 0; i < 6 * 60; i++) for (const e of step(w, { ...idle, gas: true })) if (e.type === "msg") log.push(e.text);
  console.log("STUNT RAMP:", log.join(" | "), "| done", [...w.jumpsDone]);
}

// ---- test drive at the showroom ----
{
  const { w } = rider("z3");
  const spot = map.jobs.find((j) => j.kind === "testdrive")!;
  const b = w.player.bike!;
  b.x = spot.x;
  b.y = spot.y + 1;
  const log: string[] = [];
  for (let i = 0; i < 3 * 60; i++) for (const e of step(w, idle)) if (e.type === "msg") log.push(e.text);
  console.log("TESTDRIVE:", w.job?.title, "| riding", w.player.bike?.model.name, "|", log.join(" | "));
  w.failJob("стоп");
  for (const e of step(w, idle)) if (e.type === "msg") log.push(e.text);
  console.log("  after:", w.player.mode, log.slice(-2).join(" | "), "| test bike left:", w.vehicles.some((v) => v.model.id === "2t" && v.rider === null));
}
