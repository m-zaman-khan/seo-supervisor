// @ts-check
// npm run test:slow: the fast suite plus its slow cases, still offline; not part of npm test or CI's fast job.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync("test")
  .filter(f => f.endsWith(".test.mjs"))
  .sort()
  .map(f => `test/${f}`);
const r = spawnSync(
  process.execPath,
  ["--import", "./test/offline.mjs", "--test", "--test-timeout=300000", "--test-force-exit", ...files],
  { stdio: "inherit", env: { ...process.env, SEO_TEST_SLOW: "1" } },
);
process.exitCode = r.status ?? 1;
