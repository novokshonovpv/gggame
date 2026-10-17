import { Chain, World } from "planck";
import type { Contact } from "planck";
import { autopilot } from "./ai.ts";
import { BASE_STATS, Bike, type BikeStats, type FixtureTag, type Input } from "./bike.ts";
import { groundY, rng, type Track } from "./track.ts";

export const GRAVITY = -11;
const RESPAWN_DELAY = 1.1;
const STUCK_LIMIT = 5; // seconds without forward progress before a reset
const IDLE: Input = { gas: false, brake: false, lean: 0 };
const HOLD: Input = { gas: false, brake: true, lean: 0 };

export interface Look {
  name: string;
  plastic: string;
  plasticDark: string;
  jersey: string;
  jerseyDark: string;
  pants: string;
  helmet: string;
  visor: string;
  accent?: string; // graphics on the shrouds and side panels
  frame?: string;
  boots?: string;
}

// Stock bike: BSE T5 in yellow with black graphics and a black frame.
export const PLAYER_LOOK: Look = {
  name: "Ты",
  plastic: "#f4d10f",
  plasticDark: "#1b1b1d",
  accent: "#1b1b1d",
  frame: "#202022",
  // Leatt 3.5 Ride Kit in blue, white boots.
  jersey: "#1f5fbf",
  jerseyDark: "#163f80",
  pants: "#1f5fbf",
  boots: "#ececec",
  helmet: "#f2f2f2",
  visor: "#f4d10f",
};

interface RivalSpec {
  look: Look;
  power: number; // engine share: lower is slower
  wobble: number; // max landing misjudgement, radians
}

export const RIVALS: RivalSpec[] = [
  {
    power: 0.97,
    wobble: 0.3,
    look: { name: "Шторм", plastic: "#e23b3b", plasticDark: "#1d1d20", accent: "#f2f2f2", frame: "#1d1d20", jersey: "#26262b", jerseyDark: "#141417", pants: "#2c2c30", helmet: "#e23b3b", visor: "#f2f2f2" },
  },
  {
    power: 0.9,
    wobble: 0.4,
    look: { name: "Кобра", plastic: "#30b85a", plasticDark: "#1d1d20", accent: "#1d1d20", frame: "#2a2a2c", jersey: "#1d6b3a", jerseyDark: "#124827", pants: "#f0f0f0", helmet: "#f4f4f4", visor: "#30b85a" },
  },
  {
    power: 0.8,
    wobble: 0.5,
    look: { name: "Ледок", plastic: "#f2f4f7", plasticDark: "#1e6fc4", accent: "#3a9cff", frame: "#3a9cff", jersey: "#f2f2f2", jerseyDark: "#c9d3dd", pants: "#2b4f7a", helmet: "#3a9cff", visor: "#f2f2f2" },
  },
];

export class Racer {
  bike: Bike;
  lap = 1;
  finished = false;
  finishTime = 0;
  crashed = false;
  crashTimer = 0;
  crashes = 0;
  bestProgress = 0;
  stuckTime = 0;
  checkpoint: number;
  look: Look;
  isPlayer: boolean;
  private spec: RivalSpec | null;
  private rand: () => number;
  private airError = 0;
  private wasGrounded = true;

  constructor(
    world: World,
    track: Track,
    look: Look,
    isPlayer: boolean,
    spec: RivalSpec | null,
    rand: () => number,
    stats: BikeStats = BASE_STATS,
  ) {
    this.look = look;
    this.isPlayer = isPlayer;
    this.spec = spec;
    this.rand = rand;
    this.bike = new Bike(world, { x: track.startX, y: groundY(track, track.startX) }, stats);
    if (spec) this.bike.power = spec.power;
    this.checkpoint = track.startX;
  }

  get x() {
    return this.bike.chassis.getPosition().x;
  }

  // Distance covered over all laps: the basis for race positions.
  progress(track: Track) {
    return (this.lap - 1) * (track.finishX - track.startX) + (this.x - track.startX);
  }

  aiInput(track: Track): Input {
    const g = this.bike.grounded;
    if (this.wasGrounded && !g && this.spec) this.airError = (this.rand() * 2 - 1) * this.spec.wobble;
    this.wasGrounded = g;
    return autopilot(this.bike, track, this.airError);
  }
}

export interface PlayerSetup {
  look: Look;
  stats: BikeStats;
}

export interface RaceEvents {
  crash?(r: Racer): void;
  lap?(r: Racer, dx: number, dy: number): void;
  finish?(r: Racer): void;
}

// One race: a shared physics world with the player (optional) and AI rivals.
export class Race {
  world: World;
  track: Track;
  events: RaceEvents;
  racers: Racer[] = [];
  time = 0;
  started = false;

  constructor(track: Track, player: PlayerSetup | null, events: RaceEvents = {}, seed = 1) {
    this.track = track;
    this.events = events;
    this.world = new World({ gravity: { x: 0, y: GRAVITY } });
    this.world.createBody().createFixture(new Chain(track.points, false), {
      friction: track.grip,
      userData: "ground" satisfies FixtureTag,
    });
    const rand = rng(seed);
    if (player) this.racers.push(new Racer(this.world, track, player.look, true, null, rand, player.stats));
    for (const spec of RIVALS) this.racers.push(new Racer(this.world, track, spec.look, false, spec, rand));
    this.world.on("begin-contact", (c) => this.contact(c, 1));
    this.world.on("end-contact", (c) => this.contact(c, -1));
  }

  get player() {
    return this.racers.find((r) => r.isPlayer);
  }

  private racerOf(bike: Bike) {
    return this.racers.find((r) => r.bike === bike)!;
  }

  private contact(c: Contact, delta: number) {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const a = fa.getUserData() as FixtureTag;
    const b = fb.getUserData() as FixtureTag;
    if (a !== "ground" && b !== "ground") return;
    const other = a === "ground" ? fb : fa;
    const tag = other.getUserData() as FixtureTag;
    const bike = other.getBody().getUserData() as Bike;
    if (tag === "wheel-rear") bike.rearContacts += delta;
    else if (tag === "wheel-front") bike.frontContacts += delta;
    else if (tag === "rider" && delta > 0) this.crash(this.racerOf(bike));
  }

  private crash(r: Racer) {
    if (r.crashed || r.finished || !this.started) return;
    r.crashed = true;
    r.crashes++;
    r.crashTimer = RESPAWN_DELAY;
    this.events.crash?.(r);
  }

  // One fixed physics step. `playerInput` drives the player's bike.
  step(dt: number, playerInput: Input) {
    const { track } = this;
    for (const r of this.racers) {
      let input: Input;
      if (!this.started) input = HOLD;
      else if (r.crashed || r.finished) input = IDLE;
      else input = r.isPlayer ? playerInput : r.aiInput(track);
      r.bike.apply(input, dt);
    }
    this.world.step(dt, 8, 3);
    if (this.started) this.time += dt;

    for (const r of this.racers) {
      const b = r.bike;
      const p = b.chassis.getPosition();
      if (r.crashed) {
        r.crashTimer -= dt;
        if (r.crashTimer <= 0) {
          r.crashed = false;
          b.placeAt(r.checkpoint, groundY(track, r.checkpoint));
        }
        continue;
      }
      if (r.finished) continue;
      // Fell through the world or stuck without progress (rocking in a dip): reset.
      const progress = r.progress(track);
      if (progress > r.bestProgress + 0.5) {
        r.bestProgress = progress;
        r.stuckTime = 0;
      } else if (this.started && !r.isPlayer) r.stuckTime += dt; // a player may simply stop
      if (p.y < groundY(track, p.x) - 6 || r.stuckTime > STUCK_LIMIT) {
        r.stuckTime = 0;
        this.crash(r);
        continue;
      }
      // Respawn point: last spot where the bike was upright on fairly flat ground.
      const slope = groundY(track, p.x + 0.5) - groundY(track, p.x - 0.5);
      if (b.rearContacts > 0 && b.frontContacts > 0 && Math.abs(b.chassis.getAngle()) < 0.35 && Math.abs(slope) < 0.25)
        r.checkpoint = p.x;

      if (p.x >= track.finishX) {
        if (r.lap < track.laps) {
          const dx = track.startX - track.finishX;
          const dy = groundY(track, track.startX) - groundY(track, track.finishX);
          b.translate(dx, dy);
          r.checkpoint = track.startX;
          r.lap++;
          this.events.lap?.(r, dx, dy);
        } else {
          r.finished = true;
          r.finishTime = this.time;
          this.events.finish?.(r);
        }
      }
    }
  }

  // Finished racers by time, then everyone else by distance covered.
  standings() {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress(this.track) - a.progress(this.track);
    });
  }

  placeOf(r: Racer) {
    return this.standings().indexOf(r) + 1;
  }
}
