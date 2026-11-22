// @ts-check
// The Overview tab, action first. Information panels belong on the topic tabs (render-report.mjs).
import { SEV, bandOf, OWN_SCORE } from "../lib/score.mjs";
import { passes } from "../checks/speed.mjs";
import { SEV_LABEL, ICON, dot, esc, inl, num, obj, plural } from "./format.mjs";
import { needsYou } from "./model.mjs";
import { byPath } from "./traffic.mjs";

// Fix first and Needs you, for the page and the Markdown. Needs you takes what /seo-fix won't change unasked: fixBy:
// "owner" findings, open decisions and findings with a decision. Fix first takes the rest, so nothing is in both. Both
// sort by severity, then by Search Console clicks on the finding's pages.
export const isOwnersCall = (f, decisions = []) =>
  needsYou(f) ||
  f.status === "needs-decision" ||
  f.severity === "needs-decision" ||
  decisions.some(d => d.id && d.id === f.id);
export function actions({ raw, open, decisions }) {
  const clicks = f =>
    Math.max(
      0,
      ...(Array.isArray(f.evidence) ? f.evidence : []).map(e => Number(byPath(raw.traffic, e?.url)?.clicks) || 0),
    );
  const order = list => list.sort((a, b) => SEV.indexOf(a.sev) - SEV.indexOf(b.sev) || b.clicks - a.clicks);
  const item = f => ({ id: f.id, title: f.title, sev: f.severity, f, clicks: clicks(f) });
  const mine = f => isOwnersCall(f, decisions);
  const code = order(open.filter(f => !mine(f) && f.status !== "wont-fix").map(item)),
    serious = code.filter(x => x.sev === "blocker" || x.sev === "high");
  const own = open.filter(mine),
    asked = decisions.filter(d => !own.some(f => f.id && f.id === d.id));
  const yours = order([
    ...own.map(item),
    ...asked.map(d => ({ id: d.id, title: d.question, sev: "needs-decision", d, clicks: 0 })),
  ]);
  return {
    fixFirst: (serious.length ? serious : code.slice(0, 3)).slice(0, 5),
    needsYou: yours.slice(0, 3),
    yours,
    tasks: own.filter(f => !decisions.some(d => d.id === f.id)),
  };
}
// The scope line ends in "see": the page adds the Limits tab's name after it, as a link.
export const scopeText = ({ run, overall, notChecked }) =>
  `Checked ${run.pagesCrawled != null ? `${plural(Number(run.pagesCrawled) || 0, "page")} against ` : ""}${plural(overall?.rules || 0, "rule")} · ${notChecked.length ? `${plural(notChecked.length, "check")} couldn't run` : "every planned check ran"}: see`;
// Clicks are the property's total, else the pages' sum; Core Web Vitals use origin data, else the first page's.
export function keyNumbers({ raw }) {
  const t = obj(raw.traffic),
    tot = Number(obj(raw.siteTotals)?.clicks),
    sum = t ? Object.values(t).reduce((s, x) => s + (Number(x?.clicks) || 0), 0) : 0;
  const clicks = tot > 0 ? tot : t && Object.keys(t).length ? sum : null;
  const s = (Array.isArray(raw.speed?.samples) ? raw.speed.samples : []).filter(obj),
    v = s.find(x => obj(x.origin))?.origin || s.find(x => obj(x.field))?.field;
  return {
    clicks,
    period: raw.trafficPeriod ? String(raw.trafficPeriod).toLowerCase() : "",
    cwv: v && Number.isFinite(v.lcp) ? (passes(v) ? "Pass" : "Fail") : null,
    strategy: raw.speed?.strategy || "mobile",
  };
}

// The health score is a local formula, and the text says so.
export const SCORE_HOW = `Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area. This is ${OWN_SCORE}: it counts only the rules this audit checked, and search engines don't use it.`;

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

/** m is the model from model.mjs, with raw. */
export function overviewHtml(m) {
  const { run, overall, deltaOf, countSev, open, fixed, findings, verdict, impact, areas } = m;
  if (!overall)
    return `<section class="panel empty-state"><h2>Nothing to score</h2><p>This file has no findings or passed rules. Run the audit to fill it.</p></section>`;
  const [, bandName, bandCls] = bandOf(overall.value);
  const capLine = overall.cap
    ? `${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed.`
    : `${overall.passing} of ${overall.rules} checked rules pass in full.`;
  const delta = deltaOf();
  const sevBar = SEV.map(s => [s, countSev(s)]).filter(([, n]) => n);
  const totalOpen = open.length;
  const { fixFirst, needsYou: yours, yours: allYours } = actions(m),
    keys = keyNumbers(m);
  // A row links to the finding's card, or to the Decisions tab for a decision no finding carries: its id (D-1) is no
  // anchor on the page.
  const row = x =>
    `<a href="#${esc(x.id || "decisions")}">${dot(x.sev)}<span class="sev-t">${SEV_LABEL[x.sev]}</span><span class="t">${inl(x.title)}</span><span class="c">${esc(x.f?.category || "")}</span>${ICON.arrow}</a>`;
  const stat = (h, n, rest = "") =>
    `\n      <div class="stat">\n        <h3>${h}</h3>\n        <p class="stat-n"><span class="n">${n}</span>${rest}</p>`;
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
        <p>${SCORE_HOW}</p>
      </details>
    </section>
    ${
      fixFirst.length
        ? `<section class="panel fixfirst" aria-labelledby="h-first">
      <div class="ph"><h2 id="h-first">Fix first</h2><a class="link" href="#findings">All findings ${ICON.arrow}</a></div>
      <p class="sub">What the agent can fix in code. Each line fixes one.</p>
      <ol>${fixFirst.map(x => `<li>${row(x)}${x.id ? `<p class="next"><code>/seo-fix ${esc(x.id)}</code></p>` : ""}</li>`).join("")}</ol>
    </section>`
        : ""
    }
    ${
      yours.length
        ? `<section class="panel fixfirst needsyou" aria-labelledby="h-you">
      <div class="ph"><h2 id="h-you">Needs you</h2><a class="link" href="#decisions">All ${allYours.length} in Decisions ${ICON.arrow}</a></div>
      <p class="sub">Your call, your accounts or your go-ahead: the agent won't change these without you.</p>
      <ol>${yours.map(x => `<li>${row(x)}</li>`).join("")}</ol>
    </section>`
        : ""
    }
    </div>
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
    </section>
    <p class="scope">${esc(scopeText(m))} <a href="#limits">Limits</a></p>
    <section class="panel stats" aria-labelledby="h-keys">
      <h2 id="h-keys" class="sr">Key numbers</h2>${
        run.pagesCrawled != null
          ? `${stat("Pages checked", num(Number(run.pagesCrawled) || 0))}
      </div>`
          : ""
      }${stat("Open issues", totalOpen, totalOpen ? "" : " · nothing open")}
        ${
          totalOpen
            ? `<div class="stack" role="img" aria-label="${sevBar.map(([sv, n]) => `${n} ${SEV_LABEL[sv]}`).join(", ")}">${sevBar.map(([sv, n]) => `<span class="s-${sv}" style="flex:${n}"></span>`).join("")}</div>
        <ul class="legend">${sevBar.map(([sv, n]) => `<li>${dot(sv)}<span>${SEV_LABEL[sv]}</span><b>${n}</b></li>`).join("")}</ul>`
            : ""
        }
      </div>${stat("Fixed this run", fixed.length, ` of ${findings.length}`)}
        <div class="stack" role="img" aria-label="${fixed.length} fixed, ${open.length} still open"><span class="s-fixed" style="flex:${fixed.length || 0.0001}"></span><span class="s-rest" style="flex:${open.length || 0.0001}"></span></div>
        <p class="quiet">${fixed.length ? `${num(open.length)} still open` : "Run /seo-fix to start"}</p>
      </div>${
        keys.clicks != null
          ? `${stat("Clicks from Google", num(keys.clicks))}
        <p class="quiet">Search Console${keys.period ? `, ${esc(keys.period)}` : ""}</p>
      </div>`
          : ""
      }${
        keys.cwv
          ? `${stat("Core Web Vitals", keys.cwv)}
        <p class="quiet">Real visitors, ${esc(keys.strategy)}</p>
      </div>`
          : ""
      }
    </section>
    </div>
  </div>
`;
}
