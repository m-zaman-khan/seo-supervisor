// @ts-check
// The panels about the site itself: score views, HSTS preload, coverage, rendering, page scores and check settings.
import { score, OWN_SCORE } from "../../lib/score.mjs";
import { cellMd, dot, esc, inl, mdSafe, noteMd, notePath, num, obj, plural, isCount } from "../format.mjs";

export function sitePanels({ raw, mdFile, site, areas, overall, open, buildRules, checkSettings }) {
  // The trust view is found ÷ applicable signals × 100 (checks/trust.mjs); missing signals are suggestions, not
  // findings. Local SEO and Content quality are the "Local business" and "Headings & content" area scores renamed, each
  // shown only when its area has checked rules.
  const trustScore = signals => {
    const on = signals.filter(s => s.applies),
      found = on.filter(s => s.found).length;
    return {
      value: on.length ? Math.round((100 * found) / on.length) : null,
      found,
      applicable: on.length,
      missing: on.filter(s => !s.found),
    };
  };
  const trustList = Array.isArray(raw.trustSignals) ? raw.trustSignals.filter(obj) : null;
  const NOT_GOOGLE = "SEO Supervisor's own check, not a Google score";
  const labelOf = s => String(s.label || s.id || "");
  function viewsOf() {
    if (!trustList) return null;
    const t = trustScore(trustList),
      list = [
        ["Local SEO", "Local business"],
        ["Content quality", "Headings & content"],
      ]
        .map(([label, name]) => ({ label, a: areas.find(a => a.name === name) }))
        .filter(v => v.a);
    const lc = s => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
    const line = `${t.found} of ${t.applicable} signals found${t.missing.length ? ` · missing: ${t.missing.map(s => lc(labelOf(s))).join(", ")}` : ""}`;
    return t.value == null && !list.length ? null : { t, list, line };
  }
  const viewsHtml = () => {
    const v = viewsOf();
    if (!v) return "";
    const pass = `<i class="dot d-pass" aria-hidden="true"></i>`;
    const row = (tag, attrs, d, name, lines, value) => `<li><${tag} class="area"${attrs}>${d}
          <span class="an"><b>${name}</b>${lines}</span>
          <span class="meter" aria-hidden="true"><i style="width:${Math.max(4, value)}%"></i></span><span class="as">${value}<small>/100</small></span></${tag}></li>`;
    const rows = [
      ...(v.t.value == null
        ? []
        : [
            row(
              "div",
              "",
              v.t.missing.length ? dot("low") : pass,
              "Trust signals (E-E-A-T)",
              `<span class="reason">${esc(v.line)}</span><span class="reason">${esc(NOT_GOOGLE)}</span>`,
              v.t.value,
            ),
          ]),
      ...v.list.map(({ label, a }) =>
        row(
          "a",
          ` href="#findings" data-area="${esc(a.name)}"`,
          a.worst ? dot(a.worst) : pass,
          esc(label),
          `<span>${esc(a.name)} area · ${a.top.length ? inl(a.top[0].title) : "All checks pass"}</span>`,
          a.value,
        ),
      ),
    ];
    const add = v.t.missing.length
      ? `
      <details class="how"><summary>What to add for trust</summary><p>Suggestions, not findings: they never change the SEO health score, and not every signal fits every site.</p><ul class="lim">${v.t.missing.map(s => `<li><b>${esc(labelOf(s))}</b><span>${inl(s.add || "")}${s.rule ? ` See ${esc(s.rule)}.` : ""}</span></li>`).join("")}</ul></details>`
      : "";
    return `
    <section class="panel factors" aria-labelledby="h-views">
      <div class="ph"><h2 id="h-views">Score views</h2><span class="sub">The audit read another way</span></div>
      <ol class="area-list">${rows.join("")}</ol>${add}
    </section>`;
  };
  const viewsMd = () => {
    const v = viewsOf();
    if (!v) return [];
    const cell = s => cellMd(noteMd(s)); // crawled text: names, links, dates
    const found = trustList.filter(s => s.applies && s.found);
    return [
      "## Score views",
      "",
      "| View | Score | What it is |",
      "| --- | ---: | --- |",
      ...(v.t.value == null ? [] : [`| Trust signals (E-E-A-T) | ${v.t.value}/100 | ${cell(v.line)}. ${NOT_GOOGLE} |`]),
      ...v.list.map(({ label, a }) => `| ${label} | ${a.value}/100 | The ${cell(a.name)} area's score |`),
      "",
      ...(v.t.missing.length
        ? [
            "Trust signals to add. They're suggestions, not findings: they never change the score, and not every signal fits every site.",
            "",
            ...v.t.missing.map(
              s => `- **${noteMd(labelOf(s))}:** ${mdSafe(s.add || "")}${s.rule ? ` See ${noteMd(s.rule)}.` : ""}`,
            ),
            "",
          ]
        : []),
      ...(found.length
        ? [
            "Trust signals found:",
            "",
            ...found.map(s => `- **${noteMd(labelOf(s))}:** ${noteMd(s.evidence || "found")}`),
            "",
          ]
        : []),
    ];
  };

  // The home page's HSTS header against the preload list's rules.
  const hstsPreloadText = () => {
    const p = obj(raw.hstsPreload),
      missing = Array.isArray(p?.missing) ? p.missing.filter(s => typeof s === "string") : [];
    if (!p || typeof p.ready !== "boolean") return "";
    const also =
      "hstspreload.org also needs the header on the bare domain, http:// sent to https:// on the same host first, and every subdomain on HTTPS. Joining the list is optional and slow to undo. Information only: it doesn't change the score.";
    return p.ready
      ? `HSTS preload: the header meets the list's rules. ${also}`
      : `HSTS preload: not ready yet. The header still needs ${missing.join(" and ")}. ${also}`;
  };
  const hstsPreload = () => hstsPreloadText() && { title: "HSTS preload", blocks: [{ quiet: hstsPreloadText() }] };

  // Sections show only with two or more; siteSize is set when the crawl stopped at --max. Paths are escaped.
  const siteSections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter(s => obj(s) && typeof s.path === "string" && isCount(s.pages) && Number.isFinite(s.share))
    .slice(0, 20);
  const coverageLines = () => {
    const z = obj(raw.siteSize),
      i = obj(raw.indexing);
    return [
      z &&
        [z.crawled, z.known, z.sitemapUrls].every(isCount) &&
        `The crawl stopped at ${num(z.crawled)} pages (--max). It knew of ${num(z.known)} URLs on the site from links and sitemaps (the sitemaps list ${num(z.sitemapUrls)}), so the site has at least ${num(Math.max(z.known, z.sitemapUrls))} URLs.`,
      i &&
        [i.indexed, i.notIndexed, i.crawlIndexable].every(isCount) &&
        /^\d{4}-\d{2}-\d{2}$/.test(i.date) &&
        `Search Console counted ${num(i.indexed)} indexed pages (and ${num(i.notIndexed)} not indexed) on ${i.date}; this crawl found ${num(i.crawlIndexable)} pages meant to be indexed${i.capped ? " before it stopped at --max" : ""}. Information only: it doesn't change the score.`,
    ].filter(Boolean);
  };
  const SECTIONS_INTRO =
    "How the crawled pages split across the site's top-level folders. Pages with nothing below them count as top-level pages (/). Information only.";
  const pctOf = s => `${Math.round(s * 100)}%`;
  const crawlCoverage = () => {
    const lines = coverageLines(),
      sections = siteSections.length > 1 && {
        cls: "sections",
        title: "Site sections",
        blocks: [
          { p: SECTIONS_INTRO },
          {
            head: ["Section", "Pages", "Share"],
            align: ["---", "---:", "---:"],
            rows: siteSections.map(s => [{ code: s.path }, num(s.pages), pctOf(s.share)]),
          },
        ],
      };
    return (
      (lines.length || sections) && {
        title: "Crawl coverage",
        blocks: [...lines.map(quiet => ({ quiet })), sections && { panel: sections }],
      }
    );
  };

  // Findings from these browser loads are listed with the others. Errors, text and addresses come from the site, so
  // each is escaped (code spans in the Markdown).
  const renderPages = (Array.isArray(raw.renderSample) ? raw.renderSample : [])
    .filter(p => obj(p) && typeof p.url === "string")
    .slice(0, 10);
  const chosenPage = (c => (c && typeof c.url === "string" ? c : null))(obj(raw.renderedPage));
  const textsOf = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s) : []);
  const firstScreenLine = () => {
    const seen = renderPages.filter(p => !p.gate && obj(p.h1) && obj(p.cta)),
      n = seen.length;
    if (!n) return "";
    const h1 = d => seen.filter(p => p.h1[d] === true).length,
      cta = d => seen.filter(p => typeof p.cta[d] === "string" && p.cta[d]).length;
    return `On a phone, the H1 is on the first screen on ${h1("phone")} of ${plural(n, "page")} and a button on ${cta("phone")} of ${n}; on desktop, ${h1("desktop")} of ${n} and ${cta("desktop")} of ${n}. The first screen and the button are our own measures, not Google rules.`;
  };
  const DEEP_LINK = {
    "scrolled-away": "the page scrolled away from it",
    "hash-removed": "the page removed it from the address",
    both: "the page scrolled away from it and removed it from the address",
  };
  const pageNotes = p => {
    if (typeof p.gate === "string") return [`showed ${p.gate}, so it wasn't compared or measured`];
    const errors = textsOf(p.errors),
      h = obj(p.hidden),
      j = obj(p.jumpLinks),
      broken = textsOf(j?.broken).map(id => `#${id}`);
    return [
      errors.length && `${plural(errors.length, "browser error")}, first: ${errors[0]}`,
      ...["phone", "desktop"].map(
        d =>
          obj(p.h1) &&
          p.h1[d] === false &&
          `the H1 isn't on the first screen on ${d === "phone" ? "a phone" : "desktop"}`,
      ),
      h &&
        isCount(h.words) &&
        h.words >= 50 &&
        /* our own line */ `${num(h.words)} hidden words (${Object.entries(obj(h.by) || {})
          .filter(([, v]) => isCount(v))
          .map(([k, v]) => `${k} ${num(v)}`)
          .join(", ")})${typeof h.examples?.[0]?.text === "string" ? `, most in “${h.examples[0].text}”` : ""}`,
      broken.length &&
        (broken.length === 1
          ? `a link to ${broken[0]}, which isn't on the page`
          : `links to ${broken.join(", ")}, which aren't on the page`),
      DEEP_LINK[j?.deepLink] && typeof j.target === "string" && `opened at #${j.target}, ${DEEP_LINK[j.deepLink]}`,
      p.menu === "no-button" && "no menu button found on a phone",
      p.menu === "covered" && "the phone menu button is covered by another layer",
    ].filter(Boolean);
  };
  const renderRows = () => renderPages.map(p => [p.url, pageNotes(p)]).filter(([, b]) => b.length);
  const chosenText = () => {
    const c = chosenPage,
      w = obj(c.words) || {},
      steps = typeof c.steps === "string" && c.steps ? ` and the steps (${c.steps})` : "",
      errors = textsOf(c.errors);
    const changes = (Array.isArray(c.changes) ? c.changes : [])
      .filter(x => obj(x) && typeof x.field === "string")
      .map(x => `${x.field}: ${x.raw ?? "none"} → ${x.rendered ?? "none"}`);
    return `: ${isCount(w.html) ? `${num(w.html)} words in the HTML, ${isCount(w.rendered) ? num(w.rendered) : "?"}` : `${isCount(w.rendered) ? num(w.rendered) : "?"} words`} after JavaScript${steps}. ${changes.length ? `What changed: ${changes.join("; ")}.` : "The title, canonical, robots tag, H1, schema and links match the HTML."}${typeof c.gate === "string" ? ` It showed ${c.gate}.` : ""}${errors.length ? ` ${plural(errors.length, "browser error")}, first: ${errors[0]}.` : ""}`;
  };
  const BROWSER_INTRO =
    "The sample pages loaded again in Chrome at desktop and phone size. Information only; what is a finding is listed with the other findings.";
  const browser = () => {
    const s = firstScreenLine(),
      rows = renderRows();
    return (
      (s || rows.length || chosenPage) && {
        cls: "render",
        title: "What the browser saw",
        blocks: [
          { p: BROWSER_INTRO },
          s && { p: s },
          { rows: rows.map(([u, b]) => [{ code: notePath(u) }, b.join(" · ")]) },
          chosenPage && { p: ["You chose ", { code: notePath(chosenPage.url) }, chosenText()] },
        ],
      }
    );
  };

  // Each page with open findings is scored by the site's model, counting only findings whose examples name it
  // (buildRules' assume). Evidence URLs on other hosts, and files such as sitemaps and robots.txt, are left out.
  const PAGE_INTRO = `Each page with open findings, scored with the same rules as the site but counting only the findings listed for that page. It's ${OWN_SCORE}, and it doesn't change the site score. Pages come from the findings' examples, so a finding with more cases than examples can affect pages not listed here.`;
  const PAGE_FILE = /\.(xml|txt|json|gz|js|css)$/i; // files are told from pages by extension only
  const hostOf = u => {
    try {
      return new URL(u).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const pageScores = (() => {
    if (!overall) return [];
    // The site's own pages: its public host and subdomains (staging.), or a local build the crawl ran on (localhost, a
    // LAN address, .local or .test). Pages are keyed by path, as elsewhere in the report. A preview on another domain
    // (a vercel.app link) isn't recognised.
    const home = hostOf(site.url),
      LOCAL =
        /^(localhost|127\.[\d.]+|0\.0\.0\.0|\[::1\]|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+)(:\d+)?$|\.(local|test|localhost)(:\d+)?$/i;
    const own = h => !home || h === home || h.endsWith("." + home) || LOCAL.test(h);
    const pages = new Map();
    for (const f of open)
      for (const e of f.evidence || []) {
        let u;
        try {
          u = new URL(e.url);
        } catch {
          continue;
        }
        if (!/^https?:$/.test(u.protocol) || !own(hostOf(u.href)) || PAGE_FILE.test(u.pathname)) continue;
        const p = u.pathname + u.search;
        (pages.get(p) || pages.set(p, new Set()).get(p)).add(f);
      }
    return [...pages]
      .map(([path, fs]) => ({
        path,
        ids: [...fs].map(f => f.id),
        value: score(buildRules({ assume: f => !fs.has(f) })).value,
      }))
      .sort((a, b) => a.value - b.value || b.ids.length - a.ids.length || a.path.localeCompare(b.path));
  })();
  // The page shows the 10 lowest, the Markdown all. PAGE_INTRO is a local sentence, written into the page as is.
  const pageScoresPanel = () =>
    pageScores.length && {
      cls: "pagescores",
      title: "Page scores",
      blocks: [
        { p: { html: PAGE_INTRO, md: PAGE_INTRO } },
        {
          head: ["Page", "Score", "Open findings"],
          align: ["---", "---:", "---"],
          cap: 10,
          rows: pageScores.map(p => [
            { code: p.path },
            { html: String(p.value), md: `${p.value}/100` },
            p.ids.flatMap((id, i) => (i ? [", ", { id }] : [{ id }])),
          ]),
        },
        pageScores.length > 10 &&
          mdFile && {
            page: [`The 10 lowest. All ${num(pageScores.length)} pages are listed in `, { code: mdFile }, "."],
          },
      ],
    };

  // Every turned-off check, changed severity and warning about settings.json, so a setting is never silent. Ids and
  // warnings come from the user's file, so they're escaped.
  const SETTINGS_INTRO =
    "From seo-audit/settings.json, this project's own settings. A check turned off is left out of the findings, and the score leaves turned-off checks out, as if they hadn't run. A changed severity counts in the score too. Blockers can't be turned off or lowered there.";
  const settingRows = () => [
    ...checkSettings.off.map(o => [
      o.check,
      `Turned off: ${o.count ? `${plural(o.count, "finding")} left out` : "no findings this run"}.`,
    ]),
    ...checkSettings.changed.map(c => [
      c.check,
      `Severity set to ${c.to === "needs-decision" ? "decision needed" : c.to}: ${c.count ? `${plural(c.count, "finding")} changed` : "no findings this run"}.`,
    ]),
  ];
  const settingsSummary = () =>
    [
      checkSettings.off.length && `${plural(checkSettings.off.length, "check")} turned off`,
      checkSettings.changed.length && `${plural(checkSettings.changed.length, "severity", "severities")} changed`,
      checkSettings.warnings.length && plural(checkSettings.warnings.length, "warning"),
    ]
      .filter(Boolean)
      .join(" · ");
  const checkSettingsPanel = () =>
    (settingRows().length || checkSettings.warnings.length) && {
      cls: "checksettings",
      title: "Check settings",
      summary: `Check settings: ${settingsSummary()}`,
      blocks: [
        { p: SETTINGS_INTRO },
        {
          rows: [
            ...settingRows().map(([id, t]) => [{ code: id }, t]),
            ...checkSettings.warnings.map(w => ["Warning", w, ": "]),
          ],
        },
      ],
    };
  return {
    viewsHtml,
    viewsMd,
    hstsPreload,
    crawlCoverage,
    browser,
    pageScores: pageScoresPanel,
    checkSettings: checkSettingsPanel,
    settingRows,
    settingsSummary,
  };
}
