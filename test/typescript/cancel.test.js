import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { countThreads } from "../../src/threads.js";

import pack from "./utils/pack.js";

const typescriptPath = join(import.meta.dirname, "mock/typescript-stall");

const fixture = join(import.meta.dirname, "fixtures", "cancel");
const checked = join(fixture, "checked.ts");
const configFile = join(fixture, "tsconfig.json");
const trigger = join(fixture, "trigger.js");

describe("cancel", () => {
  let watch;
  let outcome;

  afterEach(() => {
    if (watch) watch.close();

    rmSync(checked, { force: true });
    rmSync(configFile, { force: true });
    rmSync(trigger, { force: true });
    rmSync(outcome, { force: true });
  });

  // The check only runs on a worker of its own where there are threads to
  // spare, and only there can a run be stopped while it goes on.
  it(
    "should stop a run nobody waits for once the next build starts",
    { skip: countThreads("auto") < 2 },
    (t, done) => {
      outcome = join(
        mkdtempSync(join(tmpdir(), "typescript-stall-")),
        "outcome",
      );
      // Read by the stalling TypeScript, on the worker the check runs on.
      process.env.TYPESCRIPT_STALL_OUTCOME = outcome;

      writeFileSync(
        configFile,
        `${JSON.stringify({
          compilerOptions: { strict: true, skipLibCheck: true },
          include: ["*.ts"],
        })}\n`,
      );
      writeFileSync(trigger, "export const trigger = 1;\n");
      writeFileSync(checked, "export const fine = 1;\n");

      /** @type {string[]} */
      const logged = [];
      const quiet = () => {};
      const started = Date.now();
      let step = 0;

      const compiler = pack(
        "cancel",
        // Logged rather than reported, which is what leaves a run to finish
        // after the build it was started for.
        { threads: "auto", typescriptPath, reportAs: "log" },
        {
          infrastructureLogging: {
            level: "error",
            console: {
              error: (/** @type {string} */ message) => {
                logged.push(message);

                if (!/TS2322/u.test(message)) return;

                assert.strictEqual(readFileSync(outcome, "utf8"), "cancelled");
                // What the stale run found is never printed.
                assert.strictEqual(logged.length, 1);
                assert.ok(Date.now() - started < 30000);
                done();
              },
              warn: quiet,
              info: quiet,
              log: quiet,
              debug: quiet,
              trace: quiet,
              group: quiet,
              groupEnd: quiet,
              groupCollapsed: quiet,
              status: quiet,
              clear: quiet,
              profile: quiet,
              profileEnd: quiet,
            },
          },
        },
      );

      watch = compiler.watch({}, (err, stats) => {
        assert.strictEqual(err, null);

        const changed = [...(stats.compilation.compiler.modifiedFiles || [])];

        if (step === 0) {
          // A rebuild webpack starts for what was written before it watched.
          if (changed.length > 0) return;

          step = 1;
          // The run this build leaves behind stalls until it is cancelled.
          writeFileSync(checked, "// stall\nexport const fine = 2;\n");

          return;
        }

        if (step === 1) {
          // Webpack names the folder that holds it too.
          const others = changed.filter((file) => file !== fixture);

          if (others.length !== 1 || others[0] !== checked) {
            // A rebuild for what was written before the watch, late: the
            // edit is made again so that a run is left with it.
            writeFileSync(
              checked,
              `// stall\nexport const fine = ${Date.now()};\n`,
            );

            return;
          }

          step = 2;

          // The worker reads the file when its run gets to it, so the next
          // edit waits until that run is stuck on this one.
          const stuck = setInterval(() => {
            if (!existsSync(outcome)) return;

            clearInterval(stuck);
            // A rebuild webpack starts late on its own, as it can on Windows,
            // has stopped the run by now as well: either way it is stuck on
            // this file or was stopped while it was.
            assert.match(
              readFileSync(outcome, "utf8"),
              /^(stalling|cancelled)$/u,
            );
            writeFileSync(checked, "export const wrong: string = 42;\n");
          }, 10);
        }
      });
    },
  );
});
