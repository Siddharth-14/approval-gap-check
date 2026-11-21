// Step 5: score the reviewer against the seeded ground truth. Pure arithmetic, no model calls.
// Inputs: data/labels.json, data/review.json, data/drafts.json   Output: data/eval.json
//
// Definitions (draft level):
//   flagged         a draft with at least one flag
//   true positive   a seeded-defect draft that has a flag of the labeled type on the labeled step
//   false alarm     a clean draft that has any flag
//   precision       true positives / flagged drafts
//   recall          true positives / seeded-defect drafts
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const { labels } = await read("data/labels.json");
const review = await read("data/review.json");
const { drafts } = await read("data/drafts.json");

const byWf = new Map(review.results.map((r) => [r.workflow, r]));
const title = new Map(drafts.map((d) => [d.id, d.title]));

function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const r3 = (x) => Math.round(x * 1000) / 1000;
const stat = (k, n) => ({ k, n, value: n ? r3(k / n) : null, ci95: wilson(k, n).map(r3) });

const caught = [];
const missed = [];
const falseAlarms = [];
let tn = 0;
for (const l of labels) {
  const r = byWf.get(l.workflow);
  if (l.defective) {
    const hit = r.flags.find((f) => f.rule === l.type && f.covers_steps.includes(l.step));
    if (hit) caught.push({ workflow: l.workflow, type: l.type, visibility: l.visibility, flag: hit.id });
    else
      missed.push({
        workflow: l.workflow,
        title: title.get(l.workflow),
        type: l.type,
        visibility: l.visibility,
        flagged_anyway: r.flagged,
        hidden_context: l.hidden_context,
      });
  } else if (r.flagged) {
    falseAlarms.push({
      workflow: l.workflow,
      title: title.get(l.workflow),
      rules: r.flags.map((f) => f.rule),
      why_clean: l.note,
    });
  } else tn++;
}

const defective = labels.filter((l) => l.defective).length;
const clean = labels.length - defective;
const flagged = review.results.filter((r) => r.flagged).length;
const tp = caught.length;
const fp = falseAlarms.length;
const fn = missed.length;
const wrongFlag = missed.filter((m) => m.flagged_anyway).length; // flagged, but not the labeled defect

const slice = (pred) => {
  const ls = labels.filter((l) => l.defective && pred(l));
  const k = ls.filter((l) => caught.some((c) => c.workflow === l.workflow)).length;
  return { defective: ls.length, caught: k, ...stat(k, ls.length) };
};

const everyMissIsInvisible = missed.every((m) => m.visibility === "needs_connected_system");
if (!everyMissIsInvisible) console.error("WARNING: a miss is not tagged needs_connected_system. The failure-mode text below must be rewritten.");

const out = {
  meta: {
    definitions: {
      flagged: "a draft with at least one flag",
      true_positive: "a seeded-defect draft with a flag of the labeled type on the labeled step",
      false_alarm: "a clean draft with any flag",
      precision: "true positives / flagged drafts",
      recall: "true positives / seeded-defect drafts",
    },
    caveat:
      "n = 24 drafts, 12 seeded by the author. One draft moves recall by 8 points and precision by about 9. The 95% intervals are Wilson intervals. The defects, the rules and the seeded hard cases were all written by the same person, so these numbers describe this harness, not any real reviewer.",
    generated_at: new Date().toISOString(),
  },
  counts: { drafts: labels.length, seeded_defects: defective, clean, flagged, true_positives: tp, false_negatives: fn, wrong_flag_only: wrongFlag, false_alarms: fp, true_negatives: tn, flags_total: review.results.reduce((n, r) => n + r.flags.length, 0) },
  metrics: { precision: stat(tp, flagged), recall: stat(tp, defective), false_alarms: { count: fp, of_clean: clean, rate: r3(fp / clean) } },
  by_type: { A: slice((l) => l.type === "A"), B: slice((l) => l.type === "B") },
  by_visibility: { visible_in_draft: slice((l) => l.visibility === "visible_in_draft"), needs_connected_system: slice((l) => l.visibility === "needs_connected_system") },
  baselines: {
    flag_everything: { precision: r3(defective / labels.length), recall: 1, false_alarms: clean },
    flag_nothing: { precision: null, recall: 0, false_alarms: 0 },
  },
  cases: { caught, missed, false_alarms: falseAlarms },
  failure_mode: {
    title: "Defects that are invisible without the connected system",
    text:
      "The reviewer sees only the draft. Three seeded defects look fine on the page: a group called platform-oncall that is nested under a production-admin group in the directory, a custom expense role called Auditor-Plus that carries policy-admin rights, and a vendor-payments portal the rules do not know is a finance system. Reading the draft cannot reveal any of them. Catching them needs a live lookup of group nesting, role definitions and the system inventory, which this static reviewer deliberately does not have. A keyword rule on action text might catch the payments portal case. It could not catch the other two, and every extra keyword rule adds false alarms like the two already seen.",
    every_miss_is_this_mode: everyMissIsInvisible,
  },
};
await writeFile(path.join(ROOT, "data/eval.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ counts: out.counts, metrics: out.metrics, by_type: out.by_type, by_visibility: out.by_visibility, missed: missed.map((m) => `${m.workflow} ${m.type} ${m.visibility}`), false_alarms: falseAlarms.map((f) => f.workflow) }, null, 2));
