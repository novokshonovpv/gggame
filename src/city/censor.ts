// A swear filter for the chat and nicknames (Russian and English). Matches are replaced
// with asterisks. It runs on sending and again on showing, so a tampered client cannot
// slip a word past other players. Latin look-alike letters and stretched letters are
// folded before matching ("xyй", "ееебать").

const LOOK: Record<string, string> = {
  a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
  "0": "о", "3": "з", "6": "б", "@": "а", ё: "е",
};

// Russian roots (on the folded, lower-case word).
const RU = [
  /(^|[^а-я])(на|по|от|за|вы|до|при|раз|рас|недо|пере|под|об|о|у|из|ни)?ху[йеиюя]/,
  /пизд/,
  /(^|[^а-я])(за|на|по|от|вы|у|при|до|раз|рас|съ|въ|об|пере|под|про|из|долбо|недо)?е(б|п)(а|у|и|л|ну|н[аыу]|ы|еш|ет|ош|ц)/,
  /долбо?е[бп]/,
  /(^|[^а-я])(вы|за|на|под|от|у|разъ|съ)е[бп]он/,
  /(^|[^а-я])бля([дт]|[^а-я]|$)/,
  /(^|[^а-я])муд(ак|ил|оз|ач)/,
  /(^|[^а-я])манд(а|у|ой|авош|ец)([^а-я]|$)/,
  /г[ао]нд[ао]н/,
  /пид[оа]?р/,
  /залуп/,
  /шлюх/,
  /(^|[^а-я])су(ка|ки|чк|чар)([^а-я]|$)/,
  /дроч/,
  /(^|[^а-я])уеб/,
  /(^|[^а-я])хер(а|ня|ов|ну)/,
  /ублюд/,
  /говн/,
  /(^|[^а-я])жоп/,
];
const EN = [/fuck/, /shit/, /bitch/, /cunt/, /(^|[^a-z])dick/, /asshole/, /motherf/, /nigg/, /whore/, /slut/];

function fold(w: string) {
  let s = w.toLowerCase();
  // Stretched letters: "ееебать" -> "ебать".
  s = s.replace(/(.)\1{2,}/g, "$1");
  return s;
}

function bad(word: string) {
  const low = fold(word);
  if (EN.some((r) => r.test(low))) return true;
  const ru = [...low].map((c) => LOOK[c] ?? c).join("");
  return RU.some((r) => r.test(ru));
}

// The text with any swear word replaced by asterisks.
export function censor(text: string) {
  return text.replace(/[\p{L}\p{N}@*]+/gu, (w) => (bad(w) ? "*".repeat(Math.max(3, w.length)) : w));
}

export const isClean = (text: string) => censor(text) === text;
