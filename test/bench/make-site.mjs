// Deterministic synthetic site for the benchmark: ~35-45 KB pages with menus, inline assets, images and JSON-LD.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const N = Number(process.argv[2] || 500);
const ROOT = process.argv[3] || join(tmpdir(), `seo-supervisor-bench-${N}`);
const ORIGIN = "https://www.perf-example.com"; // public origin in canonicals/sitemap; mapped onto 127.0.0.1 by --site-origin
rmSync(ROOT, { recursive: true, force: true });
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const SYL =
  "ka lo mi nu pe ra si to ve za bri cla dro fen gor hul jin kel mor nas pol quin rus tal vin wex yor zel an ber cor del er fal gan hir ix jul".split(
    " ",
  );
const VOCAB = Array.from({ length: 900 }, () =>
  Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(SYL)).join(""),
);
const COMMON =
  "the and of to a in is for that with on as are this by be it from or at your can we our you will have more".split(
    " ",
  );
const word = () => (rnd() < 0.35 ? pick(COMMON) : pick(VOCAB));
const sentence = () => {
  const n = 8 + Math.floor(rnd() * 14);
  const w = Array.from({ length: n }, word);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(" ") + ".";
};
const para = () => Array.from({ length: 3 + Math.floor(rnd() * 4) }, sentence).join(" ");
const SECTIONS = [
  "services",
  "blog",
  "guides",
  "products",
  "locations",
  "case-studies",
  "docs",
  "news",
  "team",
  "resources",
];
const pages = [{ path: "/", title: "Perf Example Co - Home", section: null }];
for (const s of SECTIONS) pages.push({ path: `/${s}/`, title: `${s} | Perf Example`, section: s, hub: true });
for (let i = 0; pages.length < N; i++) {
  const s = SECTIONS[i % SECTIONS.length];
  pages.push({ path: `/${s}/${s}-item-${Math.floor(i / SECTIONS.length) + 1}/`, section: s });
}
for (const p of pages)
  if (!p.hub && p.path !== "/")
    p.title = `${p.section.replace("-", " ")} ${p.path.split("-").at(-1).replace("/", "")}: ${Array.from({ length: 4 }, () => pick(VOCAB)).join(" ")} | Perf Example`;
const IMAGES = Array.from({ length: 120 }, (_, i) => ({
  path: `/img/photo-${i + 1}.${i % 3 ? "jpg" : "png"}`,
  w: 400 + (i % 7) * 200,
  h: 300 + (i % 5) * 120,
}));
const nav =
  `<nav class="mega">` +
  SECTIONS.map(
    s =>
      `<div class="col"><a href="/${s}/">${s}</a><ul>` +
      pages
        .filter(p => p.section === s && !p.hub)
        .slice(0, 10)
        .map(p => `<li><a href="${p.path}">${p.title.split(":")[0]}</a></li>`)
        .join("") +
      `</ul></div>`,
  ).join("") +
  `</nav>`;
const footer = `<footer><ul>${["about", "contact", "privacy", "terms", "careers", "press", "help", "status"].map(x => `<li><a href="/resources/">${x}</a></li>`).join("")}</ul><p>&copy; 2026 Perf Example Co. 12 High Street, Leeds. +44 113 496 0000</p><a href="https://twitter.example.org/perfexample">X</a> <a href="https://www.linkedin.example.org/company/perf">LinkedIn</a></footer>`;
const css = `<style>${Array.from({ length: 520 }, (_, i) => `.c${i}{margin:${i % 9}px;padding:${i % 7}px;color:#${(i * 99991).toString(16).slice(0, 6).padEnd(6, "0")}}`).join("\n")}</style>`;
const inlineJs = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());${Array.from({ length: 500 }, (_, i) => `var v${i}=${i}*2;`).join("")}</script>`;
const html = (p, i) => {
  const url = ORIGIN + p.path,
    desc = sentence().slice(0, 150);
  const body = Array.from(
    { length: 4 + Math.floor(rnd() * 4) },
    (_, k) =>
      `<h2>${Array.from({ length: 3 }, () => pick(VOCAB)).join(" ")}</h2><p>${para()}</p>` +
      (k === 1
        ? `<p>See also <a href="${pick(pages).path}">${pick(VOCAB)} ${pick(VOCAB)}</a> and <a href="${pick(pages).path}">${pick(VOCAB)}</a>.</p>`
        : ""),
  ).join("");
  const imgs = Array.from({ length: 3 + (i % 3) }, (_, k) => {
    const im = IMAGES[(i * 3 + k) % IMAGES.length];
    return `<img src="${im.path}" alt="${pick(VOCAB)} ${pick(VOCAB)}" width="${im.w}" height="${im.h}"${k ? ' loading="lazy"' : ""}>`;
  }).join("");
  const related = Array.from({ length: 6 }, () => pick(pages))
    .map(q => `<li><a href="${q.path}">${q.title.split("|")[0].trim()}</a></li>`)
    .join("");
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN + "/" },
      ...(p.section ? [{ "@type": "ListItem", position: 2, name: p.section, item: `${ORIGIN}/${p.section}/` }] : []),
    ],
  };
  const main =
    p.path === "/"
      ? {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": ORIGIN + "/#org",
              name: "Perf Example Co",
              url: ORIGIN,
              logo: ORIGIN + "/img/photo-1.png",
            },
            { "@type": "WebSite", "@id": ORIGIN + "/#site", name: "Perf Example", url: ORIGIN },
          ],
        }
      : p.section === "products"
        ? {
            "@context": "https://schema.org",
            "@type": "Product",
            name: p.title.split(":")[0],
            image: ORIGIN + IMAGES[i % IMAGES.length].path,
            offers: { "@type": "Offer", price: "49.99", priceCurrency: "GBP" },
          }
        : {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: p.title.split("|")[0].trim(),
            image: ORIGIN + IMAGES[i % IMAGES.length].path,
            datePublished: "2026-03-01",
            author: { "@type": "Person", name: "Sam Writer" },
          };
  const hubList =
    p.hub || p.path === "/"
      ? `<ul class="list">${pages
          .filter(q => (p.path === "/" ? !q.hub && q.path !== "/" : q.section === p.section && !q.hub))
          .slice(0, p.path === "/" ? 30 : 60)
          .map(q => `<li><a href="${q.path}">${q.title.split("|")[0].trim()}</a></li>`)
          .join("")}</ul>`
      : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title><meta name="description" content="${desc}"><link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="${p.title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:image" content="${ORIGIN}/img/photo-${(i % 20) + 1}.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/assets/site.css"><script src="/assets/js/app-1.js" defer></script><script src="/assets/js/app-2.js" defer></script><script src="/assets/js/vendor.js" async></script>
${css}
<script type="application/ld+json">${JSON.stringify(crumbs)}</script><script type="application/ld+json">${JSON.stringify(main)}</script>
</head><body><header><a href="/" class="logo">Perf Example</a>${nav}</header>
<main><article><h1>${p.title.split("|")[0].trim()}</h1>${imgs}${body}${hubList}<aside><h3>Related</h3><ul>${related}</ul></aside></article></main>
${footer}${inlineJs}</body></html>`;
};
const write = (path, data) => {
  const f = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
};
let bytes = 0;
pages.forEach((p, i) => {
  const h = html(p, i);
  bytes += h.length;
  write(p.path, h);
});
write("/robots.txt", `User-agent: *\nAllow: /\nDisallow: /search/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
write(
  "/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p, i) => `<url><loc>${ORIGIN}${p.path}</loc><lastmod>2026-1${i % 2}-0${1 + (i % 9)}</lastmod></url>`).join("\n")}\n</urlset>\n`,
);
// Real PNG and JPEG headers carrying the pixel size, padded to a realistic weight.
const png = (w, h, size) => {
  const b = Buffer.alloc(size);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w, h, size) => {
  const b = Buffer.alloc(size);
  b.writeUInt16BE(0xffd8, 0);
  b.writeUInt16BE(0xffe0, 2);
  b.writeUInt16BE(16, 4);
  b.write("JFIF\0", 6, "latin1");
  const o = 20;
  b.writeUInt16BE(0xffc0, o);
  b.writeUInt16BE(17, o + 2);
  b[o + 4] = 8;
  b.writeUInt16BE(h, o + 5);
  b.writeUInt16BE(w, o + 7);
  return b;
};
IMAGES.forEach((im, i) =>
  write(
    im.path,
    im.path.endsWith(".png") ? png(1200, 630, 20000 + (i % 10) * 30000) : jpeg(im.w, im.h, 15000 + (i % 12) * 25000),
  ),
);
for (let i = 1; i <= 20; i++)
  if (!IMAGES.find(x => x.path === `/img/photo-${i}.png`)) write(`/img/photo-${i}.png`, png(1200, 630, 60000));
write("/favicon.ico", Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 48, 48, 0, 0, 1, 0, 32, 0]), Buffer.alloc(2000)]));
write("/assets/site.css", "body{margin:0}\n".repeat(2000));
for (const n of ["app-1", "app-2", "vendor"])
  write(
    `/assets/js/${n}.js`,
    `/* ${n} */\n` +
      Array.from({ length: 3000 }, (_, i) => `function f${i}(a){return a*${i}+"${pick(VOCAB)}";}`).join("\n"),
  );
console.log(`wrote ${pages.length} pages, avg ${Math.round(bytes / pages.length / 1024)} KB HTML, to ${ROOT}`);
