// @ts-check
// The local panels on the Site & content tab: the local business and the local rank grid.
import { esc, fmtDate, noteMd, num, obj, plural } from "../format.mjs";

export function localPanels({ raw }) {
  // OpenStreetMap's credit goes wherever its data shows (ODbL). Names, addresses and evidence come from the site or
  // from OpenStreetMap, so each is escaped.
  // https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
  const lbRaw = obj(raw.localBusiness),
    nbRaw = obj(raw.nearby),
    gcRaw = obj(raw.geocode);
  const LOCAL_KIND = {
    storefront: "Customers come to the business's address: a storefront.",
    "service-area":
      "The business goes to its customers: a service-area business. It may hide its street address, so the address check doesn't ask for it (LOCAL-06).",
    hybrid:
      "Customers come to the business's address, and it also goes to them. Keep the address on the site and in the schema, and list the towns it serves as areaServed (LOCAL-12).",
  };
  const OSM_CREDIT =
    "Map data © OpenStreetMap contributors, under the Open Database License (https://www.openstreetmap.org/copyright).";
  const lcFin = x => typeof x === "number" && Number.isFinite(x);
  const lcDist = m => (m < 1000 ? `${num(Math.round(m))} m` : `${+(m / 1000).toFixed(1)} km`);
  const lcStr = x => typeof x === "string" && x.trim() !== "";
  // [text, list of [name, detail]] blocks, and whether OpenStreetMap's data is shown.
  const localLines = () => {
    const L = [];
    if (lbRaw && LOCAL_KIND[lbRaw.kind])
      L.push([
        LOCAL_KIND[lbRaw.kind],
        (Array.isArray(lbRaw.evidence) ? lbRaw.evidence.filter(lcStr) : []).slice(0, 6).map(e => [e, ""]),
      ]);
    const nb = nbRaw && [nbRaw.count, nbRaw.radiusM, nbRaw.perKm2].every(lcFin) ? nbRaw : null;
    if (nb)
      L.push([
        `OpenStreetMap lists ${plural(nb.count, "other place")} of the same kind (${lcStr(nb.label) ? nb.label : "the business's type"}) within ${lcDist(nb.radiusM)} of ${lcStr(nb.centerFrom) ? nb.centerFrom : "the business"}: about ${nb.perKm2} per km². Context only: volunteers keep OpenStreetMap, so it can miss businesses or list closed ones.`,
        (Array.isArray(nb.places) ? nb.places : [])
          .filter(p => obj(p) && lcStr(p.name) && lcFin(p.distanceM))
          .slice(0, 10)
          .map(p => [p.name, lcDist(p.distanceM)]),
      ]);
    const g = gcRaw && lcStr(gcRaw.query) ? gcRaw : null,
      f = obj(g?.found);
    if (g && !f)
      L.push([
        `OpenStreetMap's Nominatim couldn't find “${g.query}”. If the address is right, it may just be missing from OpenStreetMap; that's not a problem with the site.`,
        [],
      ]);
    else if (g && lcFin(f.lat) && lcFin(f.lon)) {
      if (lcFin(g.distanceM))
        L.push([
          g.distanceM > 250
            ? `OpenStreetMap's Nominatim places “${g.query}” ${lcDist(g.distanceM)} from the schema's geo. Check which is right on a map: geo should mark the business's own door (LOCAL-06).`
            : `OpenStreetMap's Nominatim places “${g.query}” ${lcDist(g.distanceM)} from the schema's geo, so the two agree.`,
          [],
        ]);
      else if (g.suggestGeo === true)
        L.push([
          `The schema has no geo. OpenStreetMap's Nominatim places “${g.query}” at ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}. Check the point on a map, then add it to the business schema as geo, with latitude and longitude (LOCAL-06).`,
          [],
        ]);
    }
    return { L, osm: !!nb || !!g };
  };
  const LOCAL_INTRO = "Information only: none of this changes the score. 250 m is our own line for the address check.";
  const local = () => {
    const { L, osm } = localLines();
    return (
      L.length && {
        cls: "local",
        title: "Local business",
        blocks: [
          { p: LOCAL_INTRO },
          ...L.flatMap(([t, list]) => [{ p: t }, { rows: list.map(([k, v]) => [k, v || undefined]) }]),
          osm && {
            html: `<p class="quiet">Map data <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, under the Open Database License.</p>`,
            md: [noteMd(OSM_CREDIT), ""],
          },
        ],
      }
    );
  };

  // geoGrid comes from geo-grid.json. Google's terms forbid Places results on a non-Google map, so it's a plain grid
  // with north at the top, credited "Google Maps". Counts come from the cells, never the file's own totals, and the
  // label is written here, not read from the file.
  // https://cloud.google.com/maps-platform/terms/maps-service-terms
  const GRID_SIZES = new Set([5, 7, 9]);
  const grid = (g => {
    if (!g || !GRID_SIZES.has(g.size) || !Array.isArray(g.keywords)) return null;
    const n = g.size,
      inGrid = c => obj(c) && [c.row, c.col].every(v => Number.isInteger(v) && v >= 0 && v < n);
    const rankOf = r => (Number.isInteger(r) && r >= 1 && r <= 20 ? r : r === "error" ? "error" : null);
    const keywords = g.keywords
      .filter(k => obj(k) && typeof k.keyword === "string" && k.keyword.trim() && Array.isArray(k.cells))
      .slice(0, 3)
      .map(k => {
        const at = Array.from({ length: n }, () => Array(n).fill(undefined));
        for (const c of k.cells.filter(inGrid)) at[c.row][c.col] = rankOf(c.rank);
        const seen = at.flat().filter(v => v !== undefined),
          count = f => seen.filter(f).length,
          ranked = r => typeof r === "number";
        return {
          keyword: k.keyword.trim(),
          at,
          points: seen.length,
          top3: count(r => ranked(r) && r <= 3),
          top10: count(r => ranked(r) && r <= 10),
          notFound: count(r => r === null),
          failed: count(r => r === "error"),
        };
      })
      .filter(k => k.points === n * n); // a grid with holes would mislead, so it isn't drawn
    if (!keywords.length) return null;
    // The run's own notes, including any third-party credit Google returned, which its terms require showing.
    const notes = (Array.isArray(g.notes) ? g.notes : [])
      .filter(t => typeof t === "string" && t.trim())
      .slice(0, 6)
      .map(t => t.trim().slice(0, 400));
    return {
      n,
      keywords,
      notes,
      km: Number.isFinite(g.spacingKm) && g.spacingKm > 0 && g.spacingKm <= 50 ? g.spacingKm : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : null,
    };
  })(obj(raw.geoGrid));
  const GRID_BANDS = [
    ["top3", "1–3"],
    ["top10", "4–10"],
    ["top20", "11–20"],
    ["out", "Not in the top 20"],
    ["err", "Not checked"],
  ];
  const gridBand = r => (r === "error" ? "err" : r === null ? "out" : r <= 3 ? "top3" : r <= 10 ? "top10" : "top20");
  const gridIntro = () =>
    `Where your business appears in the list Google's Places API returns near each spot: an approximation of Google Maps results, not a copy. Each square is a spot${grid.km ? ` ${+grid.km.toFixed(2)} km` : ""} apart around your business, north at the top, and the outlined square is your business.${grid.date ? ` Checked on ${fmtDate(grid.date)}.` : ""} Information only: it doesn't change the score.`;
  const gridLine = k =>
    `Top 3 at ${k.top3} of ${k.points} spots · top 10 at ${k.top10} · not in the top 20 at ${k.notFound}${k.failed ? ` · ${k.failed} not checked` : ""}`;
  // Where a square is, from the business: "2 km north, 1 km west".
  const gridWhere = (row, col) => {
    const c = (grid.n - 1) / 2,
      away = (d, plus, minus) =>
        d &&
        `${grid.km ? `${+(Math.abs(d) * grid.km).toFixed(2)} km` : plural(Math.abs(d), "square")} ${d > 0 ? plus : minus}`;
    return row === c && col === c
      ? "Your business"
      : [away(row - c, "south", "north"), away(col - c, "east", "west")].filter(Boolean).join(", ");
  };
  const gridSay = r =>
    r === "error" ? "not checked, the request failed" : r === null ? "not in the top 20" : `position ${r}`;
  const geoGridHtml = () =>
    grid
      ? `\n    <details class="how geogrid"><summary>Local rank grid</summary><p>${esc(gridIntro())}</p>` +
        `<p class="gg-legend">${GRID_BANDS.filter(([b]) => b !== "err" || grid.keywords.some(k => k.failed))
          .map(([b, t]) => `<span><i class="gg-${b}" aria-hidden="true"></i>${esc(t)}</span>`)
          .join("")}</p><div class="gg-list">` +
        grid.keywords
          .map(
            k =>
              `<figure class="gg"><figcaption><b>${esc(k.keyword)}</b><span>${esc(gridLine(k))}</span></figcaption><span class="gg-north" aria-hidden="true">North</span>` +
              `<div class="gg-grid" style="--n:${grid.n}" role="img" aria-label="${esc(`${k.keyword}: ${gridLine(k).replace(/^Top/, "top")}`)}">` +
              k.at
                .map((row, i) =>
                  row
                    .map(
                      (r, j) =>
                        `<span class="gg-c gg-${gridBand(r)}${i === (grid.n - 1) / 2 && j === i ? " gg-centre" : ""}" title="${esc(`${gridWhere(i, j)}: ${gridSay(r)}`)}">${r === "error" ? "–" : r === null ? "20+" : r}</span>`,
                    )
                    .join(""),
                )
                .join("") +
              `</div><p class="gg-credit">Places data: Google Maps</p></figure>`,
          )
          .join("") +
        `</div>${grid.notes.map(t => `<p>${esc(t)}</p>`).join("")}</details>`
      : "";
  const geoGridMd = () =>
    grid
      ? [
          "## Local rank grid",
          "",
          noteMd(gridIntro()),
          "",
          ...grid.keywords.flatMap(k => [
            `### ${noteMd(k.keyword)}`,
            "",
            noteMd(gridLine(k)),
            "",
            "```",
            "North",
            ...k.at.map((row, i) =>
              row
                .map((r, j) => {
                  const t = r === "error" ? "-" : r === null ? "20+" : String(r);
                  return (i === (grid.n - 1) / 2 && j === i ? `[${t}]` : t).padStart(3);
                })
                .join(" "),
            ),
            "```",
            "",
          ]),
          "Places data: Google Maps",
          "",
          ...grid.notes.flatMap(t => [noteMd(t), ""]),
        ]
      : [];
  return { local, geoGridHtml, geoGridMd };
}
