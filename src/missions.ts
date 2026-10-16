import type { Bike } from "./bike.ts";

// Per-track challenges, MSM3 style: three per track, each earns a star once.
export type Mission =
  | { kind: "wheelie"; seconds: number }
  | { kind: "backflips"; count: number }
  | { kind: "air"; seconds: number }
  | { kind: "place"; place: number }
  | { kind: "time"; seconds: number }
  | { kind: "clean" };

export const MISSIONS: Record<string, Mission[]> = {
  canyon: [
    { kind: "wheelie", seconds: 3 },
    { kind: "air", seconds: 2 },
    { kind: "place", place: 3 },
  ],
  forest: [
    { kind: "backflips", count: 1 },
    { kind: "clean" },
    { kind: "time", seconds: 110 },
  ],
  city: [
    { kind: "wheelie", seconds: 5 },
    { kind: "backflips", count: 2 },
    { kind: "place", place: 1 },
  ],
  snow: [
    { kind: "air", seconds: 2.5 },
    { kind: "clean" },
    { kind: "place", place: 3 },
  ],
  dunes: [
    { kind: "air", seconds: 3 },
    { kind: "wheelie", seconds: 4 },
    { kind: "time", seconds: 65 },
  ],
  stadium: [
    { kind: "backflips", count: 2 },
    { kind: "clean" },
    { kind: "place", place: 1 },
  ],
  volcano: [
    { kind: "place", place: 3 },
    { kind: "backflips", count: 3 },
    { kind: "time", seconds: 58 },
  ],
};

export function missionText(m: Mission): string {
  switch (m.kind) {
    case "wheelie":
      return `Вилли ${m.seconds} секунд${m.seconds === 1 ? "у" : m.seconds < 5 ? "ы" : ""}`;
    case "backflips":
      return m.count === 1 ? "Сделай бэкфлип" : `Сделай ${m.count} бэкфлипа`;
    case "air":
      return `Пролети ${String(m.seconds).replace(".", ",")} секунды в одном прыжке`;
    case "place":
      return m.place === 1 ? "Выиграй гонку" : `Финишируй в тройке`;
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

    if (!bike.grounded) {
      this.air += dt;
      this.spin += c.getAngularVelocity() * dt;
    } else {
      // A flip counts once the bike is back on its wheels (a crash resets via crashed()).
      const flips = Math.floor((this.spin + 0.6) / (Math.PI * 2));
      if (flips > 0) this.backflips += flips;
      this.spin = 0;
      this.air = 0;
    }
    this.bestAir = Math.max(this.bestAir, this.air);

    this.missions.forEach((m, i) => {
      if (m.kind === "wheelie" && this.bestWheelie >= m.seconds) this.complete(i);
      if (m.kind === "air" && this.bestAir >= m.seconds) this.complete(i);
      if (m.kind === "backflips" && this.backflips >= m.count) this.complete(i);
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
      case "clean":
        return this.crashes ? "не выполнено" : "";
      default:
        return "";
    }
  }
}
