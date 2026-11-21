// The bike radio: three stations of real recorded music. Like a real radio, each station
// is "on air" all the time: tuning in drops you into the middle of whatever it is playing
// now. Switching stations hisses with static. It only plays while riding.
//
// Music: Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution
// 4.0 (https://creativecommons.org/licenses/by/4.0/). Files are in public/radio, re-encoded
// to 64 kbps AAC and loudness-matched; titles are listed in README.md.

export interface Track {
  file: string;
  title: string;
  len: number; // seconds
}

export interface Station {
  name: string;
  genre: string;
  tracks: Track[];
}

export const STATIONS: Station[] = [
  {
    name: "Мото FM",
    genre: "рок",
    tracks: [
      { file: "rocket-power.m4a", title: "Rocket Power", len: 153.6 },
      { file: "organic-grunge.m4a", title: "Organic Grunge", len: 209.1 },
      { file: "surf-shimmy.m4a", title: "Surf Shimmy", len: 122.9 },
    ],
  },
  {
    name: "Ночной город",
    genre: "электроника",
    tracks: [
      { file: "brain-dance.m4a", title: "Brain Dance", len: 215 },
      { file: "ouroboros.m4a", title: "Ouroboros", len: 161.6 },
      { file: "exit-the-premises.m4a", title: "Exit the Premises", len: 210.1 },
    ],
  },
  {
    name: "Радио Грув",
    genre: "фанк",
    tracks: [
      { file: "funky-chunk.m4a", title: "Funky Chunk", len: 239.1 },
      { file: "loopster.m4a", title: "Loopster", len: 182.3 },
      { file: "twisted.m4a", title: "Twisted", len: 187.2 },
    ],
  },
];

export const MUSIC_CREDIT = "Музыка: Kevin MacLeod (incompetech.com), лицензия CC BY 4.0";

const BASE = new URL("radio/", document.baseURI).href;

export class Radio {
  private ctx: AudioContext;
  private el: HTMLAudioElement;
  private out: GainNode;
  private noise: AudioBuffer;
  private dest: AudioNode;
  index: number; // -1 = off
  private on = false;
  private trackNo = -1;
  private epoch: number; // the stations' broadcast clock starts here
  private wantSeek = -1;
  onTrack: ((station: Station, track: Track) => void) | null = null;

  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, index: number) {
    this.ctx = ctx;
    this.noise = noise;
    this.dest = dest;
    this.index = index;
    // Each session the stations are somewhere else in their playlists.
    this.epoch = Date.now() / 1000 - Math.random() * 3600;
    this.el = new Audio();
    this.el.preload = "none";
    this.el.crossOrigin = "anonymous";
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // Radio colour: no rumble, a softened top.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 70;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 12000;
    try {
      ctx.createMediaElementSource(this.el).connect(hp);
    } catch {
      /* already wired */
    }
    hp.connect(lp).connect(this.out).connect(dest);
    this.el.addEventListener("ended", () => {
      // Next song on the same station.
      this.trackNo = -1;
      if (this.on) this.tune(false);
    });
    this.el.addEventListener("loadedmetadata", () => {
      if (this.wantSeek >= 0) {
        try {
          this.el.currentTime = Math.min(this.wantSeek, Math.max(0, this.el.duration - 1));
        } catch {
          /* play from the top */
        }
        this.wantSeek = -1;
      }
    });
    // Mobile browsers let a media element play later only if it first played in a tap.
    const bless = () => {
      this.el.muted = true;
      void this.el
        .play()
        .then(() => {
          this.el.pause();
          this.el.muted = false;
        })
        .catch(() => (this.el.muted = false));
      window.removeEventListener("pointerdown", bless);
      window.removeEventListener("keydown", bless);
    };
    window.addEventListener("pointerdown", bless);
    window.addEventListener("keydown", bless);
  }

  get station() {
    return this.index >= 0 ? STATIONS[this.index] : null;
  }

  get name() {
    const s = this.station;
    return s ? `${s.name} — ${s.genre}` : "Радио выключено";
  }

  get nowPlaying() {
    const s = this.station;
    return s && this.trackNo >= 0 ? s.tracks[this.trackNo] : null;
  }

  // Where the station is in its playlist right now.
  private live(s: Station) {
    const total = s.tracks.reduce((a, t) => a + t.len, 0);
    let pos = (Date.now() / 1000 - this.epoch + (this.index + 1) * 977) % total;
    for (let i = 0; i < s.tracks.length; i++) {
      if (pos < s.tracks[i].len) return { i, at: pos };
      pos -= s.tracks[i].len;
    }
    return { i: 0, at: 0 };
  }

  // step: +1 next station, -1 previous (off sits between the last and the first).
  cycle(step = 1) {
    const n = STATIONS.length + 1;
    this.index = ((this.index + 1 + step + n) % n) - 1;
    this.static();
    this.trackNo = -1;
    if (this.on) this.tune(true);
    else this.el.pause();
    if (!this.station) this.el.pause();
    this.fade();
    return this.name;
  }

  setPlaying(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on && this.station) this.tune(true);
    if (!on) {
      // Fade out, then stop downloading.
      window.setTimeout(() => {
        if (!this.on) this.el.pause();
      }, 600);
    }
    this.fade();
  }

  private fade() {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.on && this.station ? 0.55 : 0, t, this.on ? 0.25 : 0.12);
  }

  // Start the station's current song from where the broadcast is.
  private tune(live: boolean) {
    const s = this.station;
    if (!s) return;
    const { i, at } = live ? this.live(s) : { i: (this.lastTrack + 1) % s.tracks.length, at: 0 };
    const tr = s.tracks[i];
    if (this.trackNo !== i || this.el.paused) {
      this.trackNo = i;
      this.lastTrack = i;
      const src = BASE + tr.file;
      if (this.el.src !== src) {
        this.el.src = src;
        this.wantSeek = at;
        this.el.load();
      } else {
        try {
          this.el.currentTime = at;
        } catch {
          this.wantSeek = at;
        }
      }
      void this.el.play().catch(() => {
        /* blocked until the next tap */
      });
      this.onTrack?.(s, tr);
    }
  }
  private lastTrack = -1;

  // A burst of tuning static.
  private static() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2500;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.on ? 0.12 : 0, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(f).connect(g).connect(this.dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.5);
  }

  dispose() {
    this.el.pause();
  }
}
