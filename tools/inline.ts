// Packs the Vite build into one self-contained page for sharing: `npm run build:share`.
// The output is page content only (title, styles, markup, script): the host adds the document skeleton.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const html = readFileSync(join(dist, "index.html"), "utf8");

const asset = (re: RegExp) => {
  const m = html.match(re);
  if (!m) throw new Error(`not found in dist/index.html: ${re}`);
  return readFileSync(join(dist, m[1]), "utf8");
};
const js = asset(/<script[^>]*src="\/?([^"]+\.js)"/);
const css = asset(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+\.css)"/);
const title = html.match(/<title>(.*?)<\/title>/)![1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, "").trim();

const page = [
  `<title>${title}</title>`,
  `<style>\n${css}\n</style>`,
  body,
  `<script type="module">\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`,
  "",
].join("\n");

writeFileSync(join(dist, "share.html"), page);
console.log(`dist/share.html ${(page.length / 1024).toFixed(1)} KB`);
