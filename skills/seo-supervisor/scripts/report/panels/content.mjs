// @ts-check
// The content panels on the Site & content tab.
import { esc, noteCode, noteMd, notePath, num, obj, plural, isCount, isText } from "../format.mjs";
import { listedIn } from "../panel.mjs";

export function contentPanels({ raw, mdFile }) {
  // Writing notes quote crawled sentences and URLs, so they're escaped.
  const writingNotes = (Array.isArray(raw.writingNotes) ? raw.writingNotes : []).filter(
    n => obj(n) && typeof n.url === "string",
  );
  const noteText = n => {
    const k = x => Math.max(0, Math.floor(Number(x) || 0)),
      stock = Array.isArray(n.stockPhrases) ? n.stockPhrases.filter(s => typeof s === "string") : [];
    return [
      k(n.longSentences) && `${plural(k(n.longSentences), "sentence")} over 35 words`,
      k(n.longParagraphs) && `${plural(k(n.longParagraphs), "paragraph")} over 150 words`,
      stock.length && `stock phrases: ${stock.map(s => `“${s}”`).join(", ")}`,
      Number.isFinite(n.readingEase) && `reading ease ${n.readingEase}`,
      typeof n.longestSentence === "string" && n.longestSentence && `longest sentence: “${n.longestSentence}”`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const WRITING_INTRO =
    "Long sentences, long paragraphs and stock phrases on English pages, with Flesch reading ease (0 to 100, higher is easier) as a rough guide. Code and tables are left out. These notes help the writing; they never change the score.";
  const writing = () =>
    writingNotes.length && {
      cls: "writing",
      title: "Writing notes",
      blocks: [
        { p: WRITING_INTRO },
        { rows: writingNotes.map(n => [{ code: notePath(n.url) }, noteText(n)]), cap: 10 },
        writingNotes.length > 10 && listedIn(writingNotes.length, mdFile),
      ],
    };

  // How many Products give each recommended merchant listing field. Numbers only, so nothing crawled is shown.
  const productFields = obj(raw.productFields),
    PRODUCT_FIELDS = [
      ["brand", "a brand"],
      ["gtin", "a GTIN or MPN"],
      ["sku", "a SKU"],
      ["color", "a colour"],
      ["size", "a size"],
      ["material", "a material"],
      ["category", "a category"],
    ];
  const productLine =
    productFields &&
    isCount(productFields.products) &&
    productFields.products > 0 &&
    PRODUCT_FIELDS.every(([k]) => isCount(productFields[k]))
      ? `Of ${plural(productFields.products, "product")} in the schema: ${PRODUCT_FIELDS.map(([k, w]) => `${num(productFields[k])} with ${w}`).join(", ")}. Google recommends each one where the product has it, so a GTIN, colour or material can rightly be missing. Information only: it doesn't change the score.`
      : "";
  const productData = () => productLine && { title: "Product data", blocks: [{ quiet: productLine }] };

  // Templated descriptions (META-02) and keyword use on English pages (CONTENT-03). Crawled text is escaped.
  const tdShare = (t =>
    t && Number.isInteger(t.pages) && Number.isInteger(t.templated) && t.templated > 0 && t.pages >= t.templated
      ? t
      : null)(obj(raw.templatedDescriptions));
  const tdClusters =
    tdShare && Array.isArray(tdShare.clusters)
      ? tdShare.clusters.filter(
          c => obj(c) && typeof c.section === "string" && Number.isInteger(c.templated) && Number.isInteger(c.pages),
        )
      : [];
  // The verdict is a local sentence, so it's written as is.
  const asIs = s => ({ html: s, md: s });
  const tdText = () => [
    `${num(tdShare.templated)} of ${plural(tdShare.pages, "description")} (${Math.round((100 * tdShare.templated) / tdShare.pages)}%) end in a stock call to action or in a last sentence other pages share. `,
    tdShare.verdict === "cluster" && tdClusters.length
      ? [
          asIs("Verdict: a cluster. Most are in "),
          tdClusters.map((c, i) => [i ? ", " : "", { code: c.section }, ` (${c.templated} of ${c.pages} pages)`]),
          asIs(", so that section's template is the fix."),
        ]
      : asIs(
          tdShare.verdict === "site-wide"
            ? "Verdict: site-wide. Half or more of the descriptions are templated, so the shared description template is the fix."
            : "Verdict: scattered. Fix them page by page.",
        ),
  ];
  const KW = ["natural", "missing", "repetitive", "forced"];
  const KW_WHY = {
    missing: "not in the H1 or the first 100 words",
    repetitive: "over 3% of the words",
    forced: "over 5% of the words, or in most subheadings",
  };
  const kwUse = obj(raw.keywordUse),
    kwCounts =
      kwUse && obj(kwUse.counts)
        ? KW.map(v => [v, Number.isInteger(kwUse.counts[v]) && kwUse.counts[v] >= 0 ? kwUse.counts[v] : 0])
        : [];
  const kwPages =
    kwUse && Array.isArray(kwUse.pages)
      ? kwUse.pages.filter(
          k => obj(k) && typeof k.url === "string" && typeof k.phrase === "string" && KW_WHY[k.verdict],
        )
      : [];
  const kwRow = k =>
    `“${k.phrase}”: ${k.verdict}, ${KW_WHY[k.verdict]}${Number.isFinite(k.density) ? ` (${k.density}% of the words)` : ""}`;
  const kwLine = () =>
    `Keyword use on ${plural(
      kwCounts.reduce((n, [, c]) => n + c, 0),
      "English page",
    )}: ${kwCounts.map(([v, c]) => `${num(c)} ${v}`).join(" · ")}.`;
  const CONTENT_INTRO =
    "How the descriptions and the main keyword are written, for information: these notes never change the score. Each English page's main phrase is taken from its title; the 3% and 5% lines are our own, from CONTENT-03's “no density targets above about 2–3%”.";
  const descriptions = () =>
    (tdShare || kwCounts.length) && {
      cls: "content",
      title: "Descriptions and keyword use",
      blocks: [
        { p: CONTENT_INTRO },
        tdShare && { p: tdText() },
        kwCounts.length && { p: kwLine() },
        kwCounts.length && { rows: kwPages.map(k => [{ code: notePath(k.url) }, kwRow(k)]), cap: 10 },
        kwPages.length > 10 && listedIn(kwPages.length, mdFile),
      ],
    };

  // App link files missing or broken on a site that promotes an app, and PDFs that several pages or the menu link to,
  // which Microsoft Advertising advised against for core information (8 Oct 2025). Crawled text is escaped.
  // https://developers.google.com/search/blog/2025/05/app-deep-links
  const appLinks = (Array.isArray(raw.appLinks) ? raw.appLinks : [])
    .filter(a => obj(a) && ["Android", "iOS"].includes(a.platform) && isText(a.file) && isText(a.problem))
    .slice(0, 2);
  const pdfLinks = (l =>
    l && Array.isArray(l.pdfs) ? l.pdfs.filter(p => obj(p) && isText(p.url) && isCount(p.pages)).slice(0, 20) : [])(
    obj(raw.pdfLinks),
  );
  const APP_INTRO =
    "The site links to its app. Phones open the site's links in the app only when a file on the site names the app. Google's post on app deep links (2 May 2025) says they don't change how Google ranks or shows pages: they take people from search results straight into the app. Information only: none of this changes the score.";
  const appTail = a =>
    `${a.problem}. ${a.missing === true ? "That's fine if the app doesn't open the site's links." : `${a.platform === "iOS" ? "iPhones" : "Android phones"} won't open the site's links in the app until it's fixed.`}`;
  const PDF_INTRO =
    "PDFs on the site that 3 or more pages link to (our own cut-off), or that the menu links to. Microsoft Advertising's guide to AI search answers (8 Oct 2025) says to avoid relying on PDFs for core information: search engines can read text PDFs, but they often lack the headings and other structure HTML gives. If any of these hold something important, such as prices, a menu, specifications or opening hours, put it on an HTML page too. Information only: none of this changes the score.";
  const pdfTail = p => `linked from ${plural(p.pages, "page")}${p.menu === true ? ", including the menu" : ""}`;
  const appsPdfs = () =>
    (appLinks.length || pdfLinks.length) && {
      cls: "hygiene",
      title: "App links and PDFs",
      blocks: [
        appLinks.length && { p: APP_INTRO },
        { rows: appLinks.map(a => [a.platform, [{ code: a.file }, " ", appTail(a)], ": "]) },
        pdfLinks.length && { p: PDF_INTRO },
        { rows: pdfLinks.map(p => [{ code: notePath(p.url) }, pdfTail(p)]) },
      ],
    };

  // audiences (audience.md) is written into seo-audit.json and may quote page text, so every string is escaped.
  // Malformed entries are dropped quietly, and lists are capped at 4 audiences, 5 pages each and 10 items a list.
  const audStrs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s.trim()).slice(0, 10) : []);
  const audiences = (Array.isArray(raw.audiences) ? raw.audiences : [])
    .filter(a => obj(a) && typeof a.name === "string" && a.name.trim())
    .map(a => ({
      name: a.name,
      who: [
        typeof a.wants === "string" && a.wants.trim() && `What they come for: ${a.wants}.`,
        typeof a.checked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.checked) && `Checked on ${a.checked}.`,
      ]
        .filter(Boolean)
        .join(" "),
      pages: (Array.isArray(a.pages) ? a.pages : [])
        .filter(p => obj(p) && typeof p.url === "string" && p.url.trim())
        .map(p => ({
          path: notePath(p.url),
          lines: [audStrs(p.has), audStrs(p.missing)]
            .map((l, i) => l.length && `${i ? "Missing" : "On the page"}: ${l.join(" · ")}`)
            .filter(Boolean),
        }))
        .filter(p => p.lines.length)
        .slice(0, 5),
    }))
    .filter(a => a.pages.length)
    .slice(0, 4);
  const AUDIENCE_INTRO =
    "What your key pages give each audience you named, with evidence from the page. It's a checklist, not a score: it never changes the score or the findings. A missing item becomes new text only through brief or rewrite mode, and only with your yes.";
  const audienceHtml = () =>
    audiences.length
      ? `\n    <details class="how audience"><summary>Audience check</summary><p>${esc(AUDIENCE_INTRO)}</p>${audiences.map(a => `<p><b>${esc(a.name)}</b>${a.who ? ` · ${esc(a.who)}` : ""}</p><ul class="lim">${a.pages.map(p => `<li><b><code>${esc(p.path)}</code></b><span>${p.lines.map(esc).join("<br>")}</span></li>`).join("")}</ul>`).join("")}</details>`
      : "";
  const audienceMd = () =>
    audiences.length
      ? [
          "## Audience check",
          "",
          AUDIENCE_INTRO,
          "",
          ...audiences.flatMap(a => [
            `### ${noteMd(a.name)}`,
            "",
            ...(a.who ? [noteMd(a.who), ""] : []),
            ...a.pages.flatMap(p => [`- ${noteCode(p.path)}`, ...p.lines.map(l => `  - ${noteMd(l)}`)]),
            "",
          ]),
        ]
      : [];
  return { writing, productData, descriptions, appsPdfs, audienceHtml, audienceMd };
}
