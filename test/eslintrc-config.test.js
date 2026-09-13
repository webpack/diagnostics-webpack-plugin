import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import workerThreads from "node:worker_threads";

import { ESLint } from "eslint";

import pack from "./utils/pack.js";

const fixtures = join(import.meta.dirname, "fixtures");
// More than a pool is started for, so that this drives the pool rather than
// the batch too small to be worth one.
const pooled = 70;
const modules = Array.from(
  { length: pooled },
  (_, index) => `eslintrc-pooled-${index}.js`,
);

(ESLint && Number.parseFloat(ESLint.version) >= 10 ? describe.skip : describe)(
  "succeed on eslintrc-configuration",
  () => {
    it("should work with eslintrc configuration type", async () => {
      const overrideConfigFile = join(
        import.meta.dirname,
        "fixtures",
        "eslintrc-config.js",
      );
      const compiler = pack("full-of-problems", {
        configType: "eslintrc",
        overrideConfigFile,
      });

      const stats = await compiler.runAsync();
      const { errors } = stats.compilation;

      assert.strictEqual(stats.hasErrors(), true);
      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].message.includes("full-of-problems.js"));
      assert.strictEqual(stats.hasWarnings(), true);
    });

    describe("over a pool", () => {
      let workerCount;
      let originalWorker;

      before(() => {
        workerCount = 0;
        originalWorker = workerThreads.Worker;
        workerThreads.Worker = class TrackedWorker extends originalWorker {
          constructor(...args) {
            super(...args);
            workerCount += 1;
          }
        };

        for (const name of modules) {
          writeFileSync(join(fixtures, name), '"use strict";\n');
        }

        writeFileSync(
          join(fixtures, "eslintrc-pooled-entry.js"),
          `${modules.map((name) => `require("./${name}");`).join("\n")}\n`,
        );
      });

      after(() => {
        workerThreads.Worker = originalWorker;

        for (const name of [...modules, "eslintrc-pooled-entry.js"]) {
          rmSync(join(fixtures, name), { force: true });
        }
      });

      it("should load eslint the same way in a worker", async () => {
        const stats = await pack("eslintrc-pooled", {
          configType: "eslintrc",
          overrideConfigFile: join(fixtures, "eslintrc-config.js"),
          threads: 2,
        }).runAsync();

        assert.strictEqual(stats.hasErrors(), true);

        const [{ message }] = stats.compilation.errors;

        // The rule is one only the eslintrc file turns on, so the worker read
        // the same configuration the build did.
        assert.match(message, /eslintrc-pooled-\d+\.js/u);
        assert.match(message, /strict/u);
        assert.ok(workerCount >= 2, `${workerCount} workers were started`);
      });
    });
  },
);
