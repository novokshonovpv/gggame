// Packs the Vite build into a page for sharing as a claude.ai artifact: `npm run build:share`.
// The output is page content only (title, styles, markup, script tag): the host adds the
// document skeleton. Styles are inlined; the scripts stay files (publish dist/assets/*.js
// next to the page as assets/...), because the lazily loaded chunks (open world, cloud)
// import the main chunk by name and must find the very same module.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const html = readFileSync(join(dist, "index.html"), "utf8");

const ref = (re: RegExp) => {
  const m = html.match(re);
  if (!m) throw new Error(`not found in dist/index.html: ${re}`);
  return m[1].replace(/^\.?\//, "");
};
const js = ref(/<script[^>]*src="([^"]+\.js)"/);
// The CSS moves from assets/ into the page, so its relative urls (fonts) gain the folder.
const css = readFileSync(join(dist, ref(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"/)), "utf8").replace(/url\(\.\//g, "url(assets/");
const title = html.match(/<title>(.*?)<\/title>/)![1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, "").trim();

const page = [`<title>${title}</title>`, `<style>\n${css}\n</style>`, body, `<script type="module" src="${js}"></script>`, ""].join("\n");

writeFileSync(join(dist, "share.html"), page);
console.log(`dist/share.html ${(page.length / 1024).toFixed(1)} KB, script ${js}`);
