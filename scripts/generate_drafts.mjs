// Step 2: turn each SOP into a draft workflow with a small open model run locally via Ollama.
// Talks only to http://127.0.0.1:11434 (the local Ollama server). No cloud API, no key.
// Output: data/drafts.raw.json (unmodified model output + provenance).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.MODEL || "qwen2.5:7b-instruct";
const HOST = process.env.OLLAMA_HOST_URL || "http://127.0.0.1:11434";
const KINDS = ["read", "approval", "write", "notify"];

const schema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS },
          action: { type: "string" },
          system: { type: "string" },
          approver: { type: "string" },
          scope: { type: "string" },
        },
        required: ["kind", "action", "system", "approver", "scope"],
      },
    },
  },
  required: ["steps"],
};

function prompt(sop) {
  return `Convert this IT standard operating procedure (SOP) into a draft workflow for an automation agent.
Return JSON: {"steps":[{"kind","action","system","approver","scope"}]}

Field rules:
- kind "read": looks something up, changes nothing. scope = "read-only". approver = "none".
- kind "approval": a person signs off. system = "HelpDesk". approver = the approver role exactly as the SOP names it, not shortened. If several people must sign off, name them all in this one step. scope = "none".
- kind "write": changes a permission, role, group, account, record or device in a system. approver = "none". scope = the exact role, permission set, group or object that is changed or granted, using only the names that appear in the SOP. Never invent group or role names.
- kind "notify": sends a message, or does ticket bookkeeping such as recording a note, marking an asset or closing a ticket. system = "HelpDesk" unless the SOP names another channel. approver = "none". scope = "none".
- Do not add a step for the requester filing or opening the ticket.
- "action" is a short imperative sentence of at most 14 words.
- "system" must be exactly one of: ${sop.systems.join(", ")}.
- Follow the SOP order. Use 4 to 10 steps. Do not add steps, permissions or approvals that the SOP does not contain.

SOP title: ${sop.title}
SOP:
${sop.text}`;
}

async function chat(sop) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: schema,
      options: { temperature: 0, seed: 42, num_ctx: 4096 },
      messages: [
        { role: "system", content: "You turn IT SOPs into structured workflow drafts. Output JSON only." },
        { role: "user", content: prompt(sop) },
      ],
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return res.json();
}

const sops = JSON.parse(await readFile(path.join(ROOT, "data/sops.json"), "utf8"));
const drafts = [];
const t0 = Date.now();
for (const sop of sops) {
  const started = Date.now();
  let steps = null;
  let attempts = 0;
  let meta = null;
  while (!steps && attempts < 3) {
    attempts++;
    const out = await chat(sop);
    meta = { eval_count: out.eval_count, total_duration_ms: Math.round(out.total_duration / 1e6) };
    try {
      steps = JSON.parse(out.message.content).steps;
      if (!Array.isArray(steps) || steps.length < 3) steps = null;
    } catch {
      steps = null;
    }
  }
  if (!steps) throw new Error(`no valid output for ${sop.id}`);
  const norm = (v) => (v === "none" || v === "" || v == null ? null : v);
  drafts.push({
    id: sop.id.replace("sop-", "wf-"),
    sop_id: sop.id,
    title: sop.title,
    steps: steps.map((s, i) => ({
      n: i + 1,
      kind: s.kind,
      action: s.action,
      // The model sometimes answers "none" for notify steps. Notifications go through the ticket.
      system: sop.systems.includes(s.system) ? s.system : "HelpDesk",
      approver: norm(s.approver),
      scope: norm(s.scope),
    })),
    _gen: { attempts, ...meta },
  });
  console.error(`${sop.id} ok  steps=${steps.length}  attempts=${attempts}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const version = await fetch(`${HOST}/api/version`).then((r) => r.json()).catch(() => ({}));
await writeFile(
  path.join(ROOT, "data/drafts.raw.json"),
  JSON.stringify(
    {
      generator: { runtime: "Ollama (local)", ollama_version: version.version ?? null, model: MODEL, temperature: 0, seed: 42, generated_at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) },
      drafts,
    },
    null,
    2
  ) + "\n"
);
console.error(`wrote data/drafts.raw.json (${drafts.length} drafts)`);
