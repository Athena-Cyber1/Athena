const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
const out =
  "/** docs/index.html exact bytes (LF) — served on GET / for Pages parity. */\n" +
  "export const PAGES_INDEX_HTML = `" +
  html +
  "`;\n";
fs.writeFileSync(path.join(root, "src", "lib", "pages-index-html.ts"), out);
console.log("regenerated pages-index-html.ts len=" + out.length);
