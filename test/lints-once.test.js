// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import eslint from "../src/checks/eslint.js";
import DiagnosticsPlugin from "../src/index.js";
import { countThreads } from "../src/threads.js";

const require = createRequire(import.meta.url);
// This package's own ESLint, which threads a lint itself.
const eslintPath = join(require.resolve("eslint/package.json"), "..");
const recorderPath = join(import.meta.dirname, "mock/eslint-recorder");

describe("linting once", () => {
  describe("ESLint", () => {
    const lintsOnce = (
      /** @type {{ threads?: boolean, concurrency?: string | number, configType?: string, eslintPath?: string }} */ options,
    ) =>
      /** @type {(options: EXPECTED_ANY) => boolean} */ (eslint.lintsOnce)({
        configType: "flat",
        eslintPath,
        ...options,
      });

    it("should be handed every file at once where it threads the lint itself", () => {
      assert.strictEqual(lintsOnce({}), countThreads(undefined) > 1);
    });

    it("should be handed batches where it runs on one thread", () => {
      assert.strictEqual(lintsOnce({ threads: false }), false);
      assert.strictEqual(lintsOnce({ concurrency: "off" }), false);
    });

    it("should take a concurrency written against ESLint over threads", () => {
      assert.strictEqual(lintsOnce({ threads: false, concurrency: 2 }), true);
    });

    it("should be handed batches where our own pool threads it", () => {
      assert.strictEqual(lintsOnce({ configType: "eslintrc" }), false);
      // An ESLint whose version cannot be read is taken as one too old to
      // thread itself.
      assert.strictEqual(lintsOnce({ eslintPath: recorderPath }), false);
    });
  });

  describe("a check that lints once", () => {
    /** @type {string | undefined} */
    let project;

    afterEach(() => {
      if (project) rmSync(project, { recursive: true, force: true });

      project = undefined;
    });

    it("should be handed every file in one run, however many webpack builds first", async () => {
      // Enough that webpack would hand them over in batches as it builds.
      const count = 400;

      project = mkdtempSync(join(import.meta.dirname, "fixtures", "once-"));

      for (let i = 0; i < count; i += 1) {
        writeFileSync(join(project, `m${i}.js`), `module.exports = ${i};\n`);
      }

      writeFileSync(
        join(project, "entry.js"),
        Array.from({ length: count }, (_, i) => `require("./m${i}.js");`).join(
          "\n",
        ),
      );

      /** @type {string[][]} */
      const runs = [];
      const compiler = webpack({
        context: project,
        entry: "./entry.js",
        mode: "development",
        output: { path: join(project, "dist") },
        plugins: [
          new DiagnosticsPlugin({
            checks: [
              {
                use: {
                  name: "once",
                  lintsOnce: () => true,
                  resultPath: (/** @type {{ file: string }} */ result) =>
                    result.file,
                  create: async () => ({
                    lintFiles: async (/** @type {string[]} */ files) => {
                      runs.push(files);

                      return [];
                    },
                    getResults: async (/** @type {unknown[]} */ results) =>
                      results,
                    splitResults: () => ({ errors: [], warnings: [] }),
                    getFormatter: async () => async () => "",
                    cleanup: async () => {},
                  }),
                },
              },
            ],
          }),
        ],
      });

      await new Promise((resolve, reject) => {
        compiler.run((err) => (err ? reject(err) : resolve(undefined)));
      });
      await new Promise((resolve) => {
        compiler.close(resolve);
      });

      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0].length, count + 1);
    });
  });
});
