import type { Input } from "./bike.ts";

type Action = "gas" | "brake" | "back" | "fwd";

const KEYS: Record<string, Action> = {
  ArrowUp: "gas",
  KeyW: "gas",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "back",
  KeyA: "back",
  ArrowRight: "fwd",
  KeyD: "fwd",
};

// Merges keyboard and on-screen touch buttons into one Input.
export class Controls {
  private keys = new Set<Action>();
  private touches = new Map<number, Action>();

  constructor(onKey: (code: string) => void) {
    // Typing a nickname must not ride the bike (or lose the letters W, A, S, D).
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.("input, textarea") != null;
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      const a = KEYS[e.code];
      if (a) {
        this.keys.add(a);
        e.preventDefault();
      } else if (!e.repeat) onKey(e.code);
    });
    window.addEventListener("keyup", (e) => {
      const a = KEYS[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.touches.clear();
    });

    document.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
      const action = el.dataset.action as Action;
      const release = (e: PointerEvent) => {
        this.touches.delete(e.pointerId);
        el.classList.remove("down");
      };
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.touches.set(e.pointerId, action);
        el.classList.add("down");
      });
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  private has(a: Action) {
    if (this.keys.has(a)) return true;
    for (const t of this.touches.values()) if (t === a) return true;
    return false;
  }

  read(): Input {
    return {
      gas: this.has("gas"),
      brake: this.has("brake"),
      lean: (this.has("back") ? 1 : 0) - (this.has("fwd") ? 1 : 0),
    };
  }
}
