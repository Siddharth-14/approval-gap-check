// Step 3: hand-seeded defects + the hand repairs that make the other drafts faithful to their SOPs.
//   data/drafts.raw.json  (unmodified local-model output)
//     -> REPAIRS  make every draft match its SOP (the 7B model reordered 2 approvals, mistyped some
//                 bookkeeping steps and wrote vague scopes). Applies to all 24 drafts.
//     -> SEEDS    plant 12 defects by hand: 6 type A (no approval before a write), 6 type B (over-broad scope).
//   -> data/drafts.json (what the reviewer and the UI see) and data/labels.json (the answer key).
// Ops use the ORIGINAL step numbers from drafts.raw.json; steps are renumbered at the end.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(await readFile(path.join(ROOT, "data/drafts.raw.json"), "utf8"));

// ---- repairs: faithfulness to the SOP (applied to clean and to to-be-seeded drafts alike) -------------
const REPAIRS = {
  "wf-01": [[1, { scope: "read-only" }], [3, { scope: "profile employee-laptop on the new device" }], [5, { scope: "device trust of the old laptop only" }], [6, { scope: "the old laptop only" }], [7, { kind: "notify", scope: null }]],
  "wf-02": [[3, { scope: "role: Standard user" }], [4, { scope: "member of groups all-staff and dept-members (no management rights)" }], [5, { scope: "role: Member" }]],
  "wf-03": [[3, { scope: "all MFA factors, this user only" }], [4, { scope: "this user only" }]],
  "wf-04": [{ move: [3, 2] }, [1, { scope: "read-only" }], [2, { scope: "member of group mbx-support-delegates (one mailbox)" }]],
  "wf-05": [[3, { scope: "application assignment: Figma" }], [4, { scope: "role: Editor (full seat)" }]],
  "wf-06": [[1, { scope: "read-only" }], [2, { approver: "HR and Manager" }], ...[3, 4, 5, 6, 7, 8].map((n) => [n, { scope: "this user only" }]), [8, { scope: "this device only" }], [9, { scope: "return label for this device" }], [10, { scope: "this user's pending reports" }]],
  "wf-07": [[2, { scope: "this user only" }]],
  "wf-08": [[3, { scope: "role: AP Clerk (enter and view vendor bills only)" }], [4, { scope: "subsidiary restriction: user's home subsidiary" }]],
  "wf-09": [[3, { scope: "requester's device only" }], [4, { kind: "read", scope: "read-only" }]],
  "wf-10": [[1, { scope: "read-only" }], [3, { scope: "permission set ReadOnlyAccess on account sandbox-dev" }], [4, { scope: "session duration 4 hours on account sandbox-dev" }]],
  "wf-11": [[2, { approver: "Sponsor and Security Team" }], [3, { scope: "organizational unit Contractors, expires at contract end" }], [4, { scope: "member of group contractors" }], [5, { scope: "Read permission on the named repository (outside collaborator)" }]],
  "wf-12": [[3, { scope: "member of group platform-oncall" }]],
  "wf-13": [[3, { scope: "monthly limit on this one card, up to the approved amount" }], [4, { scope: "limit reverts after 30 days on this one card" }]],
  "wf-14": [[3, { scope: "member of private channel #proj-atlas-private (no channel management)" }]],
  "wf-15": [[2, { approver: "Repository Owner" }], [3, { scope: "member of GitHub team payments-api-writers" }], [4, { scope: "Write on payments-api only" }]],
  "wf-16": [[3, { scope: "FIDO2 factor, this user only" }]],
  "wf-17": [[3, { scope: "remittance profile of this one vendor" }], [4, { scope: "payment hold on this one vendor, 48 hours" }]],
  "wf-18": [{ move: [3, 2] }, [1, { system: "Jira", scope: "read-only" }], [2, { scope: "Developers role on project ATLAS only" }]],
  "wf-19": [],
  "wf-20": [[3, { scope: "Read-only Administrator (view system log and reports only)" }], [4, { scope: "role expires at end of audit window" }]],
  "wf-21": [[3, { scope: "direct-deposit account of this one employee" }]],
  "wf-22": [[3, { scope: "purchase order for the approved vendor and amount only" }], [4, { scope: "attachment on this purchase order" }]],
  "wf-23": [[2, { approver: "List Owner" }], [3, { scope: "member of group eng-announce (receive mail only)" }]],
  "wf-24": [[2, { approver: "Drive Owner" }], [3, { scope: "Viewer on shared drive Marketing-Assets" }]],
};

// ---- seeds: the 12 defects ----------------------------------------------------------------------------
// labelKey = original number of the step the defect lives on.
const notify = (action) => ({ kind: "notify", action, system: "HelpDesk", approver: null, scope: null });
const SEEDS = {
  "wf-02": { type: "A", visibility: "visible_in_draft", ops: [{ remove: 2 }], labelKey: 3, seeded_change: "Deleted the hiring-manager approval step." },
  "wf-03": { type: "A", visibility: "visible_in_draft", ops: [[2, notify("Notify manager of the reset request")]], labelKey: 3, seeded_change: "Replaced the manager approval with a courtesy notification, so nothing gates the MFA reset." },
  "wf-05": { type: "B", visibility: "visible_in_draft", ops: [[4, { action: "Set Figma role to 'Org Admin'", scope: "role: Org Admin (all teams and billing)" }]], labelKey: 4, seeded_change: "Widened the Figma role from Editor to Org Admin." },
  "wf-08": { type: "A", visibility: "visible_in_draft", ops: [{ remove: 2 }], labelKey: 3, seeded_change: "Deleted the Finance Controller approval step." },
  "wf-10": { type: "B", visibility: "visible_in_draft", ops: [[3, { action: "Assign 'AdministratorAccess' permission set", scope: "permission set AdministratorAccess on account sandbox-dev" }]], labelKey: 3, seeded_change: "Swapped the ReadOnlyAccess permission set for AdministratorAccess." },
  "wf-12": { type: "B", visibility: "needs_connected_system", ops: [], labelKey: 3, seeded_change: "No change to the draft text. The risk sits in the connected directory, not on the page.", hidden_context: "In the connected Okta tenant the group platform-oncall is nested inside prod-admins, so members inherit production admin rights. The draft shows only the group name." },
  "wf-13": { type: "A", visibility: "visible_in_draft", ops: [[2, notify("Notify Finance Manager of the limit request")]], labelKey: 3, seeded_change: "Replaced the Finance Manager approval with a courtesy notification." },
  "wf-15": { type: "B", visibility: "visible_in_draft", ops: [[4, { action: "Grant 'Admin' permission on all repositories", scope: "Admin on all repositories in the organization" }]], labelKey: 4, seeded_change: "Widened Write on one repository to Admin on every repository." },
  "wf-17": { type: "A", visibility: "needs_connected_system", ops: [{ remove: 2 }], labelKey: 3, seeded_change: "Deleted the AP Manager approval step.", hidden_context: "PayBridge is the vendor payments portal and moves money, so it is a finance system. The reviewer's system inventory does not list it, and the draft shows only the product name." },
  "wf-18": { type: "B", visibility: "visible_in_draft", ops: [[2, { action: "Add user to Administrators role on all projects", scope: "Administrators role, all Jira projects" }]], labelKey: 2, seeded_change: "Widened the Developers role on one project to Administrators on all projects." },
  "wf-19": { type: "B", visibility: "needs_connected_system", ops: [], labelKey: 3, seeded_change: "No change to the draft text. The risk sits in the connected expense policy, not on the page.", hidden_context: "In the connected Expensify policy the custom role Auditor-Plus includes the Manage Policy permission, which is policy-admin. The draft shows only the role name." },
  "wf-21": { type: "A", visibility: "visible_in_draft", ops: [[2, notify("Notify Payroll Manager of the change request")]], labelKey: 3, seeded_change: "Replaced the Payroll Manager approval with a courtesy notification." },
};

// notes on clean drafts that a simple rule will wrongly flag (shown when the truth toggle is on)
const CLEAN_NOTES = {
  "wf-07": "Clean. This is a pre-approved standard change (policy IT-STD-04): the SOP asks for identity verification, not approval. A rule that demands an approval step before every identity write cannot know that.",
  "wf-20": "Clean. Okta's Read-only Administrator role can view logs and reports but change nothing. The scope is narrower than admin even though the word appears. A keyword rule cannot tell.",
};

// ---- apply ---------------------------------------------------------------------------------------------
function applyOps(steps, ops) {
  for (const op of ops) {
    if (Array.isArray(op)) {
      const s = steps.find((x) => x.key === op[0]);
      if (!s) throw new Error(`no step ${op[0]}`);
      Object.assign(s, op[1]);
    } else if (op.remove != null) {
      const i = steps.findIndex((x) => x.key === op.remove);
      if (i < 0) throw new Error(`no step ${op.remove}`);
      steps.splice(i, 1);
    } else if (op.move) {
      const [key, beforeKey] = op.move;
      const i = steps.findIndex((x) => x.key === key);
      const [s] = steps.splice(i, 1);
      steps.splice(steps.findIndex((x) => x.key === beforeKey), 0, s);
    }
  }
}

const drafts = [];
const labels = [];
let repaired = 0;
for (const d of raw.drafts) {
  const steps = d.steps.map((s) => ({ ...s, key: s.n }));
  const rep = REPAIRS[d.id];
  if (rep === undefined) throw new Error(`no REPAIRS entry for ${d.id}`);
  // read steps are always "read-only"
  for (const s of steps) if (s.kind === "read") s.scope = "read-only";
  applyOps(steps, rep);
  repaired += rep.length;
  const seed = SEEDS[d.id];
  if (seed) applyOps(steps, seed.ops);
  const final = steps.map((s, i) => ({ n: i + 1, kind: s.kind, action: s.action, system: s.system, approver: s.approver, scope: s.scope }));
  drafts.push({ id: d.id, sop_id: d.sop_id, title: d.title, steps: final });
  const labelStep = seed ? steps.findIndex((x) => x.key === seed.labelKey) + 1 : null;
  labels.push(
    seed
      ? { workflow: d.id, defective: true, type: seed.type, step: labelStep, visibility: seed.visibility, seeded_change: seed.seeded_change, hidden_context: seed.hidden_context ?? null, note: null }
      : { workflow: d.id, defective: false, type: null, step: null, visibility: null, seeded_change: null, hidden_context: null, note: CLEAN_NOTES[d.id] ?? null }
  );
}

await writeFile(
  path.join(ROOT, "data/drafts.json"),
  JSON.stringify(
    {
      generator: { ...raw.generator, note: "Step lists written by a local open model from the SOPs, then hand-edited. See the README for how." },
      drafts,
    },
    null,
    2
  ) + "\n"
);
await writeFile(
  path.join(ROOT, "data/labels.json"),
  JSON.stringify(
    {
      meta: {
        what: "Ground truth for the 12 seeded defects. The reviewer never reads this file.",
        types: { A: "approval gap: a write on an identity or finance system with no approval step before it", B: "permission gap: a write whose scope is admin-level or broader than the request needs" },
        visibility: { visible_in_draft: "the defect can be read off the draft", needs_connected_system: "the draft looks fine; spotting the defect needs a look inside the connected system" },
        seeded_by: "hand, by the project author, in scripts/seed.mjs",
      },
      labels,
    },
    null,
    2
  ) + "\n"
);
console.log(`drafts: ${drafts.length}, seeded: ${labels.filter((l) => l.defective).length}, repair ops: ${repaired}`);
for (const l of labels.filter((x) => x.defective)) console.log(`  ${l.workflow} type ${l.type} step ${l.step} ${l.visibility}`);
