import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../../src/index.js";

describe("Biome reading across files", () => {
  /** @type {import("webpack").Watching | undefined} */
  let watching;
  /** @type {string | undefined} */
  let context;

  afterEach(async () => {
    if (watching) {
      await new Promise((resolve) => {
        /** @type {import("webpack").Watching} */ (watching).close(resolve);
      });
    }

    watching = undefined;

    if (context) rmSync(context, { recursive: true, force: true });
  });

  /**
   * Builds a cycle, breaks it in the file the rest import, and hands over
   * what each build reported.
   * @param {object} options what the check is configured with
   * @param {(first: string, second: string) => void} check what to say of them
   * @param {() => void} done done
   */
  const breakCycle = (options, check, done) => {
    // Under the fixtures, so that its TypeScript is this package's; `.mjs`,
    // the fixtures being CommonJS.
    context = mkdtempSync(join(import.meta.dirname, "fixtures", "across-"));

    const files = {
      "biome.json": JSON.stringify({
        linter: {
          rules: {
            recommended: false,
            suspicious: { noImportCycles: "error" },
          },
        },
      }),
      "index.mjs": 'import { a } from "./a.mjs";\nconsole.log(a);\n',
      "a.mjs": 'import { b } from "./b.mjs";\nexport const a = () => b;\n',
      "b.mjs": 'import { a } from "./a.mjs";\nexport const b = () => a;\n',
    };
    const past = new Date(Date.now() - 60_000);

    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(context, name), text);
      utimesSync(join(context, name), past, past);
    }

    const compiler = webpack({
      context,
      entry: "./index.mjs",
      mode: "development",
      output: { path: join(import.meta.dirname, "outputs") },
      plugins: [
        new DiagnosticsPlugin({ checks: [{ use: "biome", ...options }] }),
      ],
    });
    /** @type {string | undefined} */
    let first;

    watching = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      const text = stats.compilation.errors
        .map((error) => error.message)
        .join("\n");

      if (first === undefined) {
        first = text;
        writeFileSync(
          join(/** @type {string} */ (context), "b.mjs"),
          "export const b = () => 1;\n",
        );

        return;
      }

      check(first, text);
      done();
    });
  };

  it("should stop reporting a cycle that a file it imports breaks", (t, done) => {
    breakCycle(
      {},
      (first, second) => {
        assert.match(first, /a\.mjs[^\n]*noImportCycles/u);
        // `a.mjs` did not change, and was linted again because what it
        // imports did: what it said of the cycle is no longer true.
        assert.doesNotMatch(second, /noImportCycles/u);
      },
      done,
    );
  });

  it("should keep what it said of a file that did not change when told it reads none", (t, done) => {
    breakCycle(
      { readsAcrossFiles: false },
      (first, second) => {
        assert.match(first, /a\.mjs[^\n]*noImportCycles/u);
        assert.match(second, /a\.mjs[^\n]*noImportCycles/u);
      },
      done,
    );
  });
});
