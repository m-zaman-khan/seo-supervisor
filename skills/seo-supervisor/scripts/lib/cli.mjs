// @ts-check
// How a script stops. Exit codes unless its help says otherwise: 0 done, 1 the check found a problem or a service said
// no, 2 it couldn't run (bad input, a missing file, a bad settings folder).
import { basename } from "node:path";
import { proxyNote } from "./proxy.mjs";

/** Input the user can fix: the message is shown as it is, and the script exits with code (2 unless given). */
export class Fail extends Error {
  /** @param {string} msg @param {number} [code] */
  constructor(msg, code = 2) {
    super(msg);
    this.exitCode = code;
  }
}
/** A service said no (a refused key, a quota): shown on stdout after the script's name, and the script exits 1. */
export class Refused extends Error {}

const NAME = () => basename(process.argv[1] || "script", ".mjs");
// Why a named file can't be opened, in a few words.
const FILE = {
  ENOENT: "it isn't there",
  EISDIR: "it's a folder, not a file",
  ENOTDIR: "part of the path isn't a folder",
  EACCES: "permission denied",
  EPERM: "permission denied",
};

/** The proxy note, once, before a script's first request to another site. */
export function warnProxy() {
  const n = proxyNote();
  if (n) console.error("note: " + n);
}

/** Runs main (sync or async) and sets process.exitCode to what it returns, 0 when nothing. Fail, Refused, a file that
 * can't be opened and a bad settings folder (code SEO_SETTINGS) become one plain line; anything else is a bug and keeps
 * its stack trace. It never calls process.exit(): exiting while sockets close crashes Node on Windows.
 * @param {() => any} main */
export async function runMain(main) {
  try {
    process.exitCode = (await main()) ?? 0;
  } catch (e) {
    // By class name too, so scripts that define their own Fail and Refused classes are read the same way.
    const kind = e instanceof Refused ? "Refused" : e instanceof Fail ? "Fail" : e?.constructor?.name;
    if (kind === "Refused") {
      console.log(`${NAME()}: ${e.message}`);
      process.exitCode = 1;
    } else if (kind === "Fail" || e?.code === "SEO_SETTINGS") {
      (e.exitCode === 0 ? console.log : console.error)(e.message);
      process.exitCode = typeof e.exitCode === "number" ? e.exitCode : 2;
    } // exit 0: --help's usage
    else if (Object.hasOwn(FILE, e?.code) && e.path) {
      console.error(`${NAME()}: can't open ${e.path} (${FILE[e.code]}).`);
      process.exitCode = 2;
    } else throw e;
  }
}
