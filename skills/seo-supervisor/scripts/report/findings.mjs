// @ts-check
// The Findings, Decisions, Changes, Passed and Limits tabs.
import { SEV, isOpen } from "../lib/score.mjs";
import { recheckOf, RECHECK_NOTE } from "../lib/recheck.mjs";
import { SEV_LABEL, STATUS_LABEL, ICON, dot, esc, inl, link, num } from "./format.mjs";
import { needsYou } from "./model.mjs";
import { actions, isOwnersCall } from "./overview.mjs";

// A finding's optional effort; an unknown value shows nothing.
const EFFORT = { quick: "under 30 minutes", hours: "an hour or two", "half-day": "half a day or more" };
export const effortOf = f =>
  typeof f.effort === "string" && Object.hasOwn(EFFORT, f.effort) ? `Effort: ${EFFORT[f.effort]}` : "";
// The re-check command's URL may come from the crawl, so it's escaped.
const recheckHtml = f => {
  const r = recheckOf(f);
  return r
    ? `<div class="ev recheck"><h4>Check the fix yourself</h4><p><code>${esc(r.command)}</code></p><p class="quiet">${esc(r.hint)}</p></div>`
    : "";
};
// Plain text with the command in backticks: inl renders it on the page, mdSafe in the Markdown. Fix mode asks first
// on anything isOwnersCall() marks.
export const nextStep = (f, decisions = []) =>
  !isOpen(f) || f.status === "wont-fix" || !f.id
    ? ""
    : `\`/seo-fix ${f.id}\` ${isOwnersCall(f, decisions) ? "asks you first: the agent won't change this without your go-ahead." : "fixes it and checks the fix."}`;

export function findingTabs(m, { trafficHtml, clarityHtml }) {
  const { findings, decisions, fixed, passed, notChecked, notes, mdFile, notShown = [] } = m;
  const anyRecheck = () => findings.some(f => recheckOf(f));
  const recheckNote = () => anyRecheck() && { title: "Checking a fix yourself", blocks: [{ quiet: RECHECK_NOTE }] };
  function evidenceHtml(f) {
    const ev = f.evidence || [];
    if (!ev.length) return "";
    const shown = ev.slice(0, 10);
    const listedRest = ev.length - shown.length;
    const total = Math.max(f.count || 0, ev.length);
    const notes = [];
    if (listedRest > 0)
      notes.push(
        `${num(listedRest)} more ${listedRest === 1 ? "example" : "examples"}${mdFile ? ` in <code>${esc(mdFile)}</code>` : ""}`,
      );
    if (total > ev.length) notes.push(`${num(total)} cases found in total; these are examples`);
    return `<div class="ev"><h4>Evidence</h4><div class="tablewrap"><table><thead><tr><th scope="col">Where</th><th scope="col">Detail</th></tr></thead><tbody>${shown.map(e => `<tr><td>${e.url ? link(e.url, esc(e.url)) : ""}${e.file ? `${e.url ? "<br>" : ""}<code>${esc(e.file)}${e.line ? ":" + esc(e.line) : ""}</code>` : ""}</td><td>${inl(e.detail || "")}</td></tr>`).join("")}</tbody></table></div>${notes.length ? `<p class="quiet">${notes.join(". ")}.</p>` : ""}</div>`;
  }
  function findingHtml(f) {
    const isFixed = !isOpen(f);
    return `<article class="f ${isFixed ? "is-fixed" : ""}" id="${esc(f.id)}" data-sev="${f.severity}" data-status="${esc(f.status)}" data-area="${esc(f.category)}" data-text="${esc([f.id, f.rule, f.title, f.what, f.category].join(" ").toLowerCase())}">
    <h3><button class="f-head" aria-expanded="false" aria-controls="${esc(f.id)}-b">
      ${dot(f.severity)}
      <span class="f-title">${inl(f.title)}</span>
      <span class="f-meta"><span class="sev-t">${SEV_LABEL[f.severity]}</span>${needsYou(f) ? `<span class="own">Needs you</span>` : ""}<span>${esc(f.category)}</span>${f.rule ? `<span class="mono">${esc(f.rule)}</span>` : ""}${f.count > 1 ? `<span class="mono">${num(f.count)}×</span>` : ""}${effortOf(f) ? `<span>${esc(effortOf(f))}</span>` : ""}</span>
      ${isFixed ? `<span class="stamp">${ICON.check}Fixed</span>` : `<span class="st st-${esc(f.status)}">${esc(STATUS_LABEL[f.status] || f.status)}</span>`}
      ${ICON.chevron}
    </button></h3>
    <div class="f-body" id="${esc(f.id)}-b" role="region" aria-label="${esc(f.title)}">
      <div class="f-cols">
        <div>
          ${f.what ? `<h4>What's wrong</h4><p>${inl(f.what)}</p>` : ""}
          ${f.why ? `<h4>Why it matters</h4><p>${inl(f.why)}</p>` : ""}
        </div>
        <div>
          ${f.fix ? `<div class="howfix"><h4>How to fix</h4><p>${inl(f.fix)}</p></div>` : ""}
          ${f.decision ? `<div class="dec-inline"><h4>Decision needed</h4><p>${inl(f.decision.question || "")}</p>${(f.decision.options || []).length ? `<ul>${f.decision.options.map(o => `<li>${inl(o)}</li>`).join("")}</ul>` : ""}${f.decision.recommendation ? `<p><strong>Recommended:</strong> ${inl(f.decision.recommendation)}</p>` : ""}</div>` : ""}
          ${isFixed && f.fixed ? `<div class="donebox"><h4>What was done</h4><p>${inl(f.fixed.summary || "")}</p>${(f.fixed.files || []).length ? `<p class="files">${f.fixed.files.map(x => `<code>${esc(x)}</code>`).join(" ")}</p>` : ""}${f.fixed.verified ? `<p class="quiet">${ICON.check} ${inl(f.fixed.verified)}</p>` : ""}</div>` : ""}
        </div>
      </div>
      ${trafficHtml(f)}${clarityHtml(f)}${evidenceHtml(f)}${nextStep(f, decisions) ? `<div class="ev next"><h4>Next step</h4><p>${inl(nextStep(f, decisions))}</p></div>` : ""}${recheckHtml(f)}
    </div>
  </article>`;
  }
  // extra: panels render-report.mjs appends after the list.
  function findingsHtml(extra = "") {
    if (!findings.length)
      return `<section class="panel empty-state"><h2>No findings</h2><p>Every checked rule passed. See Passed for what was checked and Limits for what wasn't.</p></section>${extra}`;
    const sevPresent = SEV.filter(s => findings.some(f => f.severity === s));
    const areasPresent = [...new Set(findings.map(f => f.category))].sort();
    const statuses = [...new Set(findings.map(f => f.status))];
    return `<div class="toolbar" role="group" aria-label="Filter findings">
      <label class="search">${ICON.search}<span class="sr">Search findings</span><input type="search" id="q" placeholder="Search title, rule or ID" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Severity"><button type="button" class="segb" data-sev="all" aria-pressed="true">All</button>${sevPresent.map(s => `<button type="button" class="segb" data-sev="${s}" aria-pressed="false">${dot(s)}${SEV_LABEL[s]}<span class="mono">${findings.filter(f => f.severity === s).length}</span></button>`).join("")}</div>
      <label class="sel"><span class="sr">Status</span><select id="fstatus"><option value="all">Any status</option>${statuses.map(s => `<option value="${esc(s)}">${esc(STATUS_LABEL[s] || s)}</option>`).join("")}</select></label>
      <label class="sel"><span class="sr">Area</span><select id="farea"><option value="all">All areas</option>${areasPresent.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select></label>
      <p class="showing" id="showing" aria-live="polite">${findings.length} findings</p>
    </div>
    <div class="flist" id="flist">${findings.map(findingHtml).join("")}</div>
    <p class="empty" id="fnone" hidden>No findings match these filters. <button type="button" class="link" id="freset">Clear filters</button></p>${extra}`;
  }

  // Decisions, then the fixBy: "owner" tasks, so everything the Overview marks "Needs you" is on one tab.
  const { tasks } = actions(m);
  const tasksHtml = () =>
    tasks.length
      ? `<section class="panel"><h2>Your tasks</h2><p class="quiet">Findings only you can resolve: a setting on your host or an account, your content or your facts. The agent won't change them without your go-ahead.</p><ul class="lim">${tasks.map(f => `<li><b><a href="#${esc(f.id)}">${esc(f.id)}</a></b><span>${inl(f.title)} · ${SEV_LABEL[f.severity]}</span></li>`).join("")}</ul></section>`
      : "";
  const decisionsHtml = () =>
    decisions.length || tasks.length
      ? `${
          decisions.length
            ? `<div class="cards">${decisions
                .map(
                  d => `<article class="panel dcard">
    ${d.id ? (findings.some(f => f.id === d.id) ? `<a class="mono idlink" href="#${esc(d.id)}">${esc(d.id)}</a>` : `<span class="mono idlink">${esc(d.id)}</span>`) : ""}
    <h3>${inl(d.question)}</h3>${d.context ? `<p>${inl(d.context)}</p>` : ""}
    ${(d.options || []).length ? `<ul class="opts">${d.options.map(o => `<li>${inl(o)}</li>`).join("")}</ul>` : ""}
    ${d.recommendation ? `<p class="rec"><strong>Recommended</strong> ${inl(d.recommendation)}</p>` : ""}
  </article>`,
                )
                .join("")}</div>`
            : ""
        }${tasksHtml()}`
      : `<section class="panel empty-state"><h2>No decisions needed</h2><p>Nothing in this audit needs an owner's call.</p></section>`;
  const changesHtml = () =>
    fixed.length
      ? `<ol class="changes">${fixed
          .map(
            f => `<li class="panel">
    <span class="stamp">${ICON.check}Fixed</span>
    <div><h3><a href="#${esc(f.id)}">${inl(f.title)}</a></h3>
    ${f.fixed?.summary ? `<p>${inl(f.fixed.summary)}</p>` : ""}
    ${(f.fixed?.files || []).length ? `<p class="files">${f.fixed.files.map(x => `<code>${esc(x)}</code>`).join(" ")}</p>` : ""}
    ${f.fixed?.verified ? `<p class="quiet">${ICON.check} ${inl(f.fixed.verified)}</p>` : ""}</div>
    <span class="mono quiet">${esc(f.id)}</span>
  </li>`,
          )
          .join("")}</ol>`
      : `<section class="panel empty-state"><h2>No changes yet</h2><p>Run <code>/seo-fix</code> to fix findings. Each fix is re-checked and listed here with the files it touched.</p></section>`;
  function passedHtml() {
    const fixedRules = fixed.map(f => ({
      rule: f.rule || f.id,
      title: f.title,
      category: f.category,
      detail: "fixed this run",
    }));
    const all = [...passed, ...fixedRules.filter(x => !passed.some(p => p.rule === x.rule))];
    if (!all.length)
      return `<section class="panel empty-state"><h2>No passed rules recorded</h2><p>This file lists findings only.</p></section>`;
    const groups = all.reduce((m, p) => ((m[p.category || "Other"] ||= []).push(p), m), {});
    return `<div class="pgrid">${Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([c, ps]) =>
          `<section class="panel pgroup"><h3>${esc(c)}<span class="mono quiet">${ps.length}</span></h3><ul>${ps.map(p => `<li>${ICON.check}<span><span class="mono quiet">${esc(p.rule)}</span> ${inl(p.title)}${p.detail ? `<span class="quiet"> · ${inl(p.detail)}</span>` : ""}</span></li>`).join("")}</ul></section>`,
      )
      .join("")}</div>`;
  }
  // notShown (report/sources.mjs) lists results that couldn't be shown: unreadable, for another site or out of date.
  // extra: panels render-report.mjs adds, such as the check settings.
  const limitsHtml = (extra = "") =>
    notChecked.length || notes.length || notShown.length || extra
      ? `<div class="limits">
  ${notChecked.length ? `<section class="panel"><h2>Not checked</h2><p class="quiet">These couldn't be verified in this run, so they count neither for nor against the score.</p><ul class="lim">${notChecked.map(n => `<li><b>${inl(n.area || n.rule || "")}</b><span>${inl(n.reason || "")}</span></li>`).join("")}</ul></section>` : ""}
  ${notShown.length ? `<section class="panel"><h2>Not shown</h2><p class="quiet">Results that were produced but can't be shown in this report, and why. Information only: they never change the score.</p><ul class="lim">${notShown.map(n => `<li><b>${esc(n.what)}</b><span>${esc(n.why)}</span></li>`).join("")}</ul></section>` : ""}
  ${notes.length ? `<section class="panel"><h2>Notes from the audit</h2><ul class="lim">${notes.map(n => `<li><span>${inl(n)}</span></li>`).join("")}</ul></section>` : ""}${extra}
</div>`
      : `<section class="panel empty-state"><h2>No limits recorded</h2><p>Every planned check ran.</p></section>`;
  return {
    findingsHtml,
    decisionsHtml,
    changesHtml,
    passedHtml,
    limitsHtml,
    recheckNote,
    decisionCount: decisions.length + tasks.length,
  };
}
