// @ts-check
// The speed and image panels, with Lighthouse's details and accessibility checks.
import { band } from "../../checks/speed.mjs";
import { cellMd, esc, fmtDate, inl, noteCode, noteMd, notePath, num, obj, plural } from "../format.mjs";
import { LCP_PART } from "../overview-lines.mjs";

export function speedPanels({ raw, mdFile }) {
  // Images ranked by what converting or resizing them would save, top 15. Crawled text is escaped.
  const imageRows = (Array.isArray(raw.images) ? raw.images : [])
    .filter(i => obj(i) && typeof i.url === "string" && Number.isFinite(i.bytes) && i.estSaving > 0)
    .sort((a, b) => b.estSaving - a.estSaving)
    .slice(0, 15);
  const kbOf = n => `${num(Math.round(n / 1024))} KB`;
  const imageWhat = i => [i.format, i.width && i.height && `${i.width} × ${i.height} px`].filter(Boolean).join(" · ");
  const IMAGES_INTRO =
    "A rough estimate of what WebP and resizing to 1,600 px wide would save: Google measured lossy WebP 25–34% smaller than JPEG and lossless WebP 26% smaller than PNG, and the low end is used. Information only: it never changes the score. With your yes, scripts/images.mjs converts the JPEG and PNG ones and keeps the originals (it needs the optional image add-on: npx seo-supervisor --with-image-tools).";
  const imagesHtml = () =>
    imageRows.length
      ? `\n    <details class="how images"><summary>Images by possible saving</summary><p>${esc(IMAGES_INTRO)}</p><div class="tablewrap"><table><thead><tr><th scope="col">Image</th><th scope="col">Size</th><th scope="col">Format</th><th scope="col">Possible saving</th></tr></thead><tbody>${imageRows.map(i => `<tr><td><code>${esc(notePath(i.url))}</code></td><td>${kbOf(i.bytes)}</td><td>${esc(imageWhat(i))}</td><td>about ${kbOf(i.estSaving)}</td></tr>`).join("")}</tbody></table></div></details>`
      : "";
  const imagesMd = () =>
    imageRows.length
      ? [
          "## Images by possible saving",
          "",
          IMAGES_INTRO,
          "",
          "| Image | Size | Format | Possible saving |",
          "| --- | ---: | --- | ---: |",
          ...imageRows.map(
            i =>
              `| ${cellMd(noteCode(notePath(i.url)))} | ${kbOf(i.bytes)} | ${cellMd(noteMd(imageWhat(i)))} | about ${kbOf(i.estSaving)} |`,
          ),
          "",
        ]
      : [];

  // Each run's failed audits, each with up to 10 files or page elements. Titles come from Lighthouse (Markdown
  // backticks included) and files from the site, so both are escaped.
  const lhRuns = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(x => obj(x) && typeof x.url === "string" && Array.isArray(x.detail))
    .map(x => ({
      path: notePath(x.url),
      audits: x.detail
        .filter(a => obj(a) && typeof a.title === "string")
        .map(a => ({
          ...a,
          items: (Array.isArray(a.items) ? a.items : []).filter(s => typeof s === "string" && s).slice(0, 10),
        })),
    }))
    .filter(x => x.audits.length);
  const LH_INTRO =
    "Every audit each Lighthouse run failed, with the files or page elements it names (10 at most). Information only: Lighthouse's lab results don't change the score.";
  const lighthouseDetailHtml = () =>
    lhRuns.length
      ? `\n    <details class="how lhdetail"><summary>Lighthouse details</summary><p>${esc(LH_INTRO)}</p>${lhRuns
          .slice(0, 10)
          .map(
            x =>
              `<details><summary><code>${esc(x.path)}</code> · ${plural(x.audits.length, "failed audit")}</summary><ul class="lim">${x.audits.map(a => `<li><b>${inl(a.title)}</b><span>${esc(a.category || "")}${a.items.length ? ` · ${a.items.map(s => `<code>${esc(s)}</code>`).join(", ")}` : ""}</span></li>`).join("")}</ul></details>`,
          )
          .join(
            "",
          )}${lhRuns.length > 10 && mdFile ? `<p>All ${num(lhRuns.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const lighthouseDetailMd = () =>
    lhRuns.length
      ? [
          "## Lighthouse details",
          "",
          LH_INTRO,
          "",
          ...lhRuns.flatMap(x => [
            `### ${noteCode(x.path)}`,
            "",
            ...x.audits.map(
              a =>
                `- ${noteMd(a.title)}${a.category ? ` (${noteMd(a.category)})` : ""}${a.items.length ? `: ${a.items.map(noteCode).join(", ")}` : ""}`,
            ),
            "",
          ]),
        ]
      : [];

  // Speed and image details, in one collapsed panel. Crawled and third-party text (paths, element labels, hosts,
  // versions) is escaped by the two callers.
  const mediaNums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const mediaPair = (k, [a, b]) =>
    k === "cls"
      ? `CLS ${a} → ${b}`
      : k === "inp"
        ? `INP ${Math.round(a)} → ${Math.round(b)} ms`
        : `LCP ${(a / 1000).toFixed(1)} → ${(b / 1000).toFixed(1)} s`;
  const mediaPairs = (o, keys = ["lcp", "inp", "cls"]) =>
    keys
      .filter(k => mediaNums(o?.[k], 2))
      .map(k => mediaPair(k, o[k]))
      .join(" · ");
  const mediaDay = (s, year = false) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s, year) : null);
  const mediaList = (xs, f, max = 5) =>
    xs.slice(0, max).map(f).join(" · ") + (xs.length > max ? ` and ${num(xs.length - max)} more` : "");
  const mediaLines = () => {
    const s = obj(raw.speed),
      m = obj(raw.media) || {},
      L = [],
      arr = x => (Array.isArray(x) ? x.filter(obj) : []),
      str = x => typeof x === "string" && x !== "";
    const samples = arr(s?.samples),
      v = obj(samples.find(x => obj(x.origin))?.origin) || obj(samples.find(x => obj(x.field))?.field);
    const KEYS = ["lcp", "inp", "cls", "fcp", "ttfb"],
      pct = x => `${Math.round(x * 100)}%`;
    const shares = KEYS.filter(k => mediaNums(v?.shares?.[k], 3)).map(
      k => `${k.toUpperCase()} ${v.shares[k].map(pct).join(" / ")}`,
    );
    if (shares.length) L.push(`Share of real visits that were good / needs improvement / poor: ${shares.join(" · ")}.`);
    const other = ["fcp", "ttfb"]
      .filter(k => Number.isFinite(v?.[k]))
      .map(k => `${k.toUpperCase()} ${(v[k] / 1000).toFixed(1)} s (${band(k, v[k])})`);
    if (other.length)
      L.push(
        `Other real-user numbers, not Core Web Vitals: ${other.join(" · ")}. Google's lines: FCP good up to 1.8 s, poor over 3 s; TTFB good up to 0.8 s, poor over 1.8 s, as a rough guide.`,
      );
    const t = obj(s?.trend),
      p = obj(t?.period),
      weeks = Number.isInteger(t?.weeks) ? t.weeks : 0;
    if (p && mediaDay(p.from) && mediaDay(p.to))
      L.push(`Real-user data period: CrUX's latest 28 days, ${mediaDay(p.from)} – ${mediaDay(p.to, true)}.`);
    else if (v && (v.shares || v.fcp != null || v.ttfb != null))
      L.push("Real-user data period: PageSpeed's numbers cover the last 28 days of Chrome visits.");
    const late = mediaPairs(t, ["inp", "cls"]),
      avg = mediaPairs(obj(t?.avg4));
    if (weeks && (late || avg))
      L.push(
        [
          late && `Over ${weeks} weeks (first week → latest): ${late}.`,
          avg && `4-week averages: ${avg} (the first four weeks against the last four).`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    const pt = obj(s?.pageTrend),
      ptw = mediaPairs(obj(pt?.trend));
    if (ptw && str(pt.url))
      L.push(
        `${notePath(pt.url) === "/" ? "Home page" : notePath(pt.url)} alone: ${ptw} over ${num(pt.trend.weeks || 0)} weeks.`,
      );
    const tab = obj(s?.tablet),
      tl = obj(tab?.trend)?.lcp,
      tb = obj(tab?.lcpBreakdown);
    if (mediaNums(tl, 2)) {
      const [k] = Object.keys(LCP_PART).sort((x, y) => (tb?.[y] || 0) - (tb?.[x] || 0));
      L.push(
        `Tablet (whole site): ${mediaPair("lcp", tl)} over ${num(tab.trend.weeks || 0)} weeks${tb && Number.isFinite(tb[k]) ? `; most of the LCP goes on ${LCP_PART[k][0]} (${(tb[k] / 1000).toFixed(1)} s)` : ""}.`,
      );
    }
    const heroes = arr(m.heroImages).filter(h => str(h.url) && str(h.element));
    if (heroes.length)
      L.push(
        `Largest paint in the lab (the LCP element): ${mediaList(heroes, h => `${notePath(h.url)} → ${str(h.src) ? `${h.src} (${h.element})` : h.element}${str(h.source) ? `, ${h.source}` : ""}`)}.`,
      );
    const med = obj(m.lighthouseMedians),
      medParts = [
        ["Performance", "performance"],
        ["SEO", "seo"],
        ["Accessibility", "accessibility"],
        ["Best practices", "bestPractices"],
      ]
        .filter(([, k]) => Number.isFinite(med?.[k]))
        .map(([n, k]) => `${n} ${med[k]}`);
    if (medParts.length && Number.isInteger(med.pages))
      L.push(`Lighthouse medians across ${num(med.pages)} pages: ${medParts.join(" · ")}.`);
    const runs = arr(raw.lighthouse).filter(x => str(x.url) && Number.isInteger(x.passed)),
      ver = runs.find(x => str(x.version))?.version;
    if (runs.length)
      L.push(
        `Lighthouse${ver ? ` ${ver}` : ""}: ${mediaList(runs, x => `${notePath(x.url)} passed ${num(x.passed)} audits, failed ${num(Array.isArray(x.detail) ? x.detail.length : 0)}`)}.`,
      );
    const psiVer = samples.map(x => obj(x.lab)?.version).find(str);
    if (psiVer) L.push(`PageSpeed's lab runs used Lighthouse ${psiVer}.`);
    const st = obj(m.serverTimes),
      slow = arr(st?.slow).filter(x => str(x.url) && Number.isFinite(x.ms));
    if (st && [st.pages, st.median, st.p95].every(Number.isFinite))
      L.push(
        `Server response time, one request per page from this machine, ${num(st.pages)} pages: median ${num(st.median)} ms, the slowest 5% from ${num(st.p95)} ms.${slow.length ? ` Over 0.8 s (web.dev's “good” time to first byte for real visitors): ${mediaList(slow, x => `${notePath(x.url)} ${(x.ms / 1000).toFixed(1)} s`)}.` : ""}`,
      );
    const ds = obj(m.domShape),
      deep = arr(ds?.deep).filter(d => str(d.url) && Number.isFinite(d.depth)),
      wide = arr(ds?.wide).filter(d => str(d.url) && str(d.tag) && Number.isFinite(d.children));
    if (deep.length)
      L.push(
        `Nested more than 32 levels deep (our own line, from older Lighthouse advice): ${mediaList(deep, d => `${notePath(d.url)} ${d.depth} levels`)}. Deep nesting usually means wrapper elements that could go.`,
      );
    if (wide.length)
      L.push(
        `An element with more than 60 children (our own line): ${mediaList(wide, d => `${notePath(d.url)} ${d.tag} (${num(d.children)})`)}. Long lists can load in parts.`,
      );
    const cr = obj(m.imageCredits);
    if (cr && Number.isInteger(cr.read) && cr.read > 0) {
      const ai = (Array.isArray(cr.ai) ? cr.ai : []).filter(str),
        aiN = Number.isInteger(cr.aiCount) ? cr.aiCount : ai.length,
        none = (Array.isArray(cr.noCreator) ? cr.noCreator : []).filter(str);
      L.push(
        `Image credits, read from ${plural(cr.read, "image")}: ${num(cr.creator || 0)} name a creator, ${num(aiN)} ${aiN === 1 ? "is" : "are"} labelled as made with AI${ai.length ? ` (${mediaList(ai, notePath)})` : ""}, ${num(cr.c2pa || 0)} carry Content Credentials (C2PA).${none.length ? ` No creator: ${mediaList(none, notePath)}.` : ""}`,
      );
    }
    const ca = obj(m.imageCache),
      unc = (Array.isArray(ca?.uncached) ? ca.uncached : []).filter(str),
      hosts = Object.entries(obj(ca?.otherHosts) || {}).filter(([h, n]) => str(h) && Number.isInteger(n));
    if (ca && ((Number.isInteger(ca.checked) && ca.checked > 0) || hosts.length))
      L.push(
        [
          ca.checked > 0 &&
            `Image caching: ${num(Number.isInteger(ca.uncachedCount) ? ca.uncachedCount : unc.length)} of ${plural(ca.checked, "image")} are sent with no cache lifetime${unc.length ? ` (${mediaList(unc, notePath)})` : ""}, so browsers download them again on every visit.`,
          str(ca.cdn) && `They come through ${ca.cdn}.`,
          hosts.length && `Images on other hosts: ${mediaList(hosts, ([h, n]) => `${h} (${num(n)})`)}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    return L;
  };
  const MEDIA_INTRO = "Information only: none of this changes the score.";
  const speedDetailsHtml = () => {
    const L = mediaLines();
    return L.length
      ? `\n    <details class="how media"><summary>Speed and image details</summary><p>${esc(MEDIA_INTRO)}</p>${L.map(t => `<p>${esc(t)}</p>`).join("")}</details>`
      : "";
  };
  const speedDetailsMd = () => {
    const L = mediaLines();
    return L.length ? ["## Speed and image details", "", MEDIA_INTRO, "", ...L.flatMap(t => [noteMd(t), ""])] : [];
  };

  // lighthouse.mjs keeps each failed audit with its category title, "Accessibility" in the English runs it starts.
  // Accessibility audits are pass or fail, and some checks, such as trapped focus, need a manual review.
  // https://developer.chrome.com/docs/lighthouse/accessibility/scoring
  const a11yRuns = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(x => obj(x) && typeof x.url === "string" && Array.isArray(x.detail))
    .map(x => ({
      path: notePath(x.url),
      score: Number.isInteger(x.scores?.accessibility) ? x.scores.accessibility : null,
      audits: x.detail
        .filter(a => obj(a) && typeof a.title === "string" && a.category === "Accessibility")
        .map(a => ({
          title: a.title,
          items: (Array.isArray(a.items) ? a.items : []).filter(s => typeof s === "string" && s).slice(0, 10),
        })),
    }))
    .filter(x => x.audits.length);
  const A11Y_INTRO =
    "Lighthouse's own accessibility checks that failed on each page it ran, with the page elements it names (10 at most). Each check is pass or fail. They're Lighthouse's checks, not SEO Supervisor's, and they can't find everything: some problems, such as keyboard focus that gets trapped, only a person can check. Information only: they don't change the score.";
  const a11yHead = x =>
    `${x.score != null ? `Accessibility ${x.score} · ` : ""}${plural(x.audits.length, "failed check")}`;
  const a11yHtml = () =>
    a11yRuns.length
      ? `\n    <details class="how a11y"><summary>Lighthouse's accessibility checks · ${plural(a11yRuns.length, "page")} with failed checks</summary><p>${esc(A11Y_INTRO)}</p>${a11yRuns
          .slice(0, 10)
          .map(
            x =>
              `<details><summary><code>${esc(x.path)}</code> · ${esc(a11yHead(x))}</summary><ul class="lim">${x.audits.map(a => `<li><b>${inl(a.title)}</b><span>${a.items.map(s => `<code>${esc(s)}</code>`).join(", ")}</span></li>`).join("")}</ul></details>`,
          )
          .join(
            "",
          )}${a11yRuns.length > 10 && mdFile ? `<p>All ${num(a11yRuns.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const a11yMd = () =>
    a11yRuns.length
      ? [
          "## Lighthouse's accessibility checks",
          "",
          A11Y_INTRO,
          "",
          ...a11yRuns.flatMap(x => [
            `### ${noteCode(x.path)} (${a11yHead(x)})`,
            "",
            ...x.audits.map(
              a => `- ${noteMd(a.title)}${a.items.length ? `: ${a.items.map(noteCode).join(", ")}` : ""}`,
            ),
            "",
          ]),
        ]
      : [];
  return {
    imagesHtml,
    imagesMd,
    lighthouseDetailHtml,
    lighthouseDetailMd,
    speedDetailsHtml,
    speedDetailsMd,
    a11yHtml,
    a11yMd,
  };
}
