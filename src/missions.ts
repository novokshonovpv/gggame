import type { Bike } from "./bike.ts";
import { type BikeClass, DIFFICULTIES, bikeSpec } from "./catalog.ts";

// Five challenges per race, MSM3 style: a place, a time and three tricks picked per track.
// Each earns a star once per difficulty level; the targets grow with the level.
export type Mission =
  | { kind: "wheelie"; seconds: number }
  | { kind: "backflips"; count: number }
  | { kind: "frontflips"; count: number }
  | { kind: "air"; seconds: number }
  | { kind: "speed"; kmh: number }
  | { kind: "place"; place: number }
  | { kind: "time"; seconds: number }
  | { kind: "clean" };

type Trick = "wheelie" | "backflips" | "frontflips" | "air" | "speed" | "clean";

// Autopilot reference on the stock 250 (tools/pars.ts): race time, top speed, longest air.
const REF: Record<string, { par: number; vmax: number; air: number; tricks: [Trick, Trick, Trick] }> = {
  forest: { par: 90, vmax: 76, air: 2.46, tricks: ["backflips", "air", "wheelie"] },
  smolensk: { par: 28, vmax: 73, air: 2.68, tricks: ["wheelie", "clean", "air"] },
  city: { par: 55, vmax: 71, air: 2.62, tricks: ["wheelie", "backflips", "speed"] },
  minsk: { par: 55, vmax: 75, air: 2.26, tricks: ["backflips", "speed", "clean"] },
  snow: { par: 70, vmax: 75, air: 2.64, tricks: ["air", "clean", "frontflips"] },
  voronezh: { par: 31.5, vmax: 66, air: 2.39, tricks: ["air", "wheelie", "clean"] },
  dunes: { par: 44, vmax: 76, air: 2.31, tricks: ["air", "speed", "wheelie"] },
  nizhny: { par: 35, vmax: 76, air: 2.53, tricks: ["wheelie", "backflips", "frontflips"] },
  stadium: { par: 92, vmax: 76, air: 2.07, tricks: ["backflips", "clean", "frontflips"] },
  novosibirsk: { par: 70, vmax: 76, air: 2.31, tricks: ["air", "clean", "speed"] },
  volcano: { par: 39, vmax: 72, air: 2.34, tricks: ["backflips", "frontflips", "air"] },
  grozny: { par: 35.5, vmax: 75, air: 2.82, tricks: ["air", "speed", "backflips"] },
  vladivostok: { par: 35, vmax: 79, air: 2.97, tricks: ["backflips", "clean", "air"] },
};

const WHEELIE = [2, 3, 4, 6, 8];
const BACKFLIPS = [1, 1, 2, 3, 4];
const FRONTFLIPS = [1, 1, 1, 2, 3];
const AIR = [0.55, 0.7, 0.82, 0.92, 1.02];
const SPEED = [0.72, 0.8, 0.88, 0.95, 1.0];

export function missionsFor(trackId: string, diff: number, cls: BikeClass): Mission[] {
  const ref = REF[trackId];
  if (!ref) return [];
  const d = DIFFICULTIES[diff];
  const bike = bikeSpec(cls);
  const trick = (t: Trick): Mission => {
    switch (t) {
      case "wheelie":
        return { kind: "wheelie", seconds: WHEELIE[diff] };
      case "backflips":
        return { kind: "backflips", count: BACKFLIPS[diff] };
      case "frontflips":
        return { kind: "frontflips", count: FRONTFLIPS[diff] };
      case "air":
        return { kind: "air", seconds: Math.round(ref.air * AIR[diff] * 10) / 10 };
      case "speed":
        return { kind: "speed", kmh: Math.round(ref.vmax * SPEED[diff] * bike.power ** 0.7) };
      case "clean":
        return { kind: "clean" };
    }
  };
  return [{ kind: "place", place: d.place }, { kind: "time", seconds: Math.ceil(ref.par * d.time * bike.timeFactor) }, ...ref.tricks.map(trick)];
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export function missionText(m: Mission): string {
  switch (m.kind) {
    case "wheelie":
      return `Вилли ${m.seconds} ${plural(m.seconds, "секунду", "секунды", "секунд")}`;
    case "backflips":
      return m.count === 1 ? "Сделай бэкфлип" : `Сделай ${m.count} ${plural(m.count, "бэкфлип", "бэкфлипа", "бэкфлипов")}`;
    case "frontflips":
      return m.count === 1 ? "Сделай фронтфлип" : `Сделай ${m.count} ${plural(m.count, "фронтфлип", "фронтфлипа", "фронтфлипов")}`;
    case "air":
      return `Пролети ${String(m.seconds).replace(".", ",")} с в одном прыжке`;
    case "speed":
      return `Разгонись до ${m.kmh} км/ч`;
    case "place":
      return m.place === 1 ? "Выиграй гонку" : m.place === 2 ? "Финишируй вторым или выше" : "Финишируй в тройке";
    case "time":
      return `Финишируй быстрее ${Math.floor(m.seconds / 60)}:${String(m.seconds % 60).padStart(2, "0")}`;
    case "clean":
      return "Проедь без падений";
  }
}

// Watches the player's bike during a race and reports missions as they complete.
export class MissionTracker {
  done: boolean[];
  wheelie = 0;
  bestWheelie = 0;
  air = 0;
  bestAir = 0;
  spin = 0; // rotation accumulated during the current jump, radians
  backflips = 0;
  frontflips = 0;
  topSpeed = 0; // km/h
  crashes = 0;
  missions: Mission[];
  private onDone: (i: number) => void;

  constructor(missions: Mission[], already: boolean[], onDone: (i: number) => void) {
    this.missions = missions;
    this.onDone = onDone;
    this.done = missions.map((_, i) => already[i] ?? false);
  }

  private complete(i: number) {
    if (this.done[i]) return;
    this.done[i] = true;
    this.onDone(i);
  }

  step(bike: Bike, dt: number) {
    const c = bike.chassis;
    if (bike.rearContacts > 0 && bike.frontContacts === 0 && c.getAngle() > 0.15) this.wheelie += dt;
    else this.wheelie = 0;
    this.bestWheelie = Math.max(this.bestWheelie, this.wheelie);
    this.topSpeed = Math.max(this.topSpeed, c.getLinearVelocity().x * 3.6);

    if (!bike.grounded) {
      this.air += dt;
      this.spin += c.getAngularVelocity() * dt;
    } else {
      // A flip counts once the bike is back on its wheels (a crash resets via crashed()).
      // Rotating counterclockwise (nose up) is a backflip, clockwise a frontflip.
      const back = Math.floor((this.spin + 0.6) / (Math.PI * 2));
      const front = Math.floor((-this.spin + 0.6) / (Math.PI * 2));
      if (back > 0) this.backflips += back;
      if (front > 0) this.frontflips += front;
      this.spin = 0;
      this.air = 0;
    }
    this.bestAir = Math.max(this.bestAir, this.air);

    this.missions.forEach((m, i) => {
      if (m.kind === "wheelie" && this.bestWheelie >= m.seconds) this.complete(i);
      if (m.kind === "air" && this.bestAir >= m.seconds) this.complete(i);
      if (m.kind === "backflips" && this.backflips >= m.count) this.complete(i);
      if (m.kind === "frontflips" && this.frontflips >= m.count) this.complete(i);
      if (m.kind === "speed" && this.topSpeed >= m.kmh) this.complete(i);
    });
  }

  crashed() {
    this.crashes++;
    this.spin = 0;
    this.air = 0;
    this.wheelie = 0;
  }

  finished(place: number, time: number) {
    this.missions.forEach((m, i) => {
      if (m.kind === "place" && place <= m.place) this.complete(i);
      if (m.kind === "time" && time <= m.seconds) this.complete(i);
      if (m.kind === "clean" && this.crashes === 0) this.complete(i);
    });
  }

  // Short live progress for the HUD, e.g. "1.4 / 3 с".
  progress(i: number): string {
    const m = this.missions[i];
    if (this.done[i]) return "";
    switch (m.kind) {
      case "wheelie":
        return `${this.bestWheelie.toFixed(1)} / ${m.seconds} с`;
      case "air":
        return `${this.bestAir.toFixed(1)} / ${m.seconds} с`;
      case "backflips":
        return `${this.backflips} / ${m.count}`;
      case "frontflips":
        return `${this.frontflips} / ${m.count}`;
      case "speed":
        return `${Math.round(this.topSpeed)} / ${m.kmh}`;
      case "clean":
        return this.crashes ? "не выполнено" : "";
      default:
        return "";
    }
  }
}
