// @ts-check
// The Overview tab, action first. Information panels belong on the topic tabs (render-report.mjs).
import { SEV, bandOf, OWN_SCORE } from "../lib/score.mjs";
import { SEV_LABEL, ICON, dot, esc, inl, num, plural } from "./format.mjs";
import { needsYou } from "./model.mjs";

// The health score is a local formula, and the text says so.
export const SCORE_IS_OURS = `This is ${OWN_SCORE}: it counts only the rules this audit checked, and search engines don't use it.`;

function scoreScale(v) {
  /** @type {[number, number, string][]} */
  const segs = [
    [0, 40, "b1"],
    [40, 60, "b2"],
    [60, 75, "b3"],
    [75, 90, "b4"],
    [90, 100, "b5"],
  ];
  return `<div class="scale" role="img" aria-label="Score ${v} on a 0 to 100 scale: 0–39 critical, 40–59 poor, 60–74 fair, 75–89 good, 90–100 excellent">
    <div class="track">${segs.map(([a, b, c]) => `<span class="${c}" style="flex:${b - a}"></span>`).join("")}</div>
    <span class="marker" style="left:${v}%"><b>${v}</b></span>
    <div class="ticks">${[0, 40, 60, 75, 90, 100].map(t => `<span style="left:${t}%">${t}</span>`).join("")}</div>
  </div>`;
}
function unlockHtml({ unlock, overall, openBlockers }, delta) {
  if (!unlock) return "";
  const [, name, cls] = bandOf(unlock.value);
  const ids = list => list.map(f => `<a href="#${esc(f.id)}">${esc(f.id)}</a>`).join(", ");
  const owner = openBlockers.filter(needsYou),
    agent = openBlockers.filter(f => !needsYou(f));
  const who = [
    owner.length &&
      `${ids(owner)} need${owner.length === 1 ? "s" : ""} you: the agent won't change ${owner.length === 1 ? "it" : "them"} without your go-ahead.`,
    agent.length && `${ids(agent)} can be fixed with <code>/seo-fix</code>.`,
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="unlock">
        <p class="u-k">Fix ${openBlockers.length === 1 ? "the blocker" : `the ${openBlockers.length} blockers`} and the score rises to</p>
        <p class="u-v"><span class="from">${overall.value}</span><span class="arrow" aria-hidden="true">→</span><span class="to ${cls}-t">${unlock.value}</span><span class="chip ${cls}">${name}</span></p>
        ${delta && delta.inUnlock ? `<p class="u-s delta ${delta.dir}">${delta.html}.</p>` : ""}
        ${who ? `<p class="u-s">${who}</p>` : ""}
      </div>`;
}

/**
 * m is the model from model.mjs; the rest are the one-line summaries (overview-lines.mjs, traffic.mjs), the score
 * views and the panels' HTML, in order.
 */
export function overviewHtml(
  m,
  {
    speedText,
    labSpeedText,
    lcpText,
    lighthouseText,
    authorityText,
    ahrefsCredit,
    desktopSpeedText,
    positionsText,
    analyticsSplitLines,
    googleUpdatesText,
    searchLines,
    viewsHtml,
    panelsHtml,
  },
) {
  const { overall, deltaOf, countSev, open, fixed, findings, notChecked, verdict, impact, areas } = m;
  if (!overall)
    return `<section class="panel empty-state"><h2>Nothing to score</h2><p>This file has no findings or passed rules. Run the audit to fill it.</p></section>`;
  const [, bandName, bandCls] = bandOf(overall.value);
  const capLine = overall.cap
    ? `${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed.`
    : `${overall.passing} of ${overall.rules} checked rules pass in full.`;
  const delta = deltaOf();
  const sevBar = SEV.map(s => [s, countSev(s)]).filter(([, n]) => n);
  const totalOpen = open.length;
  const fixFirst = open.filter(f => ["blocker", "high", "needs-decision"].includes(f.severity)).slice(0, 5);
  const fallbackFirst = fixFirst.length ? fixFirst : open.slice(0, 3);
  return `
  <div class="ov-top">
    <div class="ov-left">
    <section class="panel score-panel" aria-labelledby="h-score">
      <h2 id="h-score">SEO health score</h2>
      <p class="big ${bandCls}-t"><span class="n">${overall.value}</span><span class="of">/100</span></p>
      <p class="band"><span class="chip ${bandCls}">${bandName}</span><span class="verdict">${esc(verdict)}</span></p>
      ${scoreScale(overall.value)}
      <p class="cap">${esc(capLine)}</p>
      ${unlockHtml(m, delta)}
      ${delta && !delta.inUnlock ? `<p class="delta ${delta.dir}">${delta.html}</p>` : ""}
      <details class="how"><summary>How this score works</summary>
        <p>Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area. ${SCORE_IS_OURS}</p>
      </details>
    </section>
    <section class="panel stats" aria-label="Issues, fixes and rules">
      <div class="stat">
        <h3>Open issues</h3>
        <p class="stat-n"><span class="n">${totalOpen}</span>${totalOpen ? "" : " · nothing open"}</p>
        ${
          totalOpen
            ? `<div class="stack" role="img" aria-label="${sevBar.map(([sv, n]) => `${n} ${SEV_LABEL[sv]}`).join(", ")}">${sevBar.map(([sv, n]) => `<span class="s-${sv}" style="flex:${n}"></span>`).join("")}</div>
        <ul class="legend">${sevBar.map(([sv, n]) => `<li>${dot(sv)}<span>${SEV_LABEL[sv]}</span><b>${n}</b></li>`).join("")}</ul>`
            : ""
        }
      </div>
      <div class="stat">
        <h3>Fixed this run</h3>
        <p class="stat-n"><span class="n">${fixed.length}</span> of ${findings.length}</p>
        <div class="stack" role="img" aria-label="${fixed.length} fixed, ${open.length} still open"><span class="s-fixed" style="flex:${fixed.length || 0.0001}"></span><span class="s-rest" style="flex:${open.length || 0.0001}"></span></div>
        <p class="quiet">${fixed.length ? `${num(open.length)} still open` : "Run /seo-fix to start"}</p>
      </div>
      <div class="stat">
        <h3>Rules checked</h3>
        <p class="stat-n"><span class="n">${overall.passing}</span> of ${overall.rules} pass</p>
        <div class="stack" role="img" aria-label="${overall.passing} pass, ${overall.rules - overall.passing} with open findings"><span class="s-pass" style="flex:${overall.passing || 0.0001}"></span><span class="s-fail" style="flex:${overall.rules - overall.passing || 0.0001}"></span></div>
        <p class="quiet"><span class="key k-fail" aria-hidden="true"></span>${num(overall.rules - overall.passing)} failing${notChecked.length ? ` · ${num(notChecked.length)} not checked` : ""}</p>
      </div>
    </section>
    ${speedText() ? `<p class="quiet">${esc(speedText())}</p>` : ""}${labSpeedText() ? `\n    <p class="quiet">${esc(labSpeedText())}</p>` : ""}${lcpText() ? `\n    <p class="quiet">${esc(lcpText())}</p>` : ""}${lighthouseText() ? `\n    <p class="quiet">${esc(lighthouseText())}</p>` : ""}${authorityText() ? `\n    <p class="quiet">${esc(authorityText())}${ahrefsCredit() ? ` · <a href="${esc(ahrefsCredit().url)}" rel="noopener">${esc(ahrefsCredit().text)}</a>` : ""}</p>` : ""}${desktopSpeedText() ? `\n    <p class="quiet">${esc(desktopSpeedText())}</p>` : ""}${positionsText() ? `\n    <p class="quiet">${esc(positionsText())}</p>` : ""}${analyticsSplitLines()
      .map(t => `\n    <p class="quiet">${esc(t)}</p>`)
      .join("")}
    ${googleUpdatesText() ? `<p class="quiet">${googleUpdatesText(true)}</p>\n    ` : ""}</div>
    <div class="ov-right">
    <section class="panel factors" aria-labelledby="h-factors">
      <div class="ph"><h2 id="h-factors">What's moving your score</h2><span class="sub">Points lost, biggest first</span></div>
      <ol class="area-list">${(() => {
        const maxPts = Math.max(impact.cap, ...impact.rows.map(x => x.pts), 1);
        const bar = pts =>
          `<span class="meter" aria-hidden="true"><i style="width:${Math.max(4, (100 * pts) / maxPts)}%"></i></span>`;
        const rows = [];
        if (impact.cap > 0)
          rows.push(`<li><a class="area" href="#findings" data-sev="blocker">${dot("blocker")}
          <span class="an"><b>Blocker cap</b><span class="reason">${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed</span></span>
          ${bar(impact.cap)}<span class="as">−${impact.cap}<small>pts</small></span></a></li>`);
        for (const { a, pts } of impact.rows) {
          const line = a.top.length
            ? `${inl(a.top[0].title)}${a.top.length > 1 ? ` <span class="more">+${a.top.length - 1} more</span>` : ""}`
            : "All checks pass";
          rows.push(`<li><a class="area" href="#findings" data-area="${esc(a.name)}">${a.worst ? dot(a.worst) : `<i class="dot d-pass" aria-hidden="true"></i>`}
          <span class="an"><b>${esc(a.name)} <span class="ascore">${a.value}/100</span></b><span>${line}</span></span>
          ${bar(pts)}<span class="as">${pts ? `−${pts}` : "<1"}<small>pts</small></span></a></li>`);
        }
        const full = areas.filter(a => a.value === 100);
        if (full.length) {
          const fx = full.reduce((t, a) => t + a.fixedHere, 0);
          rows.push(`<li><a class="area" href="#passed"><i class="dot d-pass" aria-hidden="true"></i>
          <span class="an"><b>${plural(full.length, "area")} pass in full</b><span>${esc(full.map(a => a.name).join(", "))}${fx ? ` · ${fx} fixed this run` : ""}</span></span>
          <span class="meter" aria-hidden="true"></span><span class="as ok">0<small>pts</small></span></a></li>`);
        }
        return rows.join("");
      })()}</ol>
    </section>${viewsHtml()}${searchLines()
      .map(t => `\n    <p class="quiet">${esc(t)}</p>`)
      .join("")}${panelsHtml()}
    </div>
  </div>
  ${
    fallbackFirst.length
      ? `<section class="panel fixfirst" aria-labelledby="h-first">
    <div class="ph"><h2 id="h-first">Fix first</h2><a class="link" href="#findings">All findings ${ICON.arrow}</a></div>
    <ol>${fallbackFirst.map(f => `<li><a href="#${esc(f.id)}">${dot(f.severity)}<span class="sev-t">${SEV_LABEL[f.severity]}</span><span class="t">${inl(f.title)}${needsYou(f) ? ` <span class="own">Needs you</span>` : ""}</span><span class="c">${esc(f.category)}</span>${ICON.arrow}</a></li>`).join("")}</ol>
  </section>`
      : ""
  }
`;
}
