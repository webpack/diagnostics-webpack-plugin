import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import { readsAcrossFiles } from "../../src/checks/oxlint.js";
import DiagnosticsPlugin from "../../src/index.js";

describe("oxlint reading across files", () => {
  /** @type {string[]} */
  const made = [];

  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * @param {Record<string, string>} files what the project holds
   * @param {string=} under where to make it
   * @returns {string} where it is
   */
  const project = (files, under = tmpdir()) => {
    const dir = mkdtempSync(join(under, "oxlint-across-"));

    made.push(dir);

    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }

    return dir;
  };

  /**
   * @param {Record<string, string>} files what the project holds
   * @param {object=} options what the check is configured with
   * @returns {boolean} what the check says
   */
  const reads = (files, options = {}) =>
    readsAcrossFiles({}, { context: project(files), ...options });

  describe("read from its configuration", () => {
    it("should not where nothing reads another file", () => {
      assert.strictEqual(reads({}), false);
      assert.strictEqual(
        reads({ ".oxlintrc.json": '{ "rules": { "no-debugger": "error" } }' }),
        false,
      );
    });

    it("should where a flag turns on type-aware rules or the import plugin", () => {
      for (const flag of ["--type-aware", "--type-check", "--import-plugin"]) {
        assert.strictEqual(reads({}, { args: [flag] }), true, flag);
      }
    });

    it("should where the config turns them on", () => {
      for (const config of [
        '{ "plugins": ["import"] }',
        '{ "options": { "typeAware": true } }',
        '{ "options": { "typeCheck": true } }',
        '{ "overrides": [{ "files": ["*.ts"], "plugins": ["import"] }] }',
      ]) {
        assert.strictEqual(reads({ ".oxlintrc.json": config }), true, config);
      }
    });

    it("should read a config written with comments", () => {
      const config = `{
        // cycles
        "plugins": ["import",], /* and more */ "ignorePatterns": ["src/**"]
      }`;

      assert.strictEqual(reads({ ".oxlintrc.jsonc": config }), true);
    });

    it("should read the config the options name", () => {
      const files = {
        ".oxlintrc.json": "{}",
        "strict.json": '{ "plugins": ["import"] }',
      };

      assert.strictEqual(reads(files, { configFile: "strict.json" }), true);
      assert.strictEqual(reads(files, { args: ["-c", "strict.json"] }), true);
      assert.strictEqual(
        reads(files, { args: ["--config=strict.json"] }),
        true,
      );
    });

    it("should where the config cannot be read for the answer", () => {
      assert.strictEqual(
        reads({ ".oxlintrc.json": '{ "extends": ["./base.json"] }' }),
        true,
      );
      assert.strictEqual(reads({ ".oxlintrc.json": "{ not json" }), true);
    });

    it("should answer once for the options it is asked of", () => {
      const options = { context: project({}) };

      assert.strictEqual(readsAcrossFiles({}, options), false);
      writeFileSync(
        join(/** @type {string} */ (options.context), ".oxlintrc.json"),
        '{ "plugins": ["import"] }',
      );
      assert.strictEqual(readsAcrossFiles({}, options), false);
    });
  });

  describe("watching", () => {
    /** @type {import("webpack").Watching | undefined} */
    let watching;

    afterEach(async () => {
      if (watching) {
        await new Promise((resolve) => {
          /** @type {import("webpack").Watching} */ (watching).close(resolve);
        });
      }

      watching = undefined;
    });

    it("should stop reporting a cycle that a file it imports breaks", (t, done) => {
      // Under the fixtures, so that its TypeScript is this package's.
      const context = project(
        {
          ".oxlintrc.json":
            '{ "plugins": ["import"], "rules": { "import/no-cycle": "error" } }',
          // `.mjs`, the fixtures being CommonJS.
          "index.mjs": 'import { a } from "./a.mjs";\nconsole.log(a);\n',
          "a.mjs": 'import { b } from "./b.mjs";\nexport const a = () => b;\n',
          "b.mjs": 'import { a } from "./a.mjs";\nexport const b = () => a;\n',
        },
        join(import.meta.dirname, "fixtures"),
      );
      const past = new Date(Date.now() - 60_000);

      for (const name of ["index.mjs", "a.mjs", "b.mjs"]) {
        utimesSync(join(context, name), past, past);
      }

      const compiler = webpack({
        context,
        entry: "./index.mjs",
        mode: "development",
        output: { path: join(import.meta.dirname, "outputs") },
        plugins: [new DiagnosticsPlugin({ checks: ["oxlint"] })],
      });
      let first = true;

      watching = compiler.watch({}, (err, stats) => {
        assert.strictEqual(err, null);

        const text = stats.compilation.errors
          .map((error) => error.message)
          .join("\n");

        if (first) {
          first = false;
          assert.match(text, /a\.mjs[^\n]*no-cycle/u);
          writeFileSync(join(context, "b.mjs"), "export const b = () => 1;\n");

          return;
        }

        // `a.mjs` did not change, and was linted again because what it imports
        // did: what it said of the cycle is no longer true.
        assert.doesNotMatch(text, /no-cycle/u);
        done();
      });
    });
  });
});
