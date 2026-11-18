import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SKILL = join(ROOT, "skills", "seo-supervisor");
export const SCRIPTS = join(SKILL, "scripts");
export const tmp = () => mkdtempSync(join(tmpdir(), "seo-supervisor-test-"));

// Async on purpose: the fixture server runs in this process, so a sync child would deadlock it.
const run = promisify(execFile);
export const node = (args, opts = {}) => run(process.execPath, args, { maxBuffer: 32 * 1024 * 1024, ...opts });
