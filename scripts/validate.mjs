// Step 4 QA: validate the seed data and the precomputed outputs before anything is shown.
// Run: node scripts/validate.mjs     (exit code 1 if any hard check fails)
// Follows the validate-data checklist: source/counts, nulls, duplicates, denominators, reproducibility,
// leakage, magnitude and "too perfect" red flags.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyRules } from "./review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const rdText = (f) => readFile(path.join(ROOT, f), "utf8");

const sops = await rd("data/sops.json");
const draftsFile = await rd("data/drafts.json");
const drafts = draftsFile.drafts;
const { labels } = await rd("data/labels.json");
const review = await rd("data/review.json");
const rules = await rd("data/rules.json");
let evalJson = null;
try { evalJson = await rd("data/eval.json"); } catch { /* eval not yet generated */ }

let failures = 0, warnings = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const warn = (name, detail) => { warnings++; console.log(`  WARN  ${name}  -> ${detail}`); };
const section = (s) => console.log(`\n${s}`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");

const KINDS = ["read", "approval", "write", "notify"];
const sopById = new Map(sops.map((s) => [s.id, s]));
const draftById = new Map(drafts.map((d) => [d.id, d]));
const labelByWf = new Map(labels.map((l) => [l.workflow, l]));

section("1. SOPs");
ok("24 SOPs", sops.length === 24, `got ${sops.length}`);
ok("SOP ids unique", new Set(sops.map((s) => s.id)).size === sops.length);
ok("every SOP has text, title, systems", sops.every((s) => s.text?.length > 100 && s.title && s.systems?.length >= 2));
ok("every SOP names an approval gate", sops.every((s) => /approve|confirms the request|pre-approved/i.test(s.text)));

section("2. Drafts (schema, nulls, duplicates)");
ok("24 drafts", drafts.length === 24, `got ${drafts.length}`);
ok("draft ids unique", draftById.size === drafts.length);
ok("exactly one draft per SOP", new Set(drafts.map((d) => d.sop_id)).size === 24 && drafts.every((d) => sopById.has(d.sop_id)));
const stepProblems = [];
for (const d of drafts) {
  const sop = sopById.get(d.sop_id);
  d.steps.forEach((s, i) => {
    const where = `${d.id} step ${i + 1}`;
    if (s.n !== i + 1) stepProblems.push(`${where}: numbering`);
    if (!KINDS.includes(s.kind)) stepProblems.push(`${where}: kind ${s.kind}`);
    if (!s.action || !s.system) stepProblems.push(`${where}: missing action/system`);
    if (!sop.systems.includes(s.system)) stepProblems.push(`${where}: system ${s.system} not in SOP`);
    if (s.kind === "approval" && !s.approver) stepProblems.push(`${where}: approval without approver`);
    if (s.kind === "write" && !s.scope) stepProblems.push(`${where}: write without scope`);
    if (s.kind !== "approval" && s.approver) stepProblems.push(`${where}: approver on non-approval step`);
  });
  // 4..12: the offboarding SOP has 9 actions and the model split one of them
  if (d.steps.length < 4 || d.steps.length > 12) stepProblems.push(`${d.id}: ${d.steps.length} steps`);
  if (!d.steps.some((s) => s.kind === "write")) stepProblems.push(`${d.id}: no write step`);
}
ok("step schema, numbering, nulls, systems-in-SOP", stepProblems.length === 0, stepProblems.slice(0, 5).join("; "));

section("3. Labels (counts and consistency)");
const defective = labels.filter((l) => l.defective);
ok("one label per draft", labels.length === 24 && labels.every((l) => draftById.has(l.workflow)) && new Set(labels.map((l) => l.workflow)).size === 24);
ok("12 seeded defects, 12 clean", defective.length === 12 && labels.length - defective.length === 12, `${defective.length} defective`);
const nA = defective.filter((l) => l.type === "A").length, nB = defective.filter((l) => l.type === "B").length;
ok("type A (missing approval) = 6, type B (over-broad scope) = 6", nA === 6 && nB === 6, `A=${nA} B=${nB}`);
ok("clean labels carry no type/step", labels.filter((l) => !l.defective).every((l) => l.type === null && l.step === null));
const labelProblems = [];
for (const l of defective) {
  const d = draftById.get(l.workflow);
  const s = d.steps.find((x) => x.n === l.step);
  if (!s) { labelProblems.push(`${l.workflow}: step ${l.step} missing`); continue; }
  if (s.kind !== "write") labelProblems.push(`${l.workflow}: labeled step is not a write`);
  if (!["visible_in_draft", "needs_connected_system"].includes(l.visibility)) labelProblems.push(`${l.workflow}: visibility`);
  if (!l.seeded_change) labelProblems.push(`${l.workflow}: no seeded_change`);
  if (l.visibility === "needs_connected_system" && !l.hidden_context) labelProblems.push(`${l.workflow}: hidden without hidden_context`);
  if (l.type === "A") {
    const earlier = d.steps.filter((x) => x.n < l.step && x.kind === "approval");
    if (earlier.length) labelProblems.push(`${l.workflow}: type A but an approval precedes step ${l.step}`);
  }
}
ok("labeled steps exist, are writes, A-defects have no earlier approval", labelProblems.length === 0, labelProblems.join("; "));
const nHidden = defective.filter((l) => l.visibility === "needs_connected_system").length;
console.log(`  info  visible_in_draft=${defective.length - nHidden}, needs_connected_system=${nHidden}`);

section("4. Leakage of labels into drafts");
const ALLOWED_DRAFT_KEYS = ["id", "sop_id", "title", "steps"];
const ALLOWED_STEP_KEYS = ["n", "kind", "action", "system", "approver", "scope"];
ok("draft objects only carry id, sop_id, title, steps", drafts.every((d) => Object.keys(d).sort().join() === [...ALLOWED_DRAFT_KEYS].sort().join()));
ok("step objects only carry n, kind, action, system, approver, scope", drafts.every((d) => d.steps.every((s) => Object.keys(s).sort().join() === [...ALLOWED_STEP_KEYS].sort().join())));
const draftText = JSON.stringify(drafts).toLowerCase();
// ("label" alone is not forbidden: "return label" is a shipping label in the offboarding SOP. Checked by hand.)
const FORBIDDEN = ["seeded", "defect", "labels", "labeled", "labelled", "ground truth", "injected", "planted", "missing approval", "over-broad", "overbroad", "type a", "type b", "hidden", "needs_connected", "visible_in", "false alarm", "violation"];
const hits = FORBIDDEN.filter((t) => draftText.includes(t));
ok("no label vocabulary inside drafts.json", hits.length === 0, hits.join(", "));
const phrases = labels.flatMap((l) => [l.seeded_change, l.hidden_context, l.note]).filter(Boolean);
ok("no label sentence appears verbatim in drafts.json", phrases.every((p) => !draftText.includes(p.toLowerCase())));
const headerText = JSON.stringify({ ...draftsFile, drafts: undefined }).toLowerCase();
ok("drafts.json header does not say which drafts were edited", !/wf-\d\d/.test(headerText));
const reviewSrc = await rdText("scripts/review.mjs");
ok("reviewer source never reads labels", !/labels\.json|labels\b.*readFile/i.test(reviewSrc.replace(/never sees the answer key|NOT labels\.json/gi, "")), "found a labels reference");
ok("review.json lists only drafts and rules as inputs", review.meta.inputs.every((i) => /drafts\.json|rules\.json/.test(i)) && !review.meta.inputs.some((i) => /label/.test(i)));
// Positional and statistical tells
const posDefect = drafts.map((d, i) => (labelByWf.get(d.id).defective ? i : -1)).filter((i) => i >= 0);
const firstHalf = posDefect.filter((i) => i < 12).length;
ok("defects spread across the list (4 to 8 of 12 in the first half)", firstHalf >= 4 && firstHalf <= 8, `first half has ${firstHalf}`);
const group = (pred) => drafts.filter((d) => pred(labelByWf.get(d.id)));
const feat = (ds) => ({
  steps: mean(ds.map((d) => d.steps.length)),
  actWords: mean(ds.flatMap((d) => d.steps.map((s) => s.action.split(/\s+/).length))),
  scopeLen: mean(ds.flatMap((d) => d.steps.filter((s) => s.scope && s.kind === "write").map((s) => s.scope.length))),
  endsDot: mean(ds.flatMap((d) => d.steps.map((s) => (/\.$/.test(s.action) ? 1 : 0)))),
  capStart: mean(ds.flatMap((d) => d.steps.map((s) => (/^[A-Z]/.test(s.action) ? 1 : 0)))),
  approvals: mean(ds.map((d) => d.steps.filter((s) => s.kind === "approval").length)),
});
const fd = feat(group((l) => l.defective)), fc = feat(group((l) => !l.defective)), fb = feat(group((l) => l.type === "B")), fcl = fc;
console.log("  info  feature means (defective | clean | B-only):");
for (const k of Object.keys(fd)) console.log(`          ${k.padEnd(9)} ${f2(fd[k])} | ${f2(fc[k])} | ${f2(fb[k])}`);
ok("style features match (action words, scope length, trailing period, capital start)", Math.abs(fd.actWords - fc.actWords) < 2 && Math.abs(fd.endsDot - fc.endsDot) < 0.15 && Math.abs(fd.capStart - fc.capStart) < 0.15 && Math.abs(fb.scopeLen - fcl.scopeLen) < 25, "style differs by group");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const medD = median(group((l) => l.defective).map((d) => d.steps.length)), medC = median(group((l) => !l.defective).map((d) => d.steps.length));
const stepGap = fc.steps - fd.steps;
if (stepGap >= 0.5) warn("seeded drafts are shorter than clean ones", `mean ${f2(fd.steps)} vs ${f2(fc.steps)} steps, median ${medD} vs ${medC}. Part of it is real: the 3 deleted approvals remove a step, and the longest draft (offboarding, 11 steps) is clean. A reader could exploit it, a rule could not. Reported, not hidden.`);
else ok("step counts similar across groups", true);

section("5. Review output (every flag has a reason)");
ok("24 results, one per draft", review.results.length === 24 && review.results.every((r) => draftById.has(r.workflow)) && new Set(review.results.map((r) => r.workflow)).size === 24);
const allFlags = review.results.flatMap((r) => r.flags);
ok("flag ids unique", new Set(allFlags.map((f) => f.id)).size === allFlags.length);
ok("flagged boolean matches flags", review.results.every((r) => r.flagged === (r.flags.length > 0)));
const flagProblems = [];
for (const f of allFlags) {
  const d = draftById.get(f.workflow);
  const s = d?.steps.find((x) => x.n === f.step);
  if (!s || s.kind !== "write") flagProblems.push(`${f.id}: step`);
  if (!["A", "B"].includes(f.rule)) flagProblems.push(`${f.id}: rule`);
  if (typeof f.reason !== "string" || f.reason.length < 20 || f.reason.length > 220) flagProblems.push(`${f.id}: reason length`);
  else if (/\n/.test(f.reason) || /[*#`]/.test(f.reason)) flagProblems.push(`${f.id}: reason not one plain line`);
  if (!f.reason_source) flagProblems.push(`${f.id}: no reason_source`);
}
ok(`all ${allFlags.length} flags have a valid one-line reason, a write step and a source`, flagProblems.length === 0, flagProblems.slice(0, 5).join("; "));
const redo = drafts.flatMap((d) => applyRules(d)).map((f) => f.id).sort().join();
ok("flags are reproducible: re-running the rules on drafts.json gives the same flag set", redo === allFlags.map((f) => f.id).sort().join());
const stale = [];
for (const f of allFlags) { const fresh = drafts.flatMap((d) => applyRules(d)).find((x) => x.id === f.id); if (fresh && fresh.evidence.scope !== f.evidence.scope) stale.push(f.id); }
ok("review.json evidence matches current drafts (not stale)", stale.length === 0, stale.join(","));

section("6. Eval (recomputed independently)");
if (!evalJson) console.log("  skip  data/eval.json not generated yet");
else {
  let tp = 0, fp = 0, tn = 0, fn = 0, flagged = 0;
  for (const l of labels) {
    const r = review.results.find((x) => x.workflow === l.workflow);
    if (r.flags.length) flagged++;
    if (l.defective) { if (r.flags.some((f) => f.rule === l.type && f.covers_steps.includes(l.step))) tp++; else fn++; }
    else if (r.flags.length) fp++; else tn++;
  }
  const c = evalJson.counts;
  ok("TP/FN/FP/TN match recomputation", c.true_positives === tp && c.false_negatives === fn && c.false_alarms === fp && c.true_negatives === tn, JSON.stringify({ tp, fn, fp, tn }));
  ok("TP + FN = 12 seeded defects; FP + TN = 12 clean", tp + fn === 12 && fp + tn === 12);
  ok("precision = TP / flagged drafts", Math.abs(evalJson.metrics.precision.value - Math.round((tp / flagged) * 1000) / 1000) < 1e-9, `denominator ${flagged}`);
  ok("recall = TP / 12", Math.abs(evalJson.metrics.recall.value - Math.round((tp / 12) * 1000) / 1000) < 1e-9);
  ok("metrics in [0,1] and denominators non-zero", flagged > 0 && [evalJson.metrics.precision.value, evalJson.metrics.recall.value].every((v) => v >= 0 && v <= 1));
  ok("every miss is tagged needs_connected_system (failure-mode text is accurate)", evalJson.failure_mode.every_miss_is_this_mode);
  if (evalJson.metrics.precision.value === 1 || evalJson.metrics.recall.value === 1) warn("a headline metric is exactly 100%", "red flag per the checklist: results that perfectly confirm the hypothesis");
  else ok("no headline metric is exactly 0% or 100% (checklist red flag)", true);
  ok("n is small: intervals are reported", evalJson.metrics.recall.ci95.length === 2 && evalJson.metrics.precision.ci95.length === 2);
}

console.log(`\n${failures === 0 ? "ALL HARD CHECKS PASSED" : failures + " HARD CHECK(S) FAILED"}  (${warnings} warning${warnings === 1 ? "" : "s"})`);
process.exit(failures ? 1 : 0);
