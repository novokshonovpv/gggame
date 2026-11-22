// The navigator: a point picked on the city map, a route to it along the streets. The route
// follows the player: the part behind is dropped, a wrong turn makes it re-plan, and on
// arrival it switches off.

import type { World } from "./sim.ts";

export interface NavState {
  x: number; // destination
  y: number;
  path: { x: number; y: number }[]; // from the player's current spot to the destination
  dist: number; // units left
}

const OFF_ROUTE = 110; // units away from the line before re-planning
const ARRIVE = 45;

const segDist = (px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return { d: Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)), t };
};

export class Navigator {
  private world: World;
  private replanT = 0;
  onArrive: () => void = () => {};

  constructor(world: World) {
    this.world = world;
  }

  get state() {
    return this.world.nav;
  }

  // Plans a route to a point; false if there is no way there.
  set(x: number, y: number) {
    const w = this.world;
    const path = w.map.route(w.px, w.py, x, y);
    if (!path || path.length < 2) return false;
    const end = path[path.length - 1];
    w.nav = { x: end.x, y: end.y, path, dist: 0 };
    this.measure();
    return true;
  }

  clear() {
    this.world.nav = null;
  }

  update(dt: number) {
    const w = this.world;
    const nav = w.nav;
    if (!nav) return;
    const px = w.px;
    const py = w.py;
    if (Math.hypot(nav.x - px, nav.y - py) < ARRIVE) {
      w.nav = null;
      this.onArrive();
      return;
    }
    // Where along the route the player is (looking a few segments ahead).
    let best = { i: 0, d: Infinity, t: 0 };
    const look = Math.min(nav.path.length - 1, 12);
    for (let i = 0; i < look; i++) {
      const r = segDist(px, py, nav.path[i], nav.path[i + 1]);
      if (r.d < best.d) best = { i, d: r.d, t: r.t };
    }
    this.replanT = Math.max(0, this.replanT - dt);
    if (best.d > OFF_ROUTE) {
      if (this.replanT <= 0) {
        this.replanT = 1;
        this.set(nav.x, nav.y);
      }
      return;
    }
    // Drop what is behind: the route now starts where the player is.
    const a = nav.path[best.i];
    const b = nav.path[best.i + 1];
    const here = { x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t };
    nav.path = [here, ...nav.path.slice(best.i + 1)];
    this.measure();
  }

  private measure() {
    const nav = this.world.nav;
    if (!nav) return;
    let d = 0;
    for (let i = 0; i + 1 < nav.path.length; i++) d += Math.hypot(nav.path[i + 1].x - nav.path[i].x, nav.path[i + 1].y - nav.path[i].y);
    nav.dist = d;
  }
}

// 1 unit = 1/8 m.
export const fmtDist = (units: number) => {
  const m = units / 8;
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} м` : `${(m / 1000).toFixed(1).replace(".", ",")} км`;
};
