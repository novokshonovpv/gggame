// Bike silhouette after the BSE T5 (KTM-geometry enduro, 21/18 wheels, USD fork,
// air-cooled 300cc single). Points were traced in pixels from a side photo
// (1600x1072, bike facing right) and are mapped to chassis space in meters by matching
// the photo's axle-to-axle distance to the physics wheelbase. Both renderers draw from this.

import { BIKE } from "./bike.ts";

const REAR_AXLE: [number, number] = [235, 790];
const FRONT_AXLE: [number, number] = [1342, 775];
const S = (BIKE.frontAnchor.x - BIKE.rearAnchor.x) / (FRONT_AXLE[0] - REAR_AXLE[0]); // m per px
const CX = (REAR_AXLE[0] + FRONT_AXLE[0]) / 2;
const CY = (REAR_AXLE[1] + FRONT_AXLE[1]) / 2;

export type Pt2 = [number, number];

// Photo pixel -> chassis-local meters (x forward, y up; axles sit at y = rearAnchor.y).
export const T = (px: number, py: number): Pt2 => [(px - CX) * S, (CY - py) * S + BIKE.rearAnchor.y];
const poly = (...p: number[]) => {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 2) out.push(...T(p[i], p[i + 1]));
  return out;
};

export type Role = "plastic" | "plasticDark" | "accent" | "seat" | "engine" | "fins" | "skid" | "mask" | "light";

export interface Panel {
  role: Role;
  pts: number[]; // flat x,y list in chassis meters
  depth: number; // 3D thickness across the bike, meters
}

// Back to front, so later panels overlap earlier ones in 2D.
export const PANELS: Panel[] = [
  { role: "engine", depth: 0.26, pts: poly(700, 620, 800, 600, 960, 610, 1000, 680, 990, 780, 930, 840, 760, 845, 700, 780) },
  { role: "fins", depth: 0.24, pts: poly(830, 470, 985, 470, 1005, 615, 845, 625) },
  { role: "skid", depth: 0.24, pts: poly(720, 835, 960, 828, 995, 790, 1000, 860, 725, 872) },
  { role: "plastic", depth: 0.2, pts: poly(40, 322, 270, 338, 330, 362, 430, 374, 330, 398, 60, 338) }, // rear fender
  { role: "plastic", depth: 0.3, pts: poly(300, 358, 705, 352, 712, 470, 655, 560, 560, 522, 420, 440) }, // side panel
  { role: "accent", depth: 0.32, pts: poly(330, 380, 640, 372, 600, 410, 420, 420) }, // side panel graphic
  { role: "plastic", depth: 0.4, pts: poly(870, 345, 930, 300, 990, 285, 1062, 330, 1098, 385, 1088, 470, 1052, 522, 990, 505, 930, 470, 720, 470, 705, 400, 880, 360) }, // tank + shrouds
  { role: "accent", depth: 0.42, pts: poly(760, 418, 1040, 392, 1072, 430, 1046, 468, 960, 455, 780, 455) }, // shroud graphic
  { role: "seat", depth: 0.24, pts: poly(255, 332, 880, 326, 908, 345, 880, 360, 300, 362) },
  { role: "plastic", depth: 0.15, pts: poly(1160, 392, 1290, 372, 1420, 385, 1535, 412, 1500, 423, 1330, 405, 1190, 420) }, // front fender
  { role: "mask", depth: 0.2, pts: poly(1095, 215, 1150, 190, 1195, 240, 1215, 350, 1185, 385, 1130, 375, 1105, 300) }, // headlight mask
  { role: "light", depth: 0.22, pts: poly(1150, 252, 1184, 262, 1194, 320, 1160, 330) },
];

export interface Tube {
  a: Pt2;
  b: Pt2;
  r: number; // radius, meters
  role: "frame" | "chrome" | "muffler" | "shock";
  z: number[]; // one tube per listed z offset
}

export const TUBES: Tube[] = [
  { a: T(1075, 300), b: T(1012, 560), r: 0.022, role: "frame", z: [0] }, // down tube
  { a: T(1012, 560), b: T(990, 800), r: 0.02, role: "frame", z: [-0.07, 0.07] }, // cradle
  { a: T(1062, 330), b: T(705, 470), r: 0.022, role: "frame", z: [-0.08, 0.08] }, // backbone
  { a: T(705, 470), b: T(652, 640), r: 0.022, role: "frame", z: [-0.09, 0.09] }, // to swingarm pivot
  { a: T(705, 470), b: T(330, 372), r: 0.014, role: "frame", z: [-0.09, 0.09] }, // subframe
  { a: T(660, 470), b: T(703, 608), r: 0.028, role: "shock", z: [0] },
  { a: T(1003, 632), b: T(978, 700), r: 0.018, role: "chrome", z: [0.13] }, // header
  { a: T(978, 700), b: T(760, 655), r: 0.018, role: "chrome", z: [0.15] },
  { a: T(760, 655), b: T(640, 592), r: 0.02, role: "chrome", z: [0.16] },
  { a: T(640, 592), b: T(225, 412), r: 0.046, role: "muffler", z: [0.16] },
];

export const POINTS = {
  pivot: T(652, 640), // swingarm pivot
  crown: T(1088, 238), // top triple clamp
  lowerClamp: T(1118, 330),
  bar: T(1052, 182), // handlebar clamp
  grip: T(1040, 192),
  peg: T(700, 745),
  tail: T(40, 322),
};

export const WHEEL_R = { rear: 0.335, front: 0.355 }; // 18" and 21" with knobbies
