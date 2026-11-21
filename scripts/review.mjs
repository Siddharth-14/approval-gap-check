// Step 4: the reviewer. Two deterministic rules, plus a one-line reason per flag written by the local model.
// Inputs:  data/drafts.json, data/rules.json   (NOT labels.json: the reviewer never sees the answer key)
// Output:  data/review.json
// Reasons come from Ollama on 127.0.0.1 and are precomputed here, so the website makes no model calls.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.MODEL || "qwen2.5:7b-instruct";
const HOST = process.env.OLLAMA_HOST_URL || "http://127.0.0.1:11434";
const read = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));

const rules = await read("data/rules.json");
const { drafts } = await read("data/drafts.json");

const classOf = (system) => {
  for (const [cls, names] of Object.entries(rules.system_classes)) if (names.includes(system)) return cls;
  return null;
};
const adminRes = rules.admin_scope_patterns.map((p) => new RegExp(p, "i"));
const negRes = rules.negation_patterns.map((p) => new RegExp(p, "gi"));

function adminMatch(scope) {
  if (!scope) return null;
  let text = scope;
  for (const n of negRes) text = text.replace(n, " ");
  for (const re of adminRes) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

export function applyRules(draft) {
  const flags = [];
  // Rule A: write on identity/finance system with no earlier approval step that names an approver.
  let approved = false;
  const ungated = [];
  for (const s of draft.steps) {
    if (s.kind === "approval" && s.approver) approved = true;
    if (s.kind === "write" && classOf(s.system) && !approved) ungated.push(s);
  }
  if (ungated.length) {
    const s = ungated[0];
    flags.push({
      id: `${draft.id}-A-${s.n}`,
      workflow: draft.id,
      rule: "A",
      rule_name: rules.rules[0].name,
      step: s.n,
      covers_steps: ungated.map((x) => x.n),
      system: s.system,
      system_class: classOf(s.system),
      evidence: { action: s.action, scope: s.scope, matched: null },
    });
  }
  // Rule B: write step whose scope reads as admin-level.
  for (const s of draft.steps) {
    if (s.kind !== "write") continue;
    const m = adminMatch(s.scope);
    if (m) {
      flags.push({
        id: `${draft.id}-B-${s.n}`,
        workflow: draft.id,
        rule: "B",
        rule_name: rules.rules[1].name,
        step: s.n,
        covers_steps: [s.n],
        system: s.system,
        system_class: classOf(s.system),
        evidence: { action: s.action, scope: s.scope, matched: m },
      });
    }
  }
  return flags;
}

function reasonPrompt(draft, f) {
  const finding =
    f.rule === "A"
      ? `No approval step comes before this step, and it changes an ${f.system_class} system.${f.covers_steps.length > 1 ? ` Steps ${f.covers_steps.join(", ")} are all ungated.` : ""}`
      : `The permission scope contains "${f.evidence.matched}", which reads as admin-level or broader than the task needs.`;
  return `You are helping a human reviewer check an agent-drafted IT workflow.
Workflow: ${draft.title}
Step ${f.step}: "${f.evidence.action}" in ${f.system}. Permission scope: ${f.evidence.scope ?? "not stated"}.
Automatic check result: ${finding}
Write exactly ONE plain sentence of 25 words or fewer telling the reviewer why this step needs a look. Name the specific system and the specific action or role involved, and say what could go wrong. No markdown, no quotation marks, no rule names, no list, no hedging like "potentially".`;
}

async function writeReason(draft, f) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${HOST}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        prompt: reasonPrompt(draft, f),
        options: { temperature: 0, seed: 42 + attempt, num_predict: 90, num_ctx: 2048 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    let t = (await res.json()).response.trim().replace(/\s*\n+\s*/g, " ").replace(/^["'`]+|["'`]+$/g, "");
    const words = t.split(/\s+/).length;
    if (t.length >= 20 && t.length <= 220 && words <= 32 && !/[*#`]/.test(t)) return t;
  }
  throw new Error(`could not get a valid one-line reason for ${f.id}`);
}

// Only run the pipeline when executed directly (the engine above is importable by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const results = [];
  for (const d of drafts) {
    const flags = applyRules(d);
    for (const f of flags) {
      f.reason = await writeReason(d, f);
      f.reason_source = `ollama:${MODEL}`;
      console.error(`${f.id}  ${f.reason}`);
    }
    results.push({ workflow: d.id, flagged: flags.length > 0, flags });
  }
  const out = {
    meta: {
      reviewer: "rules v1 (A: approval before write on identity/finance, B: scope narrower than admin)",
      reasons: `precomputed one-line reasons, written locally by ${MODEL} via Ollama; none are computed in the browser`,
      inputs: ["data/drafts.json", "data/rules.json"],
      generated_at: new Date().toISOString(),
      seconds: Math.round((Date.now() - t0) / 1000),
    },
    results,
  };
  await writeFile(path.join(ROOT, "data/review.json"), JSON.stringify(out, null, 2) + "\n");
  console.error(`wrote data/review.json: ${results.filter((r) => r.flagged).length} flagged drafts, ${results.reduce((n, r) => n + r.flags.length, 0)} flags`);
}
