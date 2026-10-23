import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import webpack from "webpack";

import { countThreads } from "../../src/threads.js";

import conf from "./utils/conf.js";

const typescriptPath = join(import.meta.dirname, "mock/typescript-counter");

describe("share", () => {
  // Only a worker outlives the compilation that started it, which is what a
  // second compiler can find the program on.
  it(
    "should build one program for the compilers checking the same project",
    { skip: countThreads("auto") < 2 },
    (t, done) => {
      const counter = join(
        mkdtempSync(join(tmpdir(), "typescript-counter-")),
        "programs",
      );

      // Read by the counting TypeScript, on the worker the check runs on.
      process.env.TYPESCRIPT_COUNTER_FILE = counter;

      const configs = ["one", "two"].map((name) => {
        const config = conf("good", { threads: "auto", typescriptPath });

        return {
          ...config,
          name,
          output: { path: join(config.output.path, name) },
        };
      });

      // One after the other, so that the second does not join the first's run.
      configs.parallelism = 1;

      const watch = webpack(configs).watch({}, (err) => {
        assert.strictEqual(err, null);

        watch.close(() => {
          assert.deepStrictEqual(
            readFileSync(counter, "utf8").trim().split("\n"),
            ["fresh", "reused"],
          );
          done();
        });
      });
    },
  );
});
