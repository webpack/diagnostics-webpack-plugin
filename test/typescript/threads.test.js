import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import typescript from "typescript";

import pack from "./utils/pack.js";

/**
 * @param {EXPECTED_ANY} options what to check the fixture with
 * @returns {Promise<string[]>} what it reported
 */
async function reported(options) {
  const stats = await pack("bad", options).runAsync();

  return stats.compilation.errors.map(({ message }) => message);
}

describe("threads", () => {
  it("should report the same from a worker as from webpack's own thread", async () => {
    const [onThread, threaded] = await Promise.all([
      reported({ threads: false }),
      reported({ threads: "auto" }),
    ]);

    // A `Diagnostic` holds its source file, so a worker describes and formats
    // what it found rather than sending it; the message has to be the same.
    assert.deepStrictEqual(threaded, onThread);
    assert.match(threaded[0], /TS2322/u);
  });

  it("should leave out what a worker's results are ignored by", async () => {
    const messages = await reported({
      threads: "auto",
      ignoreDiagnostics: 2322,
    });

    assert.deepStrictEqual(messages, []);
  });

  it("should print what a worker formatted one at a time as one report", () => {
    const fixture = join(import.meta.dirname, "fixtures", "bad");
    const program = typescript.createProgram(
      ["orphan.ts", "used.ts"].map((file) => join(fixture, file)),
      { strict: true, noEmit: true },
    );
    const diagnostics = typescript.sortAndDeduplicateDiagnostics(
      program.getSemanticDiagnostics(),
    );

    assert.ok(diagnostics.length > 1, "more than one to put back together");

    // Each block ends with the newline the host writes, which is what stands
    // between one and the next — on Windows that is two characters, so a report
    // rejoined with a newline of our own is right only on Unix.
    for (const newLine of ["\n", "\r\n"]) {
      const host = {
        getCanonicalFileName: (/** @type {string} */ file) => file,
        getCurrentDirectory: () => fixture,
        getNewLine: () => newLine,
      };
      const whole = typescript
        .formatDiagnosticsWithColorAndContext(diagnostics, host)
        .trim();
      const joined = [...diagnostics]
        .map((diagnostic) =>
          typescript.formatDiagnosticsWithColorAndContext([diagnostic], host),
        )
        .join("")
        .trim();

      assert.strictEqual(joined, whole);
    }
  });

  it("should run on webpack's own thread for a formatter written there", async () => {
    // A function cannot be handed to a worker, and this one is handed the
    // diagnostics themselves rather than what a worker would say of them.
    const messages = await reported({
      threads: "auto",
      formatter: (/** @type {EXPECTED_ANY[]} */ diagnostics) =>
        `codes ${diagnostics.map(({ code }) => code).join(",")}`,
    });

    assert.match(messages[0], /codes 2322,2322/u);
  });
});
