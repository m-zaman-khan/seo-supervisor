// @ts-check
// The report's model: the audit read once, with check settings applied and the score worked out.
import { basename } from "node:path";
import { EARN, isOpen, buildRules as rulesOf, score, scoreSummary } from "../lib/score.mjs";
import { plural, obj, isText } from "./format.mjs";

export const needsYou = f => f.fixBy === "owner" && isOpen(f);

/**
 * @param {any} raw the audit JSON (or raw seo-crawl / content-scan output)
 * @param {string} dir the audit file's folder: its settings.json applies
 */
export function buildModel(raw, dir) {
  const isCrawl = raw.tool === "seo-supervisor-crawler";
  const isScan = raw.tool === "seo-supervisor-content-scan";
  const host = () => {
    try {
      return new URL(raw.siteOrigin).host;
    } catch {
      return String(raw.siteOrigin || "Website");
    }
  };
  const site = raw.site || {
    name: isCrawl ? host() : isScan ? `Content: ${basename(String(raw.source))}` : "Website",
    url: raw.siteOrigin || "",
  };
  const run = { ...(raw.run || {}) };
  if (isCrawl)
    Object.assign(run, {
      mode: "crawl",
      date: raw.crawledAt,
      pagesCrawled: raw.stats?.htmlPages,
      auditor: "seo-crawl.mjs " + raw.version,
    });
  if (isScan) Object.assign(run, { mode: "content scan", date: raw.scannedAt, auditor: "content-scan.mjs" });
  // scoreSummary applies settings.json before scoring, the same way the dashboard does.
  const { findings, checkSettings, passed, open, rules, overall, unlock, countSev } = scoreSummary(raw, dir);
  const notChecked = raw.notChecked || [];
  const notes = raw.notes || [];
  // Lighthouse runs, validated once for every panel; each failed audit keeps up to 10 of the items it names.
  const lighthouse = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(x => obj(x) && isText(x.url))
    .map(x => ({
      ...x,
      detail: (Array.isArray(x.detail) ? x.detail : [])
        .filter(a => obj(a) && typeof a.title === "string")
        .map(a => ({
          ...a,
          items: (Array.isArray(a.items) ? a.items : []).filter(s => typeof s === "string" && s).slice(0, 10),
        })),
    }));
  // The audit's own decisions first, then open ones on findings, deduped by id so the Decisions tab never counts one
  // twice.
  const decisions = [
    ...(raw.decisions || []).map(d => ({ ...d })),
    ...findings
      .filter(f => f.status === "needs-decision" && isOpen(f))
      .map(f => ({
        id: f.id,
        question: f.decision?.question || f.title,
        context: f.what || f.why,
        options: f.decision?.options,
        recommendation: f.decision?.recommendation || f.fix,
      })),
  ].filter((d, i, all) => !d.id || all.findIndex(x => x.id === d.id) === i);
  const fixed = findings.filter(f => !isOpen(f));

  // The score model is documented in report-format.md.
  const buildRules = opts => rulesOf(findings, passed, opts);
  const areaNames = [...new Set(rules.map(r => r.area))];
  const areas = areaNames
    .map(name => {
      const s = score(rules.filter(r => r.area === name));
      const top = open.filter(f => f.category === name);
      const fixedHere = fixed.filter(f => f.category === name).length;
      return { name, ...s, worst: top[0]?.severity || null, top, fixedHere };
    })
    .sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));

  const before = fixed.length ? score(buildRules({ fixedCountsAsOpen: true })) : null;
  // While blockers cap the score, the report shows what fixing them unlocks.
  const isBlocker = f => f.severity === "blocker";
  const openBlockers = findings.filter(f => isBlocker(f) && isOpen(f));
  const beforeUnlock = unlock && before ? score(buildRules({ fixedCountsAsOpen: true, assume: isBlocker })) : null;
  // What this run's fixes changed. While the blocker cap holds the total, the gain shows in the unlocked score instead.
  function deltaOf() {
    if (!before || !overall) return null;
    const fx = plural(fixed.length, "fix", "fixes");
    if (before.value !== overall.value) {
      const up = overall.value > before.value;
      return {
        dir: up ? "up" : "down",
        html: `${up ? "Up" : "Down"} <b>${Math.abs(overall.value - before.value)}</b> from ${before.value} before this run's ${fx}`,
      };
    }
    if (unlock && beforeUnlock && beforeUnlock.value !== unlock.value) {
      const up = unlock.value > beforeUnlock.value;
      const n = Math.abs(unlock.value - beforeUnlock.value);
      return {
        dir: up ? "up" : "down",
        inUnlock: true,
        html: up
          ? `The ${fx} from this run earned <b>${n}</b> ${n === 1 ? "point" : "points"}. You'll see ${n === 1 ? "it" : "them"} once the ${openBlockers.length === 1 ? "blocker is" : "blockers are"} fixed`
          : `This run's changes cost <b>${n}</b> ${n === 1 ? "point" : "points"}`,
      };
    }
    return null;
  }
  const impact = (() => {
    if (!overall) return { rows: [], cap: 0 };
    const possible = overall.rules * 10;
    const lost = areas.map(
      a =>
        /** @type {{ a: typeof a, exact: number, pts?: number }} */ ({
          a,
          exact:
            (100 * rules.filter(r => r.area === a.name).reduce((s, r) => s + (r.worst ? 10 - EARN[r.worst] : 0), 0)) /
            possible,
        }),
    );
    const target = 100 - overall.raw;
    lost.forEach(x => {
      x.pts = Math.floor(x.exact);
    });
    let rest = target - lost.reduce((s, x) => s + x.pts, 0);
    [...lost]
      .sort((x, y) => y.exact - y.pts - (x.exact - x.pts))
      .forEach(x => {
        if (rest > 0 && x.exact > x.pts) {
          x.pts++;
          rest--;
        }
      });
    return {
      rows: lost.filter(x => x.exact > 0).sort((x, y) => y.exact - x.exact || x.a.value - y.a.value),
      cap: overall.raw - overall.value,
    };
  })();

  let verdict;
  if (!overall) verdict = "Not scored: no checked rules in this file.";
  else if (countSev("blocker"))
    verdict = `Not ready: ${countSev("blocker")} blocker${countSev("blocker") > 1 ? "s" : ""} to fix first`;
  else if (countSev("high"))
    verdict = `Needs work: ${countSev("high")} high-severity issue${countSev("high") > 1 ? "s" : ""}`;
  else if (open.length) verdict = "In good shape: only minor issues left";
  else verdict = "Every checked rule passes";
  return {
    site,
    run,
    findings,
    checkSettings,
    passed,
    notChecked,
    notes,
    lighthouse,
    decisions,
    open,
    fixed,
    countSev,
    buildRules,
    overall,
    areas,
    openBlockers,
    unlock,
    deltaOf,
    impact,
    verdict,
  };
}
