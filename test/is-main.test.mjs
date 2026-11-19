import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

// A junction needs no admin rights on Windows; elsewhere the type is ignored and it's a plain directory symlink.
test("the CLIs run when started through a symlinked or junctioned scripts folder", async () => {
  const link = join(tmp(), "scripts");
  symlinkSync(SCRIPTS, link, "junction");
  for (const script of ["gsc-import.mjs", "google.mjs", "connect-keys.mjs"]) {
    await assert.rejects(
      node([join(link, script)]),
      e => {
        assert.equal(e.code, 2, script);
        assert.match(e.stderr, /usage/i, script);
        return true;
      },
      script,
    );
  }
});
