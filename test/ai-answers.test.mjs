import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";

const ANSWERS = join(SCRIPTS, "ai-answers.mjs"),
  KEYS = join(SCRIPTS, "connect-keys.mjs");
const SITE = "https://www.example.com";
const XSS = "<img src=x onerror=alert(1)>";
const TODAY = new Date().toISOString().slice(0, 10);
const Q1 = "best widget repair shop near me",
  Q2 = "how much does widget repair cost";

// One local server for both providers. routes: "/first-segment" -> (hit, n) => [status, json, headers?], where n
// counts that route's hits from 0.
async function fake(routes) {
  const hits = [],
    seen = {};
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const u = new URL(req.url, "http://x"),
        seg = "/" + u.pathname.split("/")[1];
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {}
      const hit = { seg, verb: req.method, path: u.pathname, headers: req.headers, body };
      hits.push(hit);
      seen[seg] = (seen[seg] ?? -1) + 1;
      const [status, x, headers = {}] = routes[seg]?.(hit, seen[seg]) || [404, { error: "no fake route" }];
      res
        .writeHead(status, { "content-type": "application/json", connection: "close", ...headers })
        .end(JSON.stringify(x));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    hits,
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
// A temp home keeps the developer's real keys out; both providers point at the fake.
const envFor = (home, srv, extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  PERPLEXITY_API_KEY: "",
  OPENAI_API_KEY: "",
  ...(srv ? { PERPLEXITY_ENDPOINT: srv.url + "/pplx/v1/agent", OPENAI_ENDPOINT: srv.url + "/oai/v1/responses" } : {}),
  ...extra,
});
const BOTH = { PERPLEXITY_API_KEY: "pplx-key-0001", OPENAI_API_KEY: "sk-key-0002" };
const questions = (home, lines = [Q1, "", "# a comment, not a question", Q2]) => {
  const f = join(home, "questions.txt");
  writeFileSync(f, lines.join("\n") + "\n");
  return f;
};
const ask = (home, srv, keys, extra = []) =>
  node([ANSWERS, "--site", SITE, "--questions", questions(home), "--out", join(home, "ai.json"), ...extra], {
    env: envFor(home, srv, keys),
  });
const output = home => JSON.parse(readFileSync(join(home, "ai.json"), "utf8"));

// Perplexity's Agent API: the sources come back as a search_results output item.
const pplxAnswer = urls => [
  200,
  {
    id: "resp_1",
    object: "response",
    model: "perplexity/sonar",
    status: "completed",
    output: [
      {
        type: "search_results",
        queries: ["q"],
        results: urls.map((url, i) => ({ id: i + 1, url, title: "T", snippet: "" })),
      },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "An answer [1].", annotations: [] }],
      },
    ],
  },
];
// OpenAI's Responses API: the cited URLs are the message's url_citation annotations.
const oaiAnswer = (urls, text = "An answer.") => [
  200,
  {
    id: "resp_2",
    object: "response",
    model: "chat-latest-2026-11-01",
    status: "completed",
    output: [
      { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "q" } },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: urls.map(url => ({ type: "url_citation", start_index: 0, end_index: 3, url, title: "T" })),
          },
        ],
      },
    ],
  },
];
const runOf = {}; // question → how many times each engine was asked it so far
const nth = (engine, q) => {
  const k = `${engine}:${q}`;
  runOf[k] = (runOf[k] ?? -1) + 1;
  return runOf[k];
};
const PPLX = ({ body }) => {
  const k = nth("p", body.input) % 3;
  if (body.input === Q1)
    return pplxAnswer(
      [
        ["https://www.example.com/pricing", "https://rival.com/a"],
        ["https://example.com/pricing?ref=x", "https://example.com/pricing#top"],
        ["https://www.rival.com/", "https://other.net/"],
      ][k],
    );
  return pplxAnswer(["https://shop.example.com/x", "https://notexample.com/", "https://rival.com/b"]); // a subdomain isn't the site's host
};
const OAI = ({ body }) => {
  const k = nth("o", body.input);
  if (body.input === Q1)
    return oaiAnswer(
      ["https://www.example.com/?utm_source=openai", "https://www.example.com/?utm_source=openai"],
      "See https://rival.com for more.",
    ); // rival.com is in the text, not cited
  return oaiAnswer(k === 0 ? ["https://example.com/blog/cost"] : []);
};

test("counts the answers that cite the site (www or not) and each rival, with repeats, and the site's pages", async () => {
  for (const k of Object.keys(runOf)) delete runOf[k];
  const home = tmp(),
    srv = await fake({ "/pplx": PPLX, "/oai": OAI });
  try {
    const r = await ask(home, srv, BOTH, ["--rivals", "rival.com, https://www.other.net/, not a domain", "--yes"]);
    assert.equal(srv.hits.length, 12, "2 questions, asked 3 times each, by 2 engines");
    const p = srv.hits.find(h => h.seg === "/pplx"),
      o = srv.hits.find(h => h.seg === "/oai");
    assert.equal(p.verb, "POST");
    assert.equal(p.path, "/pplx/v1/agent");
    assert.equal(p.headers.authorization, "Bearer pplx-key-0001");
    assert.deepEqual(p.body, { model: "perplexity/sonar", input: Q1, tools: [{ type: "web_search" }] });
    assert.equal(o.path, "/oai/v1/responses");
    assert.equal(o.headers.authorization, "Bearer sk-key-0002");
    assert.deepEqual(o.body, {
      model: "chat-latest",
      input: Q1,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      store: false,
    });
    assert.ok(
      srv.hits.every(h => !/example\.com|rival|other\.net/.test(JSON.stringify(h.body))),
      "only the question goes, never the site or the rivals",
    );

    const out = output(home);
    assert.equal(out.source, "ai-answers");
    assert.equal(out.date, TODAY);
    assert.deepEqual(
      [out.site, out.host, out.rivals, out.questions, out.repeat],
      ["https://www.example.com/", "example.com", ["rival.com", "other.net"], [Q1, Q2], 3],
    );
    const { perplexity: pe, openai: oe } = out.engines;
    assert.deepEqual([pe.name, pe.model, pe.asked, pe.answers, pe.cited], ["Perplexity", "perplexity/sonar", 6, 6, 2]);
    assert.deepEqual(pe.rivals, { "rival.com": 5, "other.net": 1 });
    assert.deepEqual(pe.pages, { "/pricing": 2 }, "one answer citing a page twice counts once");
    assert.deepEqual(pe.neverCited, [Q2]);
    assert.deepEqual([oe.name, oe.model, oe.asked, oe.answers, oe.cited], ["OpenAI", "chat-latest", 6, 6, 4]);
    assert.deepEqual(
      oe.rivals,
      { "rival.com": 0, "other.net": 0 },
      "a URL in the text that isn't a citation doesn't count",
    );
    assert.deepEqual(oe.pages, { "/": 3, "/blog/cost": 1 });
    assert.deepEqual(oe.neverCited, []);
    assert.equal(out.answers.length, 12);
    assert.deepEqual(
      out.answers.find(a => a.engine === "openai" && a.question === Q1),
      {
        engine: "openai",
        question: Q1,
        run: 1,
        model: "chat-latest-2026-11-01",
        cited: ["https://www.example.com/?utm_source=openai"],
      },
    );
    assert.ok(
      out.notes.some(n => /not a domain/.test(n)),
      out.notes.join("\n"),
    );

    assert.match(
      r.stdout,
      new RegExp(
        `Perplexity: your site was cited in 2 of 6 answers \\(a sample: 2 questions, asked 3 times each, on ${TODAY}\\)`,
      ),
    );
    assert.match(r.stdout, /OpenAI: your site was cited in 4 of 6 answers/);
    assert.match(r.stdout, /rival\.com: cited in 5 of 6/);
    assert.match(r.stdout, /ChatGPT or Perplexity apps/);
    assert.match(r.stdout, /personal settings and location/);
    assert.match(r.stdout, /day to day/);
    assert.match(r.stdout, /not a ranking/);
    assert.doesNotMatch(r.stdout + r.stderr, /pplx-key-0001|sk-key-0002/);
    assert.doesNotMatch(r.stdout, /score|\/100|position|sentiment/i);
  } finally {
    await srv.close();
  }
});

test("without --yes it's a dry run: it shows each question, where it goes and how many requests, and sends nothing", async () => {
  const home = tmp(),
    srv = await fake({ "/pplx": PPLX, "/oai": OAI });
  try {
    const r = await ask(home, srv, { PERPLEXITY_API_KEY: "pplx-key-0001" });
    assert.equal(srv.hits.length, 0);
    assert.equal(existsSync(join(home, "ai.json")), false);
    assert.match(r.stdout, /dry run, nothing sent/);
    assert.match(r.stdout, /Perplexity: 6 requests to 127\.0\.0\.1/);
    assert.match(r.stdout, /perplexity\/sonar/);
    assert.match(r.stdout, /from PERPLEXITY_API_KEY/);
    assert.match(r.stdout, /OpenAI: no key set, so it's skipped[^\n]*connect-keys\.mjs guide openai/);
    assert.match(r.stdout, /6 requests in all/);
    assert.ok(r.stdout.includes(`1. ${Q1}`) && r.stdout.includes(`2. ${Q2}`), "every question, exactly as sent");
    assert.doesNotMatch(r.stdout, /# a comment/);
    assert.match(r.stdout, /Nothing about your site goes: not its address, its pages or the rivals' names/);
    assert.match(r.stdout, /--yes/);
    assert.doesNotMatch(r.stdout + r.stderr, /pplx-key-0001/);
    const both = await ask(home, srv, BOTH, ["--repeat", "2"]);
    assert.match(both.stdout, /Perplexity: 4 requests/);
    assert.match(both.stdout, /OpenAI: 4 requests to 127\.0\.0\.1[^\n]*chat-latest/);
    assert.match(both.stdout, /8 requests in all/);
    assert.equal(srv.hits.length, 0);
  } finally {
    await srv.close();
  }
});

test("a refused key, no credit or a rate limit: a plain message, the engine stops, the answers already collected are kept", async () => {
  const home = tmp(),
    srv = await fake({
      "/pplx": () => [401, { error: { message: "Invalid API key", type: "invalid_api_key", code: 401 } }],
      "/oai": (hit, n) =>
        n < 2
          ? oaiAnswer(["https://www.example.com/"])
          : [
              429,
              {
                error: {
                  message: "You have no credits.",
                  type: "insufficient_quota",
                  code: "credit_balance_exhausted",
                },
              },
            ],
    });
  try {
    await assert.rejects(ask(home, srv, BOTH, ["--yes"]), e => {
      assert.equal(e.code, 1);
      assert.match(e.stdout, /Perplexity didn't accept the key \(401\)[^\n]*node connect-keys\.mjs set perplexity/);
      assert.match(e.stdout, /OpenAI says the account can't pay for more requests[^\n]*credits/);
      assert.doesNotMatch(e.stdout + e.stderr, /pplx-key-0001|sk-key-0002/);
      return true;
    });
    assert.equal(srv.hits.filter(h => h.seg === "/pplx").length, 1, "a refused key stops that engine");
    assert.equal(srv.hits.filter(h => h.seg === "/oai").length, 3);
    const { engines, answers } = output(home);
    assert.deepEqual(
      [engines.perplexity.answers, engines.openai.answers, engines.openai.cited, answers.length],
      [0, 2, 2, 2],
    );
    assert.match(engines.perplexity.error, /didn't accept the key/);
    assert.match(engines.openai.error, /can't pay/);
  } finally {
    await srv.close();
  }

  const home2 = tmp(),
    srv2 = await fake({
      "/pplx": () => [402, { error: { message: "Payment required" } }],
      "/oai": () => [
        429,
        { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } },
        { "retry-after": "20" },
      ],
    });
  try {
    await assert.rejects(
      ask(home2, srv2, BOTH, ["--yes"]),
      e =>
        e.code === 1 &&
        /Perplexity says the account has no API credits left \(402\)/.test(e.stdout) &&
        /OpenAI says too many requests \(429\)[^\n]*Wait 20 seconds/.test(e.stdout),
    );
  } finally {
    await srv2.close();
  }
});

test("checks its input: at most 20 questions, --repeat from 1 to 10, known engines, and a key to use", async () => {
  const home = tmp(),
    env = envFor(home, null, BOTH),
    base = ["--site", SITE, "--out", join(home, "ai.json")];
  const many = questions(
    home,
    Array.from({ length: 21 }, (_, i) => `question ${i}`),
  );
  await assert.rejects(
    node([ANSWERS, ...base, "--questions", many], { env }),
    e => e.code === 2 && /21 questions/.test(e.stderr) && /20/.test(e.stderr) && /our own/.test(e.stderr),
  );
  const two = questions(home);
  await assert.rejects(
    node([ANSWERS, ...base, "--questions", two, "--repeat", "0"], { env }),
    e => e.code === 2 && /--repeat/.test(e.stderr),
  );
  await assert.rejects(
    node([ANSWERS, ...base, "--questions", two, "--engines", "gemini"], { env }),
    e => e.code === 2 && /perplexity or openai/.test(e.stderr),
  );
  await assert.rejects(
    node([ANSWERS, ...base, "--questions", join(home, "none.txt")], { env }),
    e => e.code === 2 && /can't read/.test(e.stderr),
  );
  await assert.rejects(
    node([ANSWERS, ...base, "--questions", two, "--engines", "openai", "--yes"], {
      env: envFor(home, null, { PERPLEXITY_API_KEY: "pplx-key-0001" }),
    }),
    e => e.code === 2 && /guide openai/.test(e.stderr),
  );
});

test("connect-keys knows Perplexity and OpenAI: set, status and guide, and fetch's dry run doesn't list them", async () => {
  const home = tmp(),
    srv = await fake({ "/pplx": PPLX, "/oai": OAI }),
    env = envFor(home, srv);
  try {
    await node([KEYS, "set", "perplexity", "pplx-saved-abcd1234"], { env });
    await node([KEYS, "set", "openai", "sk-saved-wxyz9876"], { env });
    const s = (await node([KEYS, "status"], { env })).stdout;
    assert.match(s, /Perplexity: set \(…1234/);
    assert.match(s, /OpenAI: set \(…9876/);
    assert.doesNotMatch(s, /pplx-saved-abcd1234|sk-saved-wxyz9876/);
    const pg = (await node([KEYS, "guide", "perplexity"], { env })).stdout;
    for (const re of [
      /console\.perplexity\.ai/,
      /Generate API Key/,
      /credits/,
      /node connect-keys\.mjs set perplexity(?! <)/,
      /your own terminal/,
      /ai-answers\.mjs/,
    ])
      assert.match(pg, re);
    const og = (await node([KEYS, "guide", "openai"], { env })).stdout;
    for (const re of [
      /platform\.openai\.com\/api-keys/,
      /billing/,
      /node connect-keys\.mjs set openai(?! <)/,
      /ai-answers\.mjs/,
    ])
      assert.match(og, re);
    const f = await node([KEYS, "fetch", "--site", SITE, "--out", join(home, "k.json")], { env });
    assert.doesNotMatch(f.stdout, /Perplexity|OpenAI/, "fetch doesn't use them");
    await ask(home, srv, {}, ["--engines", "perplexity", "--repeat", "1", "--yes"]);
    assert.ok(srv.hits.length === 2 && srv.hits.every(h => h.headers.authorization === "Bearer pplx-saved-abcd1234"));
  } finally {
    await srv.close();
  }
});

// ---------- the report ----------
const ORIGIN = "https://site.example";
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};
const base = {
  site: { name: "Site", url: ORIGIN },
  run: { date: "2026-11-22" },
  findings: [],
  passed: [{ rule: "LINK-02", title: "No orphan pages", category: "Internal linking" }],
};
const panel = s => s.match(/\n {4}<details class="how aianswers">[\s\S]*?<\/details>/)?.[0] ?? assert.fail("no panel");
const mdPart = s => s.match(/### AI answer check[\s\S]*?(?=\n#{2,3} |$)/)?.[0] ?? assert.fail("no Markdown section");
const aiAnswers = {
  source: "ai-answers",
  date: "2026-11-20",
  site: ORIGIN + "/",
  host: "site.example",
  rivals: ["rival.com", XSS],
  questions: [Q1, Q2, XSS],
  repeat: 3,
  engines: {
    perplexity: {
      name: "Perplexity",
      model: "perplexity/sonar",
      asked: 9,
      answers: 9,
      cited: 2,
      rivals: { "rival.com": 5, [XSS]: 1 },
      pages: { "/pricing": 2, [`/${XSS}`]: 1 },
      neverCited: [Q2, XSS],
    },
    openai: {
      name: "OpenAI",
      model: "chat-latest",
      asked: 9,
      answers: 4,
      cited: 0,
      rivals: { "rival.com": 1, [XSS]: 0 },
      pages: {},
      neverCited: [Q1],
      error: `OpenAI didn't accept the key (401) ${XSS}`,
    },
  },
  answers: [],
  notes: [],
};

test("the report's AI answer check: counts with the sample and date, rivals, pages, never-cited questions, escaped, and the score doesn't change", async () => {
  const on = await renderReport({ ...base, aiAnswers }),
    off = await renderReport(base);
  const tabOf = (h, id) =>
    h.slice(h.indexOf(`id="p-${id}"`), h.indexOf('<section class="tp"', h.indexOf(`id="p-${id}"`)));
  assert.ok(tabOf(on.html, "search-ai").includes(panel(on.html)), "on the Search & AI tab");
  for (const t of ["overview", "findings", "limits"])
    assert.equal(
      tabOf(on.html, t),
      tabOf(off.html, t),
      `only the panel changes: information only, never a finding or the score (${t})`,
    );
  const html = panel(on.html),
    md = mdPart(on.md);
  assert.match(html, /<summary>AI answer check<\/summary>/);
  assert.doesNotMatch(html, /<img src=x/, "escaped");
  assert.doesNotMatch(
    md.replace(/`[^`\n]*`/g, ""),
    /(^|[^\\])<img src=x/m,
    "escaped (a Markdown code span shows it as text)",
  );
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  for (const s of [html.replaceAll("&#39;", "'"), md.replace(/\\/g, "")]) {
    assert.match(
      s,
      /Perplexity[^\n]*cited in 2 of 9 answers \(a sample: 3 questions, asked 3 times each, on 2026-11-20\)/,
    );
    assert.match(s, /OpenAI[^\n]*cited in 0 of 4 answers/);
    assert.match(s, /rival\.com[^\n]*5 of 9/);
    assert.match(s, /\/pricing/);
    assert.match(s, new RegExp(Q2));
    assert.match(s, /stopped/);
    assert.match(s, /ChatGPT or Perplexity apps/);
    assert.match(s, /day to day/);
    assert.match(s, /not a ranking/);
    assert.match(s, /[Ii]nformation only/);
  }
  assert.doesNotMatch(html + md, /\/100|position|sentiment/i);
  const none = await renderReport({ ...base, aiAnswers: { engines: {} } });
  assert.doesNotMatch(none.html, /aianswers/, "nothing to show: no panel");
});
