# Approval gap check

Can a reviewer catch a missing approval or an over-broad permission in a workflow an AI agent drafted for an IT request?

**Live demo:** https://approval-gap-check.netlify.app

> Synthetic data. Not Serval's product. Results are not Serval's review rates.

## The problem

Agents that draft IT workflows (access requests, offboarding, MFA resets, license purchases) tend to fail in two quiet ways:

- **Approval gap (type A).** A write to an identity or finance system with no approval step before it.
- **Permission gap (type B).** A write whose scope is admin-level, or broader than the request needs.

A reviewer, human or automated, has to catch both without crying wolf on every draft. This project measures how well one simple reviewer does, and where it cannot.

## What it does

1. 24 synthetic IT request SOPs (`data/sops.json`): laptop replacement, access requests, offboarding, MFA reset, license requests and similar. No real company data.
2. A small open model (`qwen2.5:7b-instruct`, run locally with Ollama) turns each SOP into a step list: action, system, approver, permission scope (`data/drafts.json`).
3. 12 drafts get a hand-planted defect, 6 of each type. 12 stay clean. The answer key is `data/labels.json`.
4. A reviewer applies two rules (`data/rules.json`): approval required before a write on an identity or finance system, and scope must be narrower than admin. The local model writes a one-line reason for each flag (`data/review.json`).
5. `data/eval.json` scores the reviewer against the answer key.
6. A static page shows the 24 drafts, each draft's steps and flags, a "show seeded truth" toggle, and the scorecard. It opens on the first flagged draft.

## How it runs for $0

- **Drafts and reasons:** a 7B model on a laptop through Ollama. No API, no key, no per-token cost.
- **The site:** plain HTML, CSS and vanilla JS. Everything it shows is precomputed JSON. It makes 8 requests to its own origin and none to any model. A Content-Security-Policy header (`connect-src 'self'`) makes the browser refuse anything else.
- **Hosting:** Netlify Free ($0; the pricing page lists a 300 credit limit, and a production deploy costs 15 credits, so deploys are kept few). Code on GitHub Free.
- No API keys exist anywhere in the repo.

## The AI PM eval

Draft-level scoring. A seeded draft counts as caught only if a flag of the right type lands on the right step. A clean draft with any flag is a false alarm.

| Measure | Result | 95% range |
| --- | --- | --- |
| Precision | 82% (9 of 11 flagged drafts had a planted defect) | 52 to 95% |
| Recall | 75% (9 of 12 planted defects caught) | 47 to 91% |
| False alarms | 2 of 12 clean drafts | |
| Caught when the defect is visible in the draft | 9 of 9 | |
| Caught when it needs the connected system | 0 of 3 | |

### Failure mode: defects invisible without the connected system

The reviewer sees only the draft. Three planted defects look fine on the page:

- a group named `platform-oncall` that is nested inside a production-admin group in the directory,
- a custom expense role `Auditor-Plus` that carries policy-admin rights,
- a vendor payments portal (`PayBridge`) the rules do not know is a finance system.

Catching them takes live lookups of group nesting, role definitions and the system inventory. A keyword rule on action text might catch the payments portal. It could not catch the other two, and each extra keyword rule adds false alarms like the two already seen: a pre-approved standard change (password reset) and Okta's `Read-only Administrator` role, which contains the word "admin" but cannot change anything.

### What these numbers are not

- **n = 24.** One draft moves recall by 8 points. Treat every percentage loosely.
- **One author wrote everything:** the defects, the rules, and the hard cases. 3 of the 12 defects and 2 of the 12 clean drafts were written to be hard for a simple reviewer, so the mix, not just the reviewer, sets these scores. They describe this harness, not any real reviewer, and not Serval's.
- **The local model's drafts needed repair.** My first prompt contained an example scope that the 7B model copied into 28 unrelated steps across 14 drafts, so I rewrote the prompt and regenerated. The second run still reordered two approvals to after their write (wf-04, wf-18) and wrote vague scopes. About 60 small hand edits are listed in `scripts/seed.mjs`.
- **The model's reasons are uneven.** They are the model's unedited output. Some are vague, and one (wf-20) invents a role. The flags come from the rules. The model only explains them.
- **A structural tell remains:** seeded drafts average 4.6 steps against 5.5 for clean ones (medians are equal). `scripts/validate.mjs` reports it.

### What I would do next

1. Add a pre-approved-change allowlist to cut the false alarms.
2. Add directory, role and system-inventory lookups, then re-measure on the 3 hidden defects.
3. Grow the set to a few hundred drafts with defects written by someone other than the rule author.
4. Report recall for high-severity writes (identity, finance) separately, since a miss costs far more than a false alarm.

## Run it

```bash
python3 -m http.server 4173          # then open http://localhost:4173
node scripts/validate.mjs            # data QA: counts, label leakage, every flag has a reason
node scripts/eval.mjs                # recompute the scores
```

To regenerate the pipeline (needs Ollama with `qwen2.5:7b-instruct` pulled):

```bash
node scripts/generate_drafts.mjs && node scripts/seed.mjs && node scripts/review.mjs && node scripts/eval.mjs
```

`seed.mjs` patches refer to step numbers from the committed model run, so a fresh generation may need its patches updated.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the static site |
| `data/sops.json` | 24 synthetic SOPs |
| `data/drafts.raw.json` | unmodified local-model output |
| `data/drafts.json` | repaired and seeded drafts (what the reviewer sees) |
| `data/labels.json` | answer key; the reviewer never reads it |
| `data/rules.json`, `data/review.json` | the two rules, and their flags with reasons |
| `data/eval.json` | scores, intervals and the failure mode |
| `scripts/` | generate, seed, review, eval, validate, build |
| `netlify.toml` | build step and security headers |
