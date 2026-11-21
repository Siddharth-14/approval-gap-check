/* Approval gap check. Vanilla JS, no dependencies.
   Loads six static JSON files from /data and renders them. It makes no other network request: the
   reviewer's flags, the one-line reasons and the scores were all computed ahead of time (see /scripts). */
(function () {
  "use strict";

  const FILES = ["sops", "drafts", "labels", "review", "eval", "rules"];
  const state = { wfs: [], byId: new Map(), selected: null, truth: false, filter: "all", eval: null };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (x) => Math.round(x * 100);
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FLAG_SVG = '<svg class="flag-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M3.8 2.2h8.4l-2.1 3.1 2.1 3.1H3.8z" fill="currentColor"/></svg>';
  const TICK_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svg = (inner) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + "</svg>";
  const NODE = {
    read: svg('<circle class="bg" cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2"/>'),
    approval: svg('<rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor"/><path class="tick" d="M7.5 12.5l3 3 6-6.5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    write: svg('<circle cx="12" cy="12" r="6.5" fill="currentColor"/>'),
    writeSensitive: svg('<circle cx="12" cy="12" r="6.5" fill="currentColor"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
    notify: svg('<circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
    gap: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 2.5"/>'),
  };
  const VERB = { read: "Reads", write: "Changes", notify: "Notifies via" };
  const TYPE_TEXT = {
    A: "an approval gap: a write with no approval step before it",
    B: "a permission gap: a scope broader than the request needs",
  };

  // ---------- load ----------
  async function load() {
    const parts = await Promise.all(
      FILES.map((n) =>
        fetch("data/" + n + ".json").then((r) => {
          if (!r.ok) throw new Error(n + ".json returned " + r.status);
          return r.json();
        })
      )
    );
    const [sops, drafts, labels, review, evalData, rules] = parts;
    const sopById = new Map(sops.map((s) => [s.id, s]));
    const labelById = new Map(labels.labels.map((l) => [l.workflow, l]));
    const reviewById = new Map(review.results.map((r) => [r.workflow, r]));
    const caught = new Set(evalData.cases.caught.map((c) => c.workflow));
    const classOf = (sys) => {
      for (const [cls, names] of Object.entries(rules.system_classes)) if (names.includes(sys)) return cls;
      return null;
    };
    state.eval = evalData;
    state.wfs = drafts.drafts.map((d) => {
      const label = labelById.get(d.id);
      const rev = reviewById.get(d.id);
      const flagged = rev.flagged;
      let outcome;
      if (label.defective) outcome = caught.has(d.id) ? "Caught" : "Missed";
      else outcome = flagged ? "False alarm" : "Correctly clear";
      return {
        id: d.id,
        num: d.id.slice(3),
        title: d.title,
        sop: sopById.get(d.sop_id),
        category: sopById.get(d.sop_id).category,
        label,
        flags: rev.flags,
        flagged,
        outcome,
        steps: d.steps.map((s) => Object.assign({}, s, { cls: classOf(s.system) })),
      };
    });
    state.byId = new Map(state.wfs.map((w) => [w.id, w]));
  }

  // ---------- list ----------
  const outClass = (o) => ({ Caught: "out-caught", Missed: "out-missed", "False alarm": "out-false", "Correctly clear": "out-clear" })[o];

  function renderFilter() {
    const n = state.wfs.length;
    const f = state.wfs.filter((w) => w.flagged).length;
    const items = [["all", "All", n], ["flagged", "Flagged", f], ["clear", "Not flagged", n - f]];
    $("#filter").innerHTML = items
      .map((it) => '<button type="button" data-filter="' + it[0] + '" aria-pressed="' + (state.filter === it[0]) + '">' + it[1] + '<span class="count">' + it[2] + "</span></button>")
      .join("");
  }

  function renderList() {
    const rows = state.wfs.filter((w) => state.filter === "all" || (state.filter === "flagged" ? w.flagged : !w.flagged));
    $("#rows").innerHTML = rows
      .map((w) => {
        const marks =
          (w.flagged ? FLAG_SVG + '<span class="sr">Flagged by the reviewer.</span>' : '<span class="sr">Not flagged.</span>') +
          (state.truth ? '<span class="' + outClass(w.outcome) + '">' + esc(w.outcome) + "</span>" : "");
        return (
          '<li><button type="button" class="row" data-id="' + w.id + '"' + (w.id === state.selected ? ' aria-current="true"' : "") + ">" +
          '<span class="num">' + w.num + "</span>" +
          '<span class="name">' + esc(w.title) + '<span class="cat">' + esc(w.category) + "</span></span>" +
          '<span class="marks">' + marks + "</span></button></li>"
        );
      })
      .join("");
  }

  // ---------- sheet ----------
  function listSteps(ns) {
    const t = ns.map((n) => String(n));
    if (t.length === 1) return "Step " + t[0] + " runs";
    return "Steps " + t.slice(0, -1).join(", ") + " and " + t[t.length - 1] + " run";
  }

  function highlight(scope, matched) {
    if (!matched) return esc(scope);
    const i = scope.toLowerCase().indexOf(matched.toLowerCase());
    if (i < 0) return esc(scope);
    return esc(scope.slice(0, i)) + "<mark>" + esc(scope.slice(i, i + matched.length)) + "</mark>" + esc(scope.slice(i + matched.length));
  }

  function stepHTML(w, s, ctx) {
    const flags = ctx.flagsByStep.get(s.n) || [];
    const flaggedB = flags.find((f) => f.rule === "B");
    const sensitive = s.kind === "write" && s.cls;
    const classes = ["step", "kind-" + s.kind];
    if (flags.length) classes.push("flagged");
    if (ctx.covered.has(s.n)) classes.push("ungated");
    let what = "";
    if (s.kind === "approval") {
      what = '<span class="stamp">' + TICK_SVG + esc(s.approver) + "</span>";
    } else {
      what =
        '<p class="what"><span class="verb">' + VERB[s.kind] + '</span><span class="sys">' + esc(s.system) + "</span>" +
        (s.cls ? '<span class="cls">' + esc(s.cls) + "</span>" : "") +
        (ctx.covered.has(s.n) ? '<span class="also">No approval before it</span>' : "") +
        (state.truth && w.label.defective && w.label.step === s.n ? '<span class="planted">Planted defect</span>' : "") +
        "</p>";
      if (s.kind === "write" && s.scope) {
        what += '<p><span class="scope' + (flaggedB ? " hit" : "") + '"><span class="k">Scope</span><span>' + (flaggedB ? highlight(s.scope, flaggedB.evidence.matched) : esc(s.scope)) + "</span></span></p>";
      }
    }
    const notes = flags
      .map((f) => '<div class="note" role="note"><p class="rule">' + esc(f.rule_name) + '</p><p class="reason">' + esc(f.reason) + "</p></div>")
      .join("");
    return (
      '<li class="' + classes.join(" ") + '" id="step-' + s.n + '">' +
      '<span class="node">' + NODE[sensitive ? "writeSensitive" : s.kind] + "</span>" +
      '<p class="act"><span class="n">' + s.n + "</span><span>" + esc(s.action) + "</span></p>" +
      what + notes + "</li>"
    );
  }

  function gapHTML(title, sub) {
    return '<li class="step gap"><span class="node">' + NODE.gap + '</span><p class="slot">' + esc(title) + '<span class="sub">' + esc(sub) + "</span></p></li>";
  }

  function truthHTML(w) {
    const L = w.label;
    const head = '<p class="outcome ' + outClass(w.outcome) + '">' + esc(w.outcome === "Correctly clear" ? "Correctly left alone" : w.outcome) + "</p>";
    if (L.defective) {
      return (
        '<section class="truth" aria-label="Seeded truth">' + head +
        "<p>A defect was planted in this draft: " + TYPE_TEXT[L.type] + ", at step " + L.step + ". " + esc(L.seeded_change) + "</p>" +
        (L.hidden_context ? '<p class="why">Why the page cannot show it. ' + esc(L.hidden_context) + "</p>" : "") +
        "</section>"
      );
    }
    return (
      '<section class="truth" aria-label="Seeded truth">' + head +
      "<p>No defect was planted in this draft.</p>" +
      (L.note ? '<p class="why">' + esc(L.note) + "</p>" : "") +
      "</section>"
    );
  }

  function renderSheet(fresh) {
    const w = state.byId.get(state.selected);
    const sheet = $("#sheet");
    if (!w) return;
    const flagsByStep = new Map();
    const covered = new Set();
    const gapBefore = new Map();
    for (const f of w.flags) {
      if (!flagsByStep.has(f.step)) flagsByStep.set(f.step, []);
      flagsByStep.get(f.step).push(f);
      if (f.rule === "A") {
        gapBefore.set(f.step, { flagged: true, covers: f.covers_steps });
        f.covers_steps.forEach((n) => covered.add(n));
      }
    }
    if (state.truth && w.label.defective && w.label.type === "A" && !gapBefore.has(w.label.step)) {
      gapBefore.set(w.label.step, { flagged: false, covers: [w.label.step] });
    }
    const ctx = { flagsByStep, covered };
    const items = [];
    for (const s of w.steps) {
      const g = gapBefore.get(s.n);
      if (g) items.push(g.flagged ? gapHTML("No approval step before this write", listSteps(g.covers) + " without one.") : gapHTML("Approval missing here", "The reviewer did not flag it."));
      items.push(stepHTML(w, s, ctx));
    }
    const nFlags = w.flags.length;
    const verdict = w.flagged
      ? '<p class="verdict flagged">' + FLAG_SVG + "The reviewer flagged this draft: " + nFlags + (nFlags === 1 ? " flag" : " flags") + ".</p>"
      : '<p class="verdict quiet">The reviewer found nothing to flag.</p>';
    sheet.className = "sheet" + (fresh ? " fresh" : "");
    sheet.innerHTML =
      '<div class="sheet-top">' +
      '<div class="sheet-nav"><button type="button" data-nav="prev">Previous flagged</button><button type="button" data-nav="next">Next flagged</button></div>' +
      '<p class="provenance">Workflow ' + w.num + ", drafted from SOP " + w.num + " (" + esc(w.category) + ")</p>" +
      "<h2>" + esc(w.title) + "</h2>" + verdict + "</div>" +
      (state.truth ? truthHTML(w) : "") +
      '<ol class="steps">' + items.join("") + "</ol>" +
      '<p class="method">Two rules decide the flags. A local model, qwen2.5:7b-instruct, wrote each one-line reason ahead of time. This page calls no model.</p>' +
      '<details class="sop"><summary>The SOP this draft was written from</summary><p>' + esc(w.sop.text) + "</p></details>";
  }

  // ---------- scorecard ----------
  function units(ids, cls) {
    return ids.map((id) => {
      const w = state.byId.get(id);
      const bad = cls(w);
      const label = id + " " + w.title + ": " + bad.text + ". Open this draft.";
      return '<button type="button" class="unit' + (bad.bad ? " bad" : "") + '" data-id="' + id + '" aria-label="' + esc(label) + '" title="' + esc(id + ": " + bad.text) + '"></button>';
    }).join("");
  }

  function renderScore() {
    const e = state.eval;
    const c = e.counts, m = e.metrics;
    const defective = state.wfs.filter((w) => w.label.defective).map((w) => w.id);
    const flagged = state.wfs.filter((w) => w.flagged).map((w) => w.id);
    const defUnits = units(defective, (w) => (w.outcome === "Caught" ? { bad: false, text: "caught" } : { bad: true, text: "missed" }));
    const flagUnits = units(flagged, (w) => (w.label.defective ? { bad: false, text: "real defect" } : { bad: true, text: "false alarm" }));
    const missed = e.cases.missed
      .map((x) => '<li><button type="button" class="link-btn" data-id="' + x.workflow + '">' + x.workflow.slice(3) + " " + esc(x.title) + "</button></li>")
      .join("");
    const vis = e.by_visibility.visible_in_draft, hid = e.by_visibility.needs_connected_system;
    const was = $("#more");
    const open = was ? was.open : window.matchMedia("(min-width: 1240px)").matches;
    $("#score").innerHTML =
      '<h2 id="score-h">Scorecard</h2>' +
      '<dl class="stats">' +
      '<div class="stat"><dt>Precision</dt><dd class="big">' + pct(m.precision.value) + '%</dd><dd class="sub">' + c.true_positives + " of " + c.flagged + " flagged drafts had a planted defect</dd></div>" +
      '<div class="stat"><dt>Recall</dt><dd class="big">' + pct(m.recall.value) + '%</dd><dd class="sub">' + c.true_positives + " of " + c.seeded_defects + " planted defects caught</dd></div>" +
      '<div class="stat"><dt>False alarms</dt><dd class="big warn">' + c.false_alarms + '</dd><dd class="sub">of ' + c.clean + " clean drafts flagged</dd></div>" +
      "</dl>" +
      '<p class="caution">Only 24 drafts, so read these loosely: recall could sit anywhere from ' + pct(m.recall.ci95[0]) + " to " + pct(m.recall.ci95[1]) + "%.</p>" +
      '<details class="more" id="more"' + (open ? " open" : "") + "><summary>How the numbers break down</summary>" +
      "<h3>Planted defects</h3><div class=\"units\">" + defUnits + "</div>" +
      '<p class="small">Filled squares were caught. Hatched red squares were missed. Select a square to open that draft.</p>' +
      "<h3>Flagged drafts</h3><div class=\"units\">" + flagUnits + "</div>" +
      '<p class="small">Filled squares were real defects. Hatched red squares were false alarms.</p>' +
      "<h3>Caught, by kind</h3>" +
      '<ul class="kinds">' +
      "<li><span>Visible in the draft</span><b>" + vis.caught + " of " + vis.defective + "</b></li>" +
      "<li><span>Needs the connected system</span><b>" + hid.caught + " of " + hid.defective + "</b></li>" +
      "<li><span>Approval gaps (type A)</span><b>" + e.by_type.A.caught + " of " + e.by_type.A.defective + "</b></li>" +
      "<li><span>Permission gaps (type B)</span><b>" + e.by_type.B.caught + " of " + e.by_type.B.defective + "</b></li>" +
      "</ul>" +
      "<h3>Where it fails: " + esc(e.failure_mode.title.charAt(0).toLowerCase() + e.failure_mode.title.slice(1)) + "</h3>" +
      "<p>" + esc(e.failure_mode.text) + "</p>" +
      '<ul class="missed-list">' + missed + "</ul>" +
      '<p class="small">' + esc(e.meta.caveat) + "</p>" +
      "</details>";
    $("#scorebar").innerHTML =
      "<span><b>" + pct(m.precision.value) + "%</b>precision</span><span><b>" + pct(m.recall.value) + "%</b>recall</span><span><b>" + c.false_alarms + "</b>false alarms</span>";
    $("#scorebar").setAttribute("aria-label", "Precision " + pct(m.precision.value) + " percent, recall " + pct(m.recall.value) + " percent, " + c.false_alarms + " false alarms. Select to jump to the scorecard.");
    markUnits();
  }

  function markUnits() {
    document.querySelectorAll(".unit").forEach((u) => {
      if (u.dataset.id === state.selected) u.setAttribute("aria-current", "true");
      else u.removeAttribute("aria-current");
    });
  }

  // ---------- selection and events ----------
  function select(id, opts) {
    if (!state.byId.has(id)) return;
    opts = opts || {};
    state.selected = id;
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// or sandboxed frame */ }
    renderList();
    renderSheet(true);
    markUnits();
    if (opts.scroll && window.matchMedia("(max-width: 819px)").matches) {
      $("#sheet").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    }
  }

  function step(dir) {
    const order = state.wfs;
    const cur = order.findIndex((w) => w.id === state.selected);
    for (let k = 1; k <= order.length; k++) {
      const w = order[(cur + dir * k + order.length * 2) % order.length];
      if (w.flagged) return select(w.id, { scroll: false });
    }
  }

  function bind() {
    document.addEventListener("click", (ev) => {
      const filter = ev.target.closest("[data-filter]");
      if (filter) { state.filter = filter.dataset.filter; renderFilter(); renderList(); return; }
      const nav = ev.target.closest("[data-nav]");
      if (nav) { step(nav.dataset.nav === "next" ? 1 : -1); return; }
      const pick = ev.target.closest("[data-id]");
      if (pick) select(pick.dataset.id, { scroll: true });
    });
    $("#scorebar").addEventListener("click", () => {
      $("#score").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    });
    $("#truth-switch").addEventListener("click", () => {
      state.truth = !state.truth;
      $("#truth-switch").setAttribute("aria-checked", String(state.truth));
      renderList();
      renderSheet(false);
    });
    $("#rows").addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      const rows = Array.from(document.querySelectorAll(".row"));
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      ev.preventDefault();
      const next = rows[i + (ev.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
    });
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id !== state.selected && state.byId.has(id)) select(id);
    });
  }

  async function init() {
    try {
      await load();
    } catch (err) {
      $("#sheet").innerHTML = '<p class="error">Could not load the data files (' + esc(err.message) + "). If you opened index.html from disk, serve the folder over http instead, for example with python3 -m http.server.</p>";
      $("#score").innerHTML = '<h2 id="score-h">Scorecard</h2>';
      return;
    }
    const wanted = location.hash.slice(1);
    // Opens on the first flagged draft in list order unless the URL names one.
    state.selected = state.byId.has(wanted) ? wanted : state.wfs.find((w) => w.flagged).id;
    renderFilter();
    renderList();
    renderSheet(true);
    renderScore();
    bind();
  }

  init();
})();
