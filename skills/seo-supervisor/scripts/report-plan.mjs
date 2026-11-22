// @ts-check
// The report's /seo-setup plan section as stats, HTML and Markdown. The plan's shape is in report-format.md.
import { safeUrl } from "./lib/recheck.mjs";

const STATUSES = ["exists", "to-build", "built", "to-create"];
const LABEL = { exists: "Already right", "to-build": "To build", built: "Built", "to-create": "To create" };
const PLAN_LABEL = {
  proposed: "Proposed: waiting for your approval",
  approved: "Approved: being built",
  built: "Built",
};
const NEEDS = { copy: "Copy", facts: "Facts", decision: "A decision", yes: "Your yes" };

const key = r => r.url || r.pattern || "";
const isDone = r => r.status === "exists" || r.status === "built";
const ownerOpen = r => r.owner && r.owner.done !== true && r.owner.declined !== true;
const yesOpen = y => y.approved !== true && y.declined !== true;
// Only an http(s) URL or a plain relative path (drafts/privacy.md) is linked. Anything else (javascript:, data:,
// //host, \\server) shows as text, so a click can't run a script in the report. Paths with spaces or non-ASCII letters
// are text too; widen the pattern if real drafts need them.
const draftHref = d => (typeof d === "string" ? safeUrl(d) || (/^[\w.~-][\w.~%+/-]*$/.test(d) ? d : null) : null);

export function planStats(plan) {
  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let done = 0;
  for (const r of pages) {
    if (r.status in byStatus) byStatus[r.status]++;
    if (isDone(r)) done += 1;
    else if (r.pattern && r.count > 0) done += Math.min(1, Math.max(0, (Number(r.built) || 0) / r.count));
  }
  const yesItems = (plan?.yes || []).filter(yesOpen).length;
  return {
    rows: pages.length,
    byStatus,
    progress: pages.length ? Math.round((100 * done) / pages.length) : 0,
    ownerOpen: pages.filter(ownerOpen).length,
    yesOpen: yesItems + pages.filter(r => ownerOpen(r) && r.owner.needs === "yes").length,
  };
}

/**
 * @param {any} plan
 * @param {{ esc: (s: any) => string, inl: (s: any) => string, num: (n: any) => string, traffic?: (url: string) => string | null }} helpers
 */
export function planHtml(plan, { esc, inl, num, traffic = () => null }) {
  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  const s = planStats(plan);
  const chip = st => `<span class="pchip s-${esc(st)}">${esc(LABEL[st] || st)}</span>`;
  const head = `<section class="panel plan-sum" aria-labelledby="h-plan">
    <div class="ph"><h2 id="h-plan">SEO plan</h2><span class="sub">${esc(PLAN_LABEL[plan.status] || plan.status || "")}${plan.approvedOn ? ` · approved ${esc(plan.approvedOn)}` : ""}</span></div>
    <div class="plan-prog">
      <p class="plan-n"><span class="n">${s.progress}%</span>of the agent's work is done</p>
      <div class="pbar" role="img" aria-label="Plan progress: ${s.progress}% of the agent's work is done"><i style="width:${s.progress}%"></i></div>
    </div>
    <ul class="plan-counts">${STATUSES.filter(st => s.byStatus[st])
      .map(st => `<li>${chip(st)}<b>${num(s.byStatus[st])}</b></li>`)
      .join("")}${s.ownerOpen ? `<li><span class="own">Needs you</span><b>${num(s.ownerOpen)}</b></li>` : ""}</ul>
    ${plan.summary ? `<p class="plan-summary">${inl(plan.summary)}</p>` : ""}
    ${fixesLine(
      plan,
      n => num(n),
      ids => ids.map(id => `<a href="#${esc(id)}">${esc(id)}</a>`).join(", "),
    )}
  </section>`;
  if (!pages.length)
    return `<div class="plan">${head}<section class="panel empty-state"><h2>No pages in this plan yet</h2><p>Run /seo-setup to propose one.</p></section></div>`;

  const yes = [
    ...(plan.yes || [])
      .filter(yesOpen)
      .map(
        y =>
          `<li><b>${esc(y.id || "")}</b> ${inl(y.what)}${y.why ? `<span class="quiet"> · ${inl(y.why)}</span>` : ""}</li>`,
      ),
    ...pages
      .filter(r => ownerOpen(r) && r.owner.needs === "yes")
      .map(r => `<li><code>${esc(key(r))}</code> ${inl(r.owner.what || "")}</li>`),
  ];
  const declined = [
    ...(plan.yes || []).filter(y => y.declined === true).map(y => `<b>${esc(y.id || "")}</b> ${inl(y.what)}`),
    ...pages
      .filter(r => r.owner && r.owner.declined === true)
      .map(r => `<code>${esc(key(r))}</code> ${inl(r.owner.what || "")}`),
  ];
  const yesHtml =
    yes.length || declined.length
      ? `<section class="panel plan-yes" aria-labelledby="h-yes"><h2 id="h-yes">Needs your yes</h2>
    ${yes.length ? `<p class="quiet">Each of these changes needs its own yes before the agent makes it. Approving the plan doesn't cover them.</p><ol>${yes.join("")}</ol>` : `<p class="quiet">Nothing is waiting for your yes.</p>`}
    ${declined.length ? `<p class="plan-declined"><span class="quiet">Declined by you, so the agent won't make these changes:</span> ${declined.join("; ")}</p>` : ""}</section>`
      : "";

  // Site structure from `parent`; rows whose parent isn't in the plan are roots.
  const keys = new Set(pages.map(key));
  const kids = new Map();
  for (const r of pages) {
    const p = keys.has(r.parent) && r.parent !== key(r) ? r.parent : "";
    (kids.get(p) || kids.set(p, []).get(p)).push(r);
  }
  const seen = new Set();
  const tree = parent => {
    const list = (kids.get(parent) || []).filter(r => !seen.has(key(r)));
    if (!list.length) return "";
    return `<ul>${list
      .map(r => {
        seen.add(key(r));
        return `<li><code>${esc(key(r))}</code>${r.pattern ? ` <span class="pcount">×${num(r.count || 0)}</span>` : ""} ${chip(r.status)}${tree(key(r))}</li>`;
      })
      .join("")}</ul>`;
  };
  const treeHtml = `<section class="panel plan-tree" aria-labelledby="h-tree"><h2 id="h-tree">Site structure</h2>${tree("")}</section>`;

  const field = (label, v) =>
    v == null || v === "" || (Array.isArray(v) && !v.length)
      ? ""
      : `<dt>${label}</dt><dd>${Array.isArray(v) ? v.map(x => inl(x)).join(", ") : inl(v)}</dd>`;
  const row = r => {
    const o = r.owner;
    return `<details class="prow" data-status="${esc(r.status)}">
      <summary><span class="pu"><code>${esc(key(r))}</code>${r.pattern ? ` <span class="pcount">×${num(r.count || 0)}</span>` : ""}</span><span class="pt">${r.target ? esc(r.target) : `<span class="quiet">—</span>`}</span><span class="ptype">${esc(r.type || "")}</span><span class="pst">${chip(r.status)}${ownerOpen(r) ? `<span class="own">Needs you</span>` : ""}</span></summary>
      <dl class="pd">${field("Intent", r.intent)}${r.url ? field("Search traffic", traffic(r.url)) : ""}${field("Other targets", r.secondary)}${field(r.pattern ? "Title template" : "Title", r.title)}${field(r.pattern ? "Description template" : "Description", r.description)}${field(r.pattern ? "H1 template" : "H1", r.h1)}${field("Intro", r.intro)}${field("Schema", r.schema)}${field("Parent", r.parent)}${field("Links to", r.linksTo)}${r.from ? field("Moves from", `${r.from} → ${key(r)}`) : ""}${r.pattern && r.count ? field("Built", `${num(r.status === "built" || r.status === "exists" ? r.count : Number(r.built) || 0)} of ${num(r.count)}`) : ""}${(r.samples || []).length ? `<dt>Examples</dt><dd><ul class="psamples">${r.samples.map(x => `<li><code>${esc(x.url)}</code>${x.title ? ` ${esc(x.title)}` : ""}</li>`).join("")}</ul></dd>` : ""}${o ? `<dt>${o.done === true ? "Done by you" : "Needs you"}</dt><dd>${esc(NEEDS[o.needs] || o.needs || "")}: ${inl(o.what || "")}${o.draft ? (draftHref(o.draft) ? ` · <a href="${esc(draftHref(o.draft))}">Read the draft</a>` : ` · Draft: <code>${esc(o.draft)}</code>`) : ""}</dd>` : ""}${r.finding ? `<dt>Finding</dt><dd><a href="#${esc(r.finding)}">${esc(r.finding)}</a></dd>` : ""}</dl>
    </details>`;
  };
  const present = STATUSES.filter(st => s.byStatus[st]);
  const tableHtml = `<section class="panel plan-pages" aria-labelledby="h-pages">
    <div class="ph"><h2 id="h-pages">Pages</h2><div class="seg" role="group" aria-label="Filter pages by status"><button type="button" class="segb" data-pstatus="all" aria-pressed="true">All</button>${present.map(st => `<button type="button" class="segb" data-pstatus="${st}" aria-pressed="false">${LABEL[st]}<span class="mono">${s.byStatus[st]}</span></button>`).join("")}</div></div>
    <div class="prow-h" aria-hidden="true"><span>Page</span><span>Targets</span><span>Type</span><span>Status</span></div>
    ${pages.map(row).join("")}
  </section>`;
  return `<div class="plan">${head}${yesHtml}${treeHtml}${tableHtml}</div>`;
}

export const PLAN_CSS = `
.plan{display:grid;gap:18px}
.plan-prog{display:grid;gap:8px;margin-top:14px}
.plan-n{color:var(--mute);font-size:13.5px}.plan-n .n{font:700 34px/1 var(--display);letter-spacing:-.02em;color:var(--ink);margin-right:8px}
.pbar{height:10px;border-radius:5px;background:var(--line2);overflow:hidden}.pbar i{display:block;height:100%;background:var(--pass)}
.plan-counts{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13.5px}
.plan-counts li{display:inline-flex;align-items:center;gap:6px}.plan-counts b{font:600 13px var(--mono);color:var(--ink)}
.plan-summary{margin-top:14px;color:var(--ink2);max-width:78ch}
.plan-fixes{margin-top:10px;color:var(--ink2);font-size:14px}
.pchip{display:inline-block;font:600 12px/1.6 var(--sans);padding:0 9px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.pchip.s-exists{color:var(--mute);border-color:var(--line2)}
.pchip.s-to-build{color:var(--blue);background:var(--blue-soft)}
.pchip.s-built{color:var(--b5-ink);background:var(--ok-soft)}
.pchip.s-to-create{color:var(--ink2);border-color:var(--ink2)}
.plan-yes ol{margin:12px 0 0;padding-left:22px;display:grid;gap:8px}
.plan-declined{margin-top:12px;font-size:14px}
.plan-tree ul{list-style:none;margin:0;padding-left:20px;border-left:1px solid var(--line)}
.plan-tree h2+ul{padding-left:0;border-left:0;margin-top:10px}
.plan-tree li{padding:4px 0}.plan-tree li>ul{margin-top:4px}
.plan-tree code,.pu code,.psamples code{font:500 13px var(--mono);overflow-wrap:anywhere}
.pcount{font:500 12px var(--mono);color:var(--mute)}
.plan-pages .ph{flex-wrap:wrap;gap:10px}
.prow-h,.prow>summary{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,2fr) minmax(0,1.3fr) minmax(150px,auto);gap:12px;align-items:center}
.prow-h span:last-child{text-align:right}
.prow-h{margin-top:12px;padding:8px 12px;font-size:12px;font-weight:600;color:var(--mute);border-bottom:1px solid var(--line)}
.prow{border-bottom:1px solid var(--line)}.prow[hidden]{display:none}
.prow>summary{padding:12px;cursor:pointer;list-style:none;border-radius:6px}
.prow>summary::-webkit-details-marker{display:none}
.prow>summary:hover{background:var(--bg)}
.prow>summary:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.pu{min-width:0}.pt{min-width:0;color:var(--ink2);font-size:14px;overflow-wrap:anywhere}.ptype{color:var(--mute);font-size:13.5px}
.pst{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pd{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 16px;margin:0;padding:4px 12px 16px;font-size:14px}
.pd dt{color:var(--mute);font-weight:600;font-size:12.5px;padding-top:2px}.pd dd{margin:0;overflow-wrap:anywhere}
.psamples{list-style:none;margin:0;padding:0;display:grid;gap:4px}
@media (max-width:560px){.prow-h{display:none}.prow>summary{grid-template-columns:minmax(0,1fr);gap:4px}.pst{justify-content:flex-start}.pd{grid-template-columns:minmax(0,1fr);gap:2px}.pd dt{margin-top:8px}}
`;

// The audit findings setup fixes in code after approval (plan.alsoFixes), as one sentence.
function fixesLine(plan, count, list, html = true) {
  const ids = Array.isArray(plan.alsoFixes) ? plan.alsoFixes : [];
  if (!ids.length) return "";
  const what = `${count(ids.length)} audit finding${ids.length === 1 ? "" : "s"} in code`;
  const text =
    plan.status === "built"
      ? `Setup also fixed ${what}: ${list(ids)}`
      : `After the build, setup also fixes ${what}: ${list(ids)}`;
  return html ? `<p class="plan-fixes">${text}</p>` : `${text}.`;
}

const cell = v =>
  String(Array.isArray(v) ? v.join(", ") : (v ?? ""))
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");

export function planMarkdown(plan) {
  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  const s = planStats(plan);
  const L = ["## SEO plan", ""];
  L.push(
    `Status: ${PLAN_LABEL[plan.status] || plan.status || "?"}${plan.approvedOn ? ` (approved ${plan.approvedOn})` : ""} · Progress: ${s.progress}% · ${
      STATUSES.filter(st => s.byStatus[st])
        .map(st => `${s.byStatus[st]} ${LABEL[st].toLowerCase()}`)
        .join(", ") || "no pages"
    }${s.ownerOpen ? ` · ${s.ownerOpen} need you` : ""}`,
    "",
  );
  if (plan.summary) L.push(plan.summary, "");
  const fixes = fixesLine(plan, String, ids => ids.join(", "), false);
  if (fixes) L.push(fixes, "");
  const yes = [
    ...(plan.yes || []).filter(yesOpen).map(y => `- ${y.id ? `${y.id}: ` : ""}${y.what}${y.why ? ` (${y.why})` : ""}`),
    ...pages.filter(r => ownerOpen(r) && r.owner.needs === "yes").map(r => `- ${key(r)}: ${r.owner.what || ""}`),
  ];
  if (yes.length)
    L.push("### Needs your yes", "", "Each needs its own yes; approving the plan doesn't cover them.", "", ...yes, "");
  for (const y of (plan.yes || []).filter(y => y.declined === true))
    L.push(`Declined: ${y.id ? `${y.id}: ` : ""}${y.what}`);
  for (const r of pages.filter(r => r.owner && r.owner.declined === true))
    L.push(`Declined: ${key(r)}: ${r.owner.what || ""}`);
  if ((plan.yes || []).some(y => y.declined === true) || pages.some(r => r.owner && r.owner.declined === true))
    L.push("");
  if (!pages.length) {
    L.push("No pages in this plan yet.", "");
    return L;
  }
  L.push(
    "| Page | Type | Status | Target | Title | Description | H1 | Schema | Parent | Needs you |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of pages) {
    const page = r.pattern ? `${r.pattern} ×${r.count || 0}` : r.url;
    const owner = ownerOpen(r)
      ? `${NEEDS[r.owner.needs] || r.owner.needs}: ${r.owner.what || ""}${r.owner.draft ? ` (draft: ${r.owner.draft})` : ""}`
      : "";
    L.push(
      `| ${cell(page)} | ${cell(r.type)} | ${cell(LABEL[r.status] || r.status)} | ${cell(r.target)} | ${cell(r.title)} | ${cell(r.description)} | ${cell(r.h1)} | ${cell(r.schema)} | ${cell(r.parent)} | ${cell(owner)} |`,
    );
  }
  L.push("");
  const intros = pages.filter(r => r.intro);
  if (intros.length)
    L.push(
      "Intros for new pages (approving the plan approves these words):",
      "",
      ...intros.map(r => `- ${key(r)}: ${r.intro}`),
      "",
    );
  return L;
}
