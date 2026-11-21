// Copies only the files the site needs into dist/ so nothing else (scripts, .git, .claude) is ever deployed.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const FILES = ["index.html", "styles.css", "app.js"];
const DATA = ["sops.json", "drafts.json", "labels.json", "review.json", "eval.json", "rules.json"];

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, "data"), { recursive: true });
for (const f of FILES) await cp(path.join(ROOT, f), path.join(DIST, f));
for (const f of DATA) await cp(path.join(ROOT, "data", f), path.join(DIST, "data", f));
console.log(`dist/ ready: ${FILES.length} site files + ${DATA.length} data files`);
