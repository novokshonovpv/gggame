// Full screen on phones. Android browsers (and iPad Safari) can hide their bars through the
// Fullscreen API; iPhone browsers and in-app browsers (Telegram, VK, ...) can't, so there the
// way is to install the game to the home screen, which launches it without browser bars.

type WebkitDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as WebkitDoc;

export const isTouch = () => matchMedia("(pointer: coarse)").matches;

export const isInstalled = () =>
  matchMedia("(display-mode: fullscreen)").matches ||
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isFullscreen = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);

export function onFullscreenChange(fn: () => void) {
  document.addEventListener("fullscreenchange", fn);
  document.addEventListener("webkitfullscreenchange", fn);
}

// True when the browser went full screen; false means show the install help instead.
export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as WebkitEl;
  let request: Promise<void> | void;
  if (document.fullscreenEnabled && el.requestFullscreen) request = el.requestFullscreen({ navigationUI: "hide" });
  else if (doc.webkitFullscreenEnabled && el.webkitRequestFullscreen) request = el.webkitRequestFullscreen();
  else return false;
  // Some embedded browsers never settle the request; don't leave the player waiting.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
  try {
    await Promise.race([request, timeout]);
  } catch {
    return false;
  }
  if (!isFullscreen()) return false;
  try {
    // Not every browser can lock orientation; the game still works if it can't.
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    /* fine */
  }
  return true;
}

export function installHelp(): { text: string; steps: string[] } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios)
    return {
      text: "На iPhone браузер не даёт сайтам прятать свои панели. Но игру можно поставить на экран «Домой» — оттуда она запускается на весь экран, как приложение.",
      steps: [
        "Если ссылка открыта внутри Telegram или другого приложения — сначала открой её в Safari (значок компаса внизу или «⋯» → «Открыть в Safari»).",
        "В Safari нажми «Поделиться» — квадрат со стрелкой вверх.",
        "Выбери «На экран „Домой“» и нажми «Добавить».",
        "Запускай Moto Trials с новой иконки на экране.",
      ],
    };
  return {
    text: "Этот браузер не умеет переходить в полноэкранный режим. Игру можно установить на главный экран — так она запускается без панелей браузера.",
    steps: [
      "Если ссылка открыта внутри Telegram или другого приложения — открой её в Chrome (меню «⋮» → «Открыть в браузере»).",
      "В Chrome нажми «⋮» → «Добавить на главный экран» или «Установить приложение».",
      "Запускай Moto Trials с иконки на главном экране.",
    ],
  };
}
