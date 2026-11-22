// @ts-check
// The Since last audit tab and the parts the Markdown reuses, plus the Search Central posts and the audit timeline.
import { esc, fmtDate, noteCode, noteMd, num, obj, isCount } from "./format.mjs";

export function diffParts({ raw, findings }, { googleUpdatesText }) {
  // links-import.mjs computes links-dropped, as only it has both audits' links.json summaries.
  const LINKS_DROP = {
    sites: "Sites linking to you (Search Console)",
    bingPages: "Your pages with links from other sites (Bing)",
  };
  const linksDrop = (c =>
    c &&
    c.kind === "links-dropped" &&
    Object.hasOwn(LINKS_DROP, c.what) &&
    [c.before, c.after].every(n => Number.isInteger(n) && n >= 0) &&
    c.after < c.before
      ? c
      : null)(obj(raw.linksChange));
  const linksDropText = () =>
    `${num(linksDrop.before)} → ${num(linksDrop.after)} (−${Math.round((100 * (linksDrop.before - linksDrop.after)) / linksDrop.before)}%) since the last audit. Information only: it doesn't change the score. To find which links went, run the backlink check (backlinks.mjs) on Search Console's Latest links export or Bing's sample: it lists the links that are gone.`;
  const linksDroppedHtml = () =>
    linksDrop
      ? `\n  <section class="panel"><h2>Links dropped</h2><ul class="lim"><li><b>${LINKS_DROP[linksDrop.what]}</b><span>${esc(linksDropText())}</span></li></ul></section>`
      : "";
  const linksDroppedMd = () =>
    linksDrop ? ["### Links dropped", "", `- ${LINKS_DROP[linksDrop.what]}: ${linksDropText()}`, ""] : [];
  // Search Central posts from google-updates.mjs --blog, listed by date and never offered as a cause.
  function googlePostsText(html = false) {
    const g = obj(raw.googleUpdates);
    if (!Array.isArray(g?.posts)) return "";
    const list = g.posts.filter(
      p => obj(p) && typeof p.title === "string" && p.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(p.date),
    );
    const day = d => fmtDate(d, false);
    const name = p =>
      !html
        ? noteMd(p.title)
        : /^https?:\/\//i.test(p.url)
          ? `<a href="${esc(p.url)}" rel="noopener">${esc(p.title)}</a>`
          : esc(p.title);
    return list.length
      ? `Google Search Central announcements in this period: ${list.map(p => `${name(p)} (${day(p.date)})`).join(" · ")}`
      : "Google Search Central posted no announcements in this period.";
  }
  // One row per crawl from seo-diff.mjs --history, shown from three crawls on, as two are just Since last audit.
  const timelineRows = () =>
    (Array.isArray(obj(raw.diff)?.timeline) ? raw.diff.timeline : [])
      .filter(x => obj(x) && !isNaN(Date.parse(x.date)) && isCount(x.pages))
      .slice(-100)
      .reverse();
  const timelineCells = x => [
    fmtDate(x.date),
    ...["pages", "findings", "regressions", "improvements", "added", "removed"].map(k =>
      isCount(x[k]) ? num(x[k]) : "–",
    ),
  ];
  const TIMELINE_HEAD = [
    "Crawl",
    "Pages",
    "Crawler findings",
    "Regressions",
    "Improvements",
    "Pages added",
    "Pages gone",
  ];
  const TIMELINE_INTRO =
    "Every crawl filed in seo-audit/history, newest first, each compared with the one before it. Crawler findings are the crawler's own count, before the audit's review. – means it couldn't be told: that crawl or the one before covered part of the site. Information only.";
  const timelineHtml = () => {
    const rows = timelineRows(),
      posts = googlePostsText(true);
    return (
      (posts ? `\n    <p class="quiet">${posts}</p>` : "") +
      (rows.length >= 3
        ? `\n    <details class="how timeline"><summary>Audit timeline</summary><p>${esc(TIMELINE_INTRO)}</p><div class="tablewrap"><table><thead><tr>${TIMELINE_HEAD.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows
            .map(
              x =>
                `<tr>${timelineCells(x)
                  .map(c => `<td>${esc(c)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}</tbody></table></div></details>`
        : "")
    );
  };
  const timelineMd = () => {
    const rows = timelineRows(),
      posts = googlePostsText();
    return [
      ...(posts ? ["## Google Search Central", "", posts, ""] : []),
      ...(rows.length >= 3
        ? [
            "## Audit timeline",
            "",
            TIMELINE_INTRO,
            "",
            `| ${TIMELINE_HEAD.join(" | ")} |`,
            `| --- |${" ---: |".repeat(6)}`,
            ...rows.map(x => `| ${timelineCells(x).join(" | ")} |`),
            "",
          ]
        : []),
    ];
  };

  const diff = raw.diff && typeof raw.diff === "object" ? raw.diff : null;
  const DIFF_KIND = {
    "canonical-changed": ["Canonical changed", "URL-04"],
    "noindex-added": ["Now noindex", "CRAWL-02"],
    "noindex-removed": ["No longer noindex", "CRAWL-02"],
    "title-changed": ["Title changed", "META-01"],
    "h1-removed": ["H1 removed", "CONTENT-01"],
    "h1-added": ["H1 added", "CONTENT-01"],
    "schema-removed": ["Schema removed", "SCHEMA-03"],
    "schema-added": ["Schema added", "SCHEMA-03"],
    "status-error": ["Now an error", "CRAWL-05"],
    "status-fixed": ["Error fixed", "CRAWL-05"],
    "description-changed": ["Description changed", "META-02"],
    "og-removed": ["Open Graph tags removed", "META-04"],
    "og-added": ["Open Graph tags added", "META-04"],
    "content-shrunk": ["Word count fell", "CONTENT-05"],
    "content-grew": ["Word count grew", "CONTENT-05"],
    "speed-slower": ["Now slower", "PERF-01"],
    "speed-faster": ["Now faster", "PERF-01"],
    "schema-fields-removed": ["Schema fields removed", "SCHEMA-03"],
    "schema-fields-added": ["Schema fields added", "SCHEMA-03"],
    "robots-changed": ["robots.txt changed", "MAP-05"],
    "left-sitemap": ["Left the sitemap", "MAP-03"],
    "joined-sitemap": ["Joined the sitemap", "MAP-03"],
    "lost-internal-links": ["Fewer internal links", "LINK-02"],
    "redirect-changed": ["Redirect changed", "URL-07"],
    "redirect-added": ["Now redirects", "URL-07"],
    "redirect-removed": ["Redirect removed", "URL-07"],
    "h1-changed": ["H1 changed", "CONTENT-01"],
    "h2-changed": ["H2s changed", "CONTENT-02"],
    "hreflang-changed": ["hreflang changed", "META-08"],
    "schema-retired-removed": ["Retired schema removed", "SCHEMA-05"],
    "section-shrunk": ["Section shrank", null],
  };
  const diffSections = d =>
    [
      ["Regressions", d.regressions],
      ["Improvements", d.improvements],
      ["Other changes", d.changed],
    ].filter(([, list]) => (list || []).length);
  const diffText = c =>
    `${DIFF_KIND[c.kind]?.[0] || c.kind}${c.source ? ` (${c.source})` : ""}: ${c.detail ?? `${c.before ?? "none"} → ${c.after ?? "none"}`}`;
  // The finding on the same page and rule, if any.
  const diffFinding = c =>
    findings.find(
      f =>
        f.rule === DIFF_KIND[c.kind]?.[1] &&
        (f.evidence || []).some(e => {
          try {
            return new URL(e.url).pathname === c.path;
          } catch {
            return false;
          }
        }),
    );
  // "Nothing changed" claims a field only when both crawls recorded it.
  const sameFields = d => {
    const c = new Set(d.compared || []);
    const f = [
      "status",
      "indexing",
      "canonical",
      "title",
      c.has("description") && "description",
      c.has("og") && "share tags",
      "H1",
      c.has("h2") && "H2s",
      c.has("hreflang") && "hreflang",
      "schema",
      c.has("schemaProps") && "schema fields",
      c.has("words") && "length",
      c.has("sitemap") && "sitemap listing",
      c.has("links") && "internal links",
    ].filter(Boolean);
    const also = [
      c.has("redirects") && "no redirect changed",
      c.has("robots") && "robots.txt has the same rules",
      c.has("sections") && "no section lost half its pages",
      c.has("speed") && "no page got much faster or slower",
    ].filter(Boolean);
    return `${f.slice(0, -1).join(", ")} and ${f.at(-1)} as last time${also.length ? `, ${[...also.slice(0, -1), `and ${also.at(-1)}`].join(", ")}` : ""}`;
  };
  // Why no page is listed as gone or added: true means --max stopped the crawl, "section" means --include/--exclude.
  const unknownText = (why, which) =>
    why === "section"
      ? `${which === "gone" ? "This crawl" : "The last crawl"} covered one part of the site (--include or --exclude), so pages outside it aren't listed as ${which}.`
      : why === true
        ? `${which === "gone" ? "This crawl" : "The last crawl"} stopped at its page limit (--max), so pages it didn't reach aren't listed as ${which}.`
        : "";
  const unknownLines = d =>
    [unknownText(d.removedUnknown, "gone"), unknownText(d.addedUnknown, "added")].filter(Boolean);
  // seo-diff.mjs's addedBurst, a local threshold (50 pages and 20%). It shows the count and where the pages are, never
  // what they're about, and paths and titles come from the crawl, so they're escaped.
  const HACKED_HELP = "https://support.google.com/webmasters/answer/9044101#hacked-url-injection";
  const BURST_NOTE =
    "Our own line: this shows when at least 50 pages are new and they add at least 20% to the pages the last audit found. Information only: it doesn't change the score.";
  const burst = (b =>
    b && isCount(b.pages) && isCount(b.before) && b.before > 0
      ? {
          pages: b.pages,
          before: b.before,
          sections: (Array.isArray(b.sections) ? b.sections : []).filter(
            s => typeof s?.path === "string" && isCount(s.pages),
          ),
          examples: (Array.isArray(b.examples) ? b.examples : []).filter(e => typeof e?.path === "string").slice(0, 10),
        }
      : null)(obj(diff?.addedBurst));
  const burstText = () =>
    `${num(burst.pages)} new pages appeared since the last audit${diff.since ? ` (on ${fmtDate(diff.since)})` : ""}, ${Math.round((100 * burst.pages) / burst.before)}% more than the ${num(burst.before)} pages it found. If you didn't add them, check for hacked or spam pages`;
  // "/blog/ 12 · /cheap-pills/ 180"; folders past seo-diff's top 20 are summed into one count.
  const burstFolders = code => {
    const other = burst.pages - burst.sections.reduce((n, s) => n + s.pages, 0);
    return `New pages by folder: ${burst.sections.map(s => `${code(s.path)}${s.path === "/" ? " (top level)" : ""} ${num(s.pages)}`).join(" · ")}${other > 0 ? ` · other folders ${num(other)}` : ""}`;
  };
  const burstHtml = () =>
    burst
      ? `<section class="panel"><h2>Many new pages<span class="mono quiet"> ${num(burst.pages)}</span></h2><p>${esc(burstText())}: see <a href="${HACKED_HELP}" rel="noopener">Google's help on hacked content</a>.</p>${burst.sections.length ? `<p class="quiet">${burstFolders(esc)}</p>` : ""}${burst.examples.length ? `<p class="quiet">Some of them, from different folders:</p><ul class="lim">${burst.examples.map(e => `<li><b><code>${esc(e.path)}</code></b><span>${esc(e.title || "no title")}</span></li>`).join("")}</ul>` : ""}<p class="quiet">${BURST_NOTE}</p></section>
  `
      : "";
  const burstMd = () =>
    burst
      ? [
          "### Many new pages",
          "",
          `${noteMd(burstText())}: see Google's help on hacked content, ${HACKED_HELP}`,
          "",
          ...(burst.sections.length ? [burstFolders(noteCode), ""] : []),
          ...(burst.examples.length
            ? [
                "Some of them, from different folders:",
                "",
                ...burst.examples.map(e => `- ${noteCode(e.path)} ${e.title ? noteMd(e.title) : "no title"}`),
                "",
              ]
            : []),
          BURST_NOTE,
          "",
        ]
      : [];
  const diffHtml = () => `<div class="limits">
  ${burstHtml()}<p class="quiet">Compared with the crawl of ${esc(fmtDate(diff.since))}. Pages are matched by path.${unknownLines(
    diff,
  )
    .map(t => ` ${t}`)
    .join(
      "",
    )}</p>${googleUpdatesText() ? `\n  <p class="quiet">${googleUpdatesText(true)}</p>` : ""}${googlePostsText() ? `\n  <p class="quiet">${googlePostsText(true)}</p>` : ""}${linksDroppedHtml()}
  ${diffSections(diff)
    .map(
      ([h, list]) =>
        `<section class="panel"><h2>${h}<span class="mono quiet"> ${list.length}</span></h2><ul class="lim">${list
          .map(c => {
            const f = diffFinding(c);
            return `<li><b><code>${esc(c.path)}</code></b><span>${esc(diffText(c))}${f ? ` · <a href="#${esc(f.id)}">${esc(f.id)}</a>` : ""}</span></li>`;
          })
          .join("")}</ul></section>`,
    )
    .join("")}
  ${[
    ["Pages added", diff.added],
    ["Pages gone", diff.removed],
  ]
    .filter(([, l]) => (l || []).length)
    .map(
      ([h, l]) =>
        `<section class="panel"><h2>${h}<span class="mono quiet"> ${l.length}</span></h2><ul class="lim">${l.map(p => `<li><span><code>${esc(p)}</code></span></li>`).join("")}</ul></section>`,
    )
    .join("")}
  ${!diffSections(diff).length && !(diff.added || []).length && !(diff.removed || []).length ? `<section class="panel empty-state"><h2>Nothing changed</h2><p>Every page has the same ${sameFields(diff)}.</p></section>` : ""}
</div>`;
  return {
    diff,
    diffHtml,
    timelineHtml,
    timelineMd,
    googlePostsText,
    burstMd,
    diffSections,
    diffText,
    unknownLines,
    linksDroppedMd,
  };
}
