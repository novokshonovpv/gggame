// Headless physics run for tuning: `node tools/sim.ts [policy]`.
import { Chain, World } from "planck";
import { autopilot } from "../src/ai.ts";
import { Bike, type FixtureTag, type Input } from "../src/bike.ts";
import { TRACKS, groundY, type Track } from "../src/track.ts";

const DT = 1 / 120;
const GRAVITY = -11;
const TRACE = process.env.TRACE === "1";

type Policy = (bike: Bike, track: Track) => Input;

const policies: Record<string, Policy> = {
  gas: () => ({ gas: true, brake: false, lean: 0 }),
  pilot: autopilot,
};

function run(track: Track, policy: Policy) {
  const world = new World({ gravity: { x: 0, y: GRAVITY } });
  world.createBody().createFixture(new Chain(track.points, false), { friction: 0.9, userData: "ground" });
  const bike = new Bike(world, { x: track.startX, y: groundY(track, track.startX) });
  let crashed = false;
  const onContact = (delta: number) => (c: any) => {
    const a = c.getFixtureA().getUserData() as FixtureTag;
    const b = c.getFixtureB().getUserData() as FixtureTag;
    if (a !== "ground" && b !== "ground") return;
    const o = a === "ground" ? b : a;
    if (o === "wheel-rear") bike.rearContacts += delta;
    else if (o === "wheel-front") bike.frontContacts += delta;
    else if (o === "rider" && delta > 0) crashed = true;
  };
  world.on("begin-contact", onContact(1));
  world.on("end-contact", onContact(-1));

  let t = 0;
  let maxV = 0;
  let maxAir = 0;
  let air = 0;
  while (t < 120) {
    bike.apply(policy(bike, track), DT);
    world.step(DT, 8, 3);
    t += DT;
    const p = bike.chassis.getPosition();
    maxV = Math.max(maxV, bike.chassis.getLinearVelocity().x);
    air = bike.grounded ? 0 : air + DT;
    maxAir = Math.max(maxAir, air);
    if (TRACE && Math.round(t * 120) % 30 === 0)
      console.log(
        `  t=${t.toFixed(2)} x=${p.x.toFixed(1)} y=${p.y.toFixed(2)} v=${(bike.speed * 3.6).toFixed(0)} ` +
          `ang=${((bike.chassis.getAngle() * 180) / Math.PI).toFixed(0)} ground=${bike.rearContacts}${bike.frontContacts}`,
      );
    if (crashed || p.y < -40) return `CRASH x=${p.x.toFixed(1)}/${track.finishX.toFixed(0)} t=${t.toFixed(2)} vmax=${(maxV * 3.6).toFixed(0)}km/h`;
    if (p.x >= track.finishX) return `FINISH t=${t.toFixed(2)} vmax=${(maxV * 3.6).toFixed(0)}km/h maxAir=${maxAir.toFixed(2)}s`;
  }
  return `TIMEOUT x=${bike.chassis.getPosition().x.toFixed(1)}`;
}

const names = process.argv[2] ? [process.argv[2]] : Object.keys(policies);
const tracks = process.argv[3] ? [TRACKS[Number(process.argv[3]) - 1]] : TRACKS;
for (const name of names)
  for (const track of tracks) console.log(`${name.padEnd(6)} ${track.name.padEnd(16)} ${run(track, policies[name])}`);
