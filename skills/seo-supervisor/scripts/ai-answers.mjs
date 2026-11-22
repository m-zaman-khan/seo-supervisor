#!/usr/bin/env node
// @ts-check
// How often AI answer engines cite a site, or its rivals, when asked a list of questions.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { SERVICES, activeKeys, keyFile, call, Refused, domainOf } from "./connect-keys.mjs";

// Answers vary from run to run, so each question is asked several times.
const MAX_QUESTIONS = 20,
  MAX_REPEAT = 10,
  REPEAT = 3; // local caps, not provider limits
const ENGINES = {
  // Sonar is only reachable through the Agent API since Chat Completions support ended on 27 Sep 2026. Perplexity
  // names the search_results items the source of truth for citations. https://docs.perplexity.ai/docs/agent-api
  perplexity: {
    model: "perplexity/sonar",
    body: q => ({ model: "perplexity/sonar", input: q, tools: [{ type: "web_search" }] }),
    cited: b =>
      b.output
        .filter(o => o?.type === "search_results")
        .flatMap(o => (Array.isArray(o.results) ? o.results : []))
        .map(r => r?.url),
  },
  // chat-latest is ChatGPT's model. tool_choice "required" forces a search on every answer; store: false stops OpenAI
  // keeping the answer for 30 days. https://developers.openai.com/api/docs/guides/tools-web-search
  openai: {
    model: "chat-latest",
    body: q => ({
      model: "chat-latest",
      input: q,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      store: false,
    }),
    cited: b =>
      b.output
        .filter(o => o?.type === "message")
        .flatMap(o => (Array.isArray(o.content) ? o.content : []))
        .flatMap(c => (Array.isArray(c?.annotations) ? c.annotations : []))
        .filter(a => a?.type === "url_citation")
        .map(a => a.url),
  },
};
const IDS = Object.keys(ENGINES);
const CAVEAT =
  "These answers come from the providers' APIs. They can differ from what people see in the ChatGPT or Perplexity apps, which add personal settings and location. Answers also change from day to day. So this is a sample to compare over time, not a ranking.";
const USAGE =
  "usage: node ai-answers.mjs --site https://www.example.com --questions questions.txt [--rivals a.com,b.com] [--repeat 3] [--engines perplexity,openai] [--out seo-audit/ai-answers.json] [--yes]";
const fail = msg => {
  throw new Fail("ai-answers: " + msg);
};
const bare = h => h.toLowerCase().replace(/^www\./, "");
const hostOf = u => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? bare(x.hostname) : null;
  } catch {
    return null;
  }
};
const times = n => (n === 1 ? "once" : `${n} times`);
const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;
const sampleLine = (e, nQuestions, repeat, date) =>
  `cited in ${e.cited} of ${plural(e.answers, "answer")} (a sample: ${plural(nQuestions, "question")}, asked ${times(repeat)} each, on ${date})`;

// Engines run in parallel, each one request at a time. A refusal (bad key, no credit, rate limit) stops only that
// engine and keeps its answers so far. Only the question is sent; citations are matched to the site locally.
async function askAll({ questions, repeat, engines, keys, endpoints, log }) {
  const answers = [],
    errors = {},
    unread = {};
  await Promise.all(
    engines.map(async id => {
      const e = ENGINES[id],
        url = endpoints[id];
      try {
        for (const [i, question] of questions.entries()) {
          for (let run = 1; run <= repeat; run++) {
            const b = await call(id, url, {
              method: "POST",
              redirect: "manual",
              headers: { authorization: `Bearer ${keys[id].key}`, "content-type": "application/json" },
              body: JSON.stringify(e.body(question)),
            });
            if (!Array.isArray(b?.output) || b.status === "failed") {
              unread[id] = (unread[id] || 0) + 1;
              continue;
            }
            answers.push({
              engine: id,
              question,
              run,
              model: typeof b.model === "string" ? b.model : e.model,
              cited: [...new Set(e.cited(b).filter(u => typeof u === "string" && hostOf(u)))],
            });
          }
          log(`${SERVICES[id].name}: question ${i + 1} of ${questions.length} asked`);
        }
      } catch (err) {
        if (!(err instanceof Refused)) throw err;
        errors[id] = err.message;
      }
    }),
  );
  const order = a => [IDS.indexOf(a.engine), questions.indexOf(a.question), a.run];
  answers.sort((a, b) => {
    const x = order(a),
      y = order(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return { answers, errors, unread };
}

// An answer counts once per host or page, however many of its links point there.
function summarize({ answers, questions, repeat, host, rivals, engines, errors = {}, unread = {} }) {
  return Object.fromEntries(
    engines.map(id => {
      const mine = answers.filter(a => a.engine === id),
        cites = (a, h) => a.cited.some(u => hostOf(u) === h);
      const pages = {};
      for (const a of mine)
        for (const p of new Set(a.cited.filter(u => hostOf(u) === host).map(u => new URL(u).pathname)))
          pages[p] = (pages[p] || 0) + 1;
      const asked = q => mine.filter(a => a.question === q);
      return [
        id,
        {
          name: SERVICES[id].name,
          model: ENGINES[id].model,
          asked: questions.length * repeat,
          answers: mine.length,
          cited: mine.filter(a => cites(a, host)).length,
          rivals: Object.fromEntries(rivals.map(r => [r, mine.filter(a => cites(a, r)).length])),
          pages: Object.fromEntries(Object.entries(pages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
          neverCited: questions.filter(q => asked(q).length && !asked(q).some(a => cites(a, host))),
          ...(unread[id] && { unread: unread[id] }),
          ...(errors[id] && { error: errors[id] }),
        },
      ];
    }),
  );
}

// --competitors is the name rdap.mjs and connect-keys.mjs use for --rivals.
function main(argv) {
  const args = parseArgs(argv, {
    flags: ["site", "questions", "rivals", "repeat", "engines", "out"],
    booleans: ["yes"],
    aliases: { competitors: "rivals" },
    positionals: 0,
  });
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("site") || !str("questions")) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(str("site"));
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    fail(`--site must be the site's address, like https://www.example.com (got ${args.site})`);
  const siteUrl = new URL("/", site).href,
    host = bare(site.hostname);

  let text;
  try {
    text = readFileSync(str("questions"), "utf8");
  } catch (e) {
    fail(`can't read ${args.questions} (${e.code || e.message}).`);
  }
  const questions = text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"));
  if (!questions.length)
    fail(`${args.questions} has no questions. Write one question per line, the way your customers would ask it.`);
  if (questions.length > MAX_QUESTIONS)
    fail(
      `${args.questions} has ${questions.length} questions; the most is ${MAX_QUESTIONS} (our own cap, to keep the cost small). Keep the ones that matter most and run again.`,
    );
  const repeat = args.repeat === undefined ? REPEAT : Number(str("repeat"));
  if (!(Number.isInteger(repeat) && repeat >= 1 && repeat <= MAX_REPEAT))
    fail(`--repeat must be a whole number from 1 to ${MAX_REPEAT} (our own cap; got ${args.repeat}).`);
  const chosen = str("engines")
    ? [
        ...new Set(
          str("engines")
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : IDS;
  for (const id of chosen)
    if (!IDS.includes(id))
      fail(`there's no "${id}" engine. Use perplexity or openai, or both: --engines perplexity,openai`);

  const listed = (str("rivals") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const notes = listed
    .filter(r => !domainOf(r))
    .map(r => `Skipped rival "${r}": it's not a domain name like rival.com.`);
  const rivals = [...new Set(listed.map(domainOf).filter(d => d && d !== host))];
  const keys = activeKeys(),
    endpoints = Object.fromEntries(IDS.map(id => [id, process.env[SERVICES[id].endpointEnv] || SERVICES[id].endpoint]));
  const engines = chosen.filter(id => keys[id]);

  if (!args.yes) {
    const lines = chosen.map(id => {
      const s = SERVICES[id],
        k = keys[id],
        url = new URL(endpoints[id]);
      return k
        ? `  ${s.name}: ${questions.length * repeat} requests to ${url.host} (POST ${url.href}, the model ${ENGINES[id].model} with web search), with your key ${k.from === s.env ? `from ${s.env}` : `saved in ${keyFile()}`}`
        : `  ${s.name}: no key set, so it's skipped. To add it: node connect-keys.mjs guide ${id}`;
    });
    console.log(
      [
        `ai-answers: dry run, nothing sent. With --yes it would ask ${plural(questions.length, "question")}, ${times(repeat)} each, with your own keys:`,
        ...lines,
        `  ${questions.length * repeat * engines.length} requests in all. Each one sends one question and your key, with the model and web search settings above. Nothing about your site goes: not its address, its pages or the rivals' names. The answers are matched to them on this computer.`,
        "The questions, exactly as they would be sent:",
        ...questions.map((q, i) => `  ${i + 1}. ${q}`),
        ...notes,
        // Prices as of 22 Nov 2026: https://docs.perplexity.ai/docs/getting-started/pricing and
        // https://developers.openai.com/api/docs/pricing
        "Each provider bills its own account for every answer: the text it reads and writes, at the model's rates, plus a fee for each web search (one answer can search more than once). On 22 Nov 2026 their pricing pages listed $2.50 per 1,000 searches for Perplexity and $10 per 1,000 for OpenAI. See docs.perplexity.ai/docs/getting-started/pricing and developers.openai.com/api/docs/pricing.",
        "Your questions may name your brand, and they go to these providers at your cost, so re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  if (!engines.length)
    fail(
      `no key is set for ${chosen.map(id => SERVICES[id].name).join(" or ")}. To add one: ${chosen.map(id => `node connect-keys.mjs guide ${id}`).join(", or ")}`,
    );
  return run({
    siteUrl,
    host,
    questions,
    repeat,
    rivals,
    engines,
    keys,
    endpoints,
    notes,
    skipped: chosen.filter(id => !keys[id]),
    out: resolve(str("out") || "seo-audit/ai-answers.json"),
  });
}

async function run({ siteUrl, host, questions, repeat, rivals, engines, keys, endpoints, notes, skipped, out }) {
  const date = new Date().toISOString().slice(0, 10);
  const { answers, errors, unread } = await askAll({
    questions,
    repeat,
    engines,
    keys,
    endpoints,
    log: s => console.error("ai-answers: " + s),
  });
  for (const id of skipped)
    notes.push(`${SERVICES[id].name} wasn't asked: no key is set. To add it: node connect-keys.mjs guide ${id}`);
  for (const [id, n] of Object.entries(unread))
    notes.push(
      `${SERVICES[id].name}: ${plural(n, "answer")} failed or couldn't be read, so ${n === 1 ? "it's" : "they're"} left out.`,
    );
  const result = {
    source: "ai-answers",
    date,
    site: siteUrl,
    host,
    rivals,
    questions,
    repeat,
    engines: summarize({ answers, questions, repeat, host, rivals, engines, errors, unread }),
    answers,
    notes,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  for (const [id, e] of Object.entries(result.engines)) {
    if (e.error)
      console.log(
        `ai-answers: ${e.error}${e.answers ? ` The ${plural(e.answers, "answer")} ${SERVICES[id].name} gave before that ${e.answers === 1 ? "is" : "are"} kept.` : ""}`,
      );
    if (!e.answers) continue;
    console.log(`ai-answers: ${e.name}: your site was ${sampleLine(e, questions.length, repeat, date)}.`);
    for (const [r, n] of Object.entries(e.rivals))
      console.log(`  ${r}: cited in ${n} of ${plural(e.answers, "answer")}`);
    const pages = Object.entries(e.pages);
    if (pages.length)
      console.log(
        `  Your pages cited: ${pages
          .slice(0, 10)
          .map(([p, n]) => `${p} in ${plural(n, "answer")}`)
          .join(", ")}`,
      );
    if (e.neverCited.length)
      console.log(`  Questions whose answers never cited your site: ${e.neverCited.map(q => `"${q}"`).join(", ")}`);
  }
  for (const n of notes) console.log("ai-answers: " + n);
  console.log(`ai-answers: ${CAVEAT}\nai-answers: wrote ${out}`);
  return Object.keys(errors).length ? 1 : 0;
}

if (isMain(import.meta.url)) {
  warnProxy();
  await runMain(() => main(process.argv.slice(2)));
}
