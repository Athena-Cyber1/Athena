const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "design");
const targets = [path.join(root, "docs", "design"), path.join(root, "public", "design")];

const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile());
let copied = 0;
let drift = 0;

for (const t of targets) {
  fs.mkdirSync(t, { recursive: true });
  for (const f of files) {
    const a = fs.readFileSync(path.join(src, f));
    const b = path.join(t, f);
    const exists = fs.existsSync(b);
    const same = exists && fs.readFileSync(b).equals(a);
    if (!same) {
      fs.writeFileSync(b, a);
      copied++;
      console.log("synced " + path.relative(root, b));
    }
    // report extra files in mirror that are not in source
  }
  for (const f of fs.readdirSync(t)) {
    if (!files.includes(f)) {
      console.log("EXTRA in mirror (not in design/): " + path.relative(root, path.join(t, f)));
      drift++;
    }
  }
}

console.log("sync-design: " + files.length + " files × " + targets.length + " mirrors, " + copied + " updated, " + drift + " extras");
if (drift) process.exitCode = 1;
