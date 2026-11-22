// @ts-check
// Site-wide AI agent checks over the crawled pages. site is the crawl's context (seo-crawl.mjs).
import { agentFiles, BING_PREFS } from "./agents.mjs";

// Unnamed controls (AI-05 counts as checked once a page has a control), plus WebMCP tools, agent files and writing
// notes for the report. UA is the crawler's user agent, for the agent file requests.
export async function agentData(site, UA) {
  const { htmlPages, add, evalRules, notes, extra, startOrigin: START_ORIGIN, indexable } = site;
  const tools = [],
    writingNotes = [];
  for (const p of htmlPages) {
    if (!p.agent || !indexable(p) || p.clientOnly) continue;
    const { unnamedFields: f, unnamedButtons: b, webmcpTools, controls } = p.agent;
    if (controls) evalRules("AI-05");
    if (f.length || b.length)
      add(
        "controls-no-name",
        p.finalUrl,
        `${[f.length && `${f.length} field(s)`, b.length && `${b.length} button(s)`].filter(Boolean).join(" and ")}, e.g. \`${f[0] || b[0]}\``,
      );
    if (webmcpTools.length) tools.push({ url: p.finalUrl, tools: webmcpTools });
    const w = p.writing,
      count = w.longSentences + w.longParagraphs + w.stockPhrases.length;
    if (count) writingNotes.push({ url: p.finalUrl, ...w, count });
  }
  writingNotes.sort((a, b) => b.count - a.count || (a.url < b.url ? -1 : 1));
  if (writingNotes.length > 50)
    notes.push(`Writing notes list the 50 pages with the most notes, of ${writingNotes.length}.`);
  const files = await agentFiles(
    u =>
      fetch(u, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/json,*/*;q=0.8" },
        signal: AbortSignal.timeout(15000),
      }),
    START_ORIGIN,
  );
  extra.agents = { pages: tools.slice(0, 50), ...files };
  extra.writingNotes = writingNotes.slice(0, 50).map(({ count, ...n }) => n);
}

// A page still on noarchive or nocache without the new directive needs a decision before 1 Mar 2027. Pages Bing can't
// index don't matter, noindex pages that --ignore-noindex treats as indexable included (page-nofollow skips them too).
export function bingAiPrefs(site) {
  const { htmlPages, add, evalRules, indexable } = site;
  evalRules("AI-03");
  for (const p of htmlPages) {
    if (!p.bingAi || !indexable(p)) continue;
    const { legacy, prefs } = p.bingAi,
      at = w => [...new Set(legacy.filter(l => l.where === w).map(l => l.rule))].join(" and ");
    if (legacy.length && !prefs.length)
      add(
        "ai-legacy-noarchive",
        p.finalUrl,
        [at("meta") && `${at("meta")} in a meta tag`, at("header") && `${at("header")} in the X-Robots-Tag header`]
          .filter(Boolean)
          .join("; "),
      );
    const bad = prefs.filter(x => !BING_PREFS[x.name].includes(x.value));
    if (bad.length) add("ai-preference-invalid", p.finalUrl, bad.map(x => `${x.name}:${x.value}`).join(", "));
  }
}

// Click-only elements and missing landmarks on indexable, server-rendered pages; the first 20 lacking a landmark are
// listed.
export function landmarks(site) {
  const { htmlPages, add, extra, indexable } = site;
  const bare = [];
  let checked = 0;
  for (const p of htmlPages) {
    if (!p.agent || !indexable(p) || p.clientOnly) continue;
    checked++;
    const { clickOnly, landmarksMissing } = p.agent;
    if (clickOnly.length)
      add("click-only-elements", p.finalUrl, `${clickOnly.length} element(s), e.g. \`${clickOnly[0]}\``);
    if (landmarksMissing.length) bare.push({ url: p.finalUrl, missing: landmarksMissing });
  }
  if (bare.length) extra.landmarks = { checked, count: bare.length, pages: bare.slice(0, 20) };
}
