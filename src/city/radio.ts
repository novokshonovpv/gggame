// The bike radio: three stations of music composed on the fly with Web Audio (no recordings,
// nothing to license). Each station has its own tempo, drums, bass, chords and a lead line;
// the melody is generated from the station's scale and changes every few minutes ("next
// song"). It plays only while riding, like a car radio.

export interface Station {
  name: string;
  bpm: number;
  swing: number;
  root: number; // MIDI note of the key
  scale: number[];
  chords: number[][]; // progression: scale-degree triads, one per bar
  build: (r: Radio, step: number, bar: number, t: number, s: number) => void; // s = 16th length
}

const mtof = (n: number) => 440 * 2 ** ((n - 69) / 12);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Radio {
  ctx: AudioContext;
  out: GainNode;
  private bus: GainNode;
  private echo: DelayNode;
  private noise: AudioBuffer;
  private drive: WaveShaperNode;
  private next = 0;
  private step = 0;
  private timer = 0;
  index: number; // -1 = off
  private on = false;
  private melody: number[] = [];
  private song = 0;

  static readonly STATIONS: Station[] = [
    {
      name: "Мото FM — рок",
      bpm: 132,
      swing: 0,
      root: 40, // E
      scale: [0, 2, 3, 5, 7, 8, 10],
      chords: [[0], [5], [2], [6]], // E C G D (power chords on the degree)
      build: (r, st, bar, t, s) => {
        const deg = Radio.STATIONS[0].chords[bar % 4][0];
        const root = r.note(0, deg);
        if (st % 8 === 0 || st === 10) r.kick(t, 0.9);
        if (st % 8 === 4) r.snare(t, 0.7);
        if (st % 2 === 0) r.hat(t, 0.25, st % 4 === 2);
        if (st % 2 === 0) r.guitar(t, root + 12, s * 1.7, st % 8 === 0 ? 0.32 : 0.2);
        if (st % 2 === 0) r.bass(t, root - 12, s * 1.6, 0.42, "sawtooth", 700);
        if (bar % 8 >= 4) r.leadStep(t, st, s, "sawtooth", 0.08, 2400, 24);
      },
    },
    {
      name: "Ночной город — синтвейв",
      bpm: 100,
      swing: 0,
      root: 45, // A
      scale: [0, 2, 3, 5, 7, 8, 10],
      chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3]], // Am F C G
      build: (r, st, bar, t, s) => {
        const ch = Radio.STATIONS[1].chords[bar % 4];
        if (st % 4 === 0) r.kick(t, 0.75);
        if (st % 8 === 4) r.snare(t, 0.55, true);
        if (st % 2 === 1) r.hat(t, 0.12, false);
        if (st === 0) r.pad(t, ch.map((d) => r.note(1, d) + 12), s * 16, 0.09);
        if (st % 2 === 0) r.bass(t, r.note(1, ch[0]) - 12 + (st % 4 === 2 ? 12 : 0), s * 1.5, 0.38, "sawtooth", 500);
        r.arp(t, r.note(1, ch[st % 3]) + 24 + (st % 6 >= 3 ? 12 : 0), s * 0.9, 0.045);
        if (bar % 8 >= 4) r.leadStep(t, st, s, "square", 0.05, 1800, 24);
      },
    },
    {
      name: "Ретро 8-бит",
      bpm: 146,
      swing: 0.08,
      root: 48, // C
      scale: [0, 2, 4, 5, 7, 9, 11],
      chords: [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 0]], // C G Am F
      build: (r, st, bar, t, s) => {
        const ch = Radio.STATIONS[2].chords[bar % 4];
        if (st % 8 === 0) r.kick(t, 0.6);
        if (st % 8 === 4) r.chipNoise(t, 0.3, 0.09);
        if (st % 2 === 0) r.chipNoise(t, 0.08, 0.02);
        r.bass(t, r.note(2, ch[st % 4 === 2 ? 2 : 0]) - 12, s * 0.9, 0.3, "triangle", 2000);
        r.arp(t, r.note(2, ch[st % 3]) + 12, s * 0.5, 0.03, "square");
        r.leadStep(t, st, s, "square", 0.06, 6000, 24);
      },
    },
  ];

  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, index: number) {
    this.ctx = ctx;
    this.noise = noise;
    this.index = index;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // A touch of "speaker": no deep sub, soft top.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 45;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 9000;
    this.bus = ctx.createGain();
    this.echo = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.bus);
    this.bus.connect(hp).connect(lp).connect(this.out);
    this.out.connect(dest);
    this.drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 6) * 0.6;
    }
    this.drive.curve = curve;
    const cab = ctx.createBiquadFilter();
    cab.type = "lowpass";
    cab.frequency.value = 2600;
    cab.Q.value = 1.2;
    this.drive.connect(cab).connect(this.bus);
    this.newSong();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  get station() {
    return this.index >= 0 ? Radio.STATIONS[this.index] : null;
  }

  get name() {
    return this.station?.name ?? "Радио выключено";
  }

  // Next station; after the last one, off.
  cycle() {
    this.index = this.index + 1 >= Radio.STATIONS.length ? -1 : this.index + 1;
    this.step = 0;
    this.newSong();
    this.apply();
    return this.name;
  }

  setPlaying(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.apply();
  }

  private apply() {
    const t = this.ctx.currentTime;
    const st = this.station;
    if (st) this.echo.delayTime.setValueAtTime(Math.min(0.9, (60 / st.bpm) * 0.75), t);
    this.out.gain.setTargetAtTime(this.on && st ? 0.32 : 0, t, this.on ? 0.4 : 0.15);
    if (this.on && st && this.next < t) this.next = t + 0.05;
  }

  // A new melody: two bars of 16ths, a random walk on the scale with rests.
  private newSong() {
    const r = rng(Date.now() + this.song++ * 7919);
    this.melody = [];
    let deg = Math.floor(r() * 5);
    for (let i = 0; i < 32; i++) {
      if (i % 2 === 1 && r() < 0.6) {
        this.melody.push(-1);
        continue;
      }
      if (r() < 0.22) {
        this.melody.push(-1);
        continue;
      }
      deg = Math.max(-2, Math.min(9, deg + Math.floor(r() * 5) - 2));
      this.melody.push(deg);
    }
  }

  note(station: number, degree: number) {
    const st = Radio.STATIONS[station];
    const sc = st.scale;
    const oct = Math.floor(degree / sc.length);
    const d = ((degree % sc.length) + sc.length) % sc.length;
    return st.root + oct * 12 + sc[d];
  }

  private schedule() {
    const st = this.station;
    if (!st || !this.on) return;
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    const s = 60 / st.bpm / 4;
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.15) {
      const st16 = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const t = this.next + (st16 % 2 === 1 ? st.swing * s : 0);
      st.build(this, st16, bar, t, s);
      this.step++;
      // About every three minutes, a new tune.
      if (this.step % (16 * 64) === 0) this.newSong();
      this.next += s;
    }
  }

  // ---------- instruments ----------

  private env(t: number, peak: number, attack: number, dur: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  kick(t: number, v: number) {
    const o = this.osc("sine", 150, t, 0.3);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.env(t, v, 0.003, 0.28)).connect(this.bus);
  }

  snare(t: number, v: number, big = false) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = this.env(t, v * 0.8, 0.002, big ? 0.32 : 0.16);
    n.connect(f).connect(g).connect(this.bus);
    if (big) g.connect(this.echo);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.4);
    this.osc("triangle", 190, t, 0.1).connect(this.env(t, v * 0.4, 0.002, 0.08)).connect(this.bus);
  }

  hat(t: number, v: number, open: boolean) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7500;
    n.connect(f).connect(this.env(t, v * 0.5, 0.001, open ? 0.18 : 0.04)).connect(this.bus);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.25);
  }

  chipNoise(t: number, v: number, dur: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.35; // grainy, like an old sound chip
    n.connect(this.env(t, v, 0.001, dur)).connect(this.bus);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.05);
  }

  bass(t: number, note: number, dur: number, v: number, type: OscillatorType, cutoff: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    f.Q.value = 2;
    this.osc(type, mtof(note), t, dur).connect(f).connect(this.env(t, v * 0.5, 0.005, dur)).connect(this.bus);
  }

  guitar(t: number, note: number, dur: number, v: number) {
    // Power chord: root, fifth, octave, slightly detuned, through the overdrive.
    for (const [iv, det] of [
      [0, -4],
      [7, 3],
      [12, 0],
    ]) {
      const o = this.osc("sawtooth", mtof(note + iv), t, dur);
      o.detune.value = det;
      o.connect(this.env(t, v * 0.35, 0.004, dur)).connect(this.drive);
    }
  }

  pad(t: number, notes: number[], dur: number, v: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1600, t + dur * 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(v * 0.7, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.bus);
    for (const n of notes)
      for (const det of [-9, 9]) {
        const o = this.osc("sawtooth", mtof(n), t, dur);
        o.detune.value = det;
        o.connect(f);
      }
  }

  arp(t: number, note: number, dur: number, v: number, type: OscillatorType = "square") {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 3000;
    const g = this.env(t, v, 0.003, dur);
    this.osc(type, mtof(note), t, dur).connect(f).connect(g).connect(this.bus);
    g.connect(this.echo);
  }

  // One 16th of the current melody.
  leadStep(t: number, st: number, s: number, type: OscillatorType, v: number, cutoff: number, up: number) {
    const bar = Math.floor(this.step / 16);
    const deg = this.melody[(bar % 2) * 16 + st];
    if (deg === undefined || deg < 0) return;
    let len = 1;
    while (len < 4 && this.melody[((bar % 2) * 16 + st + len) % 32] === -1) len++;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = this.env(t, v, 0.008, s * len * 0.95);
    const o = this.osc(type, mtof(this.note(this.index, deg) + up), t, s * len);
    // A little vibrato on long notes.
    if (len > 2) {
      const lfo = this.osc("sine", 5.5, t, s * len);
      const depth = this.ctx.createGain();
      depth.gain.value = 6;
      lfo.connect(depth).connect(o.detune);
    }
    o.connect(f).connect(g).connect(this.bus);
    g.connect(this.echo);
  }

  dispose() {
    window.clearInterval(this.timer);
  }
}
