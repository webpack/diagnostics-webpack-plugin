import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import webpack from "webpack";

import DiagnosticsPlugin from "../src/index.js";

const directory = join(import.meta.dirname, "fixtures", "advisory");
const entry = join(directory, "entry.js");
const read = join(directory, "read.txt");

/**
 * A check the test decides the moment of, so that what a build waited for is
 * an ordering rather than a duration.
 * @param {(release: () => void) => void} hold called with the end of each run
 * @returns {EXPECTED_ANY} the adapter to run
 */
function gated(hold) {
  return {
    name: "gated",
    filesSource: "glob",
    resultPath: (/** @type {EXPECTED_ANY} */ result) => result.filePath,
    create: async () => ({
      cleanup: async () => {},
      getFormatter: async () => async (/** @type {EXPECTED_ANY[]} */ results) =>
        results.map((result) => result.filePath).join(","),
      getResults: async (/** @type {EXPECTED_ANY[]} */ raw) => raw,
      lintFiles: (/** @type {string[]} */ files) =>
        new Promise((resolve) => {
          hold(() => resolve(files.map((filePath) => ({ filePath }))));
        }),
      splitResults: (/** @type {EXPECTED_ANY[]} */ results) => ({
        errors: results,
        warnings: [],
      }),
    }),
  };
}

/**
 * @param {EXPECTED_ANY} check the options of the check to run
 * @param {string[]} logs where the terminal output is collected
 * @returns {EXPECTED_ANY} a compiler over the fixtures this file writes
 */
function compilerFor(check, logs) {
  return webpack({
    entry: "./entry.js",
    context: directory,
    mode: "development",
    output: { path: join(import.meta.dirname, "outputs") },
    infrastructureLogging: {
      console: {
        ...console,
        error: (/** @type {EXPECTED_ANY[]} */ ...args) =>
          logs.push(args.join(" ")),
        warn: (/** @type {EXPECTED_ANY[]} */ ...args) =>
          logs.push(args.join(" ")),
      },
    },
    plugins: [
      new DiagnosticsPlugin({
        checks: [{ files: directory, extensions: ["js", "txt"], ...check }],
      }),
    ],
  });
}

/**
 * @param {() => boolean} arrived what the test is waiting for
 * @returns {Promise<void>} resolved once it has
 */
async function waitFor(arrived) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (arrived()) return;

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("the check never reported");
}

describe("advisory", () => {
  let watching;

  afterEach(() => {
    if (watching) watching.close();
    rmSync(directory, { force: true, recursive: true });
  });

  const write = (/** @type {string} */ contents) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(entry, contents);
    writeFileSync(read, "read\n");
  };

  it("should not hold a rebuild for a check the build carries nothing of", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    /** @type {(() => void)[]} */
    const gates = [];
    let pass = 0;

    const compiler = compilerFor(
      {
        use: gated((end) => {
          gates.push(end);

          // The first build is what tells the watcher which files the check
          // reads, so it is the one build that waits for it.
          if (gates.length === 1) end();
        }),
        reportAs: "log",
      },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      (async () => {
        pass += 1;

        assert.strictEqual(err, null);
        assert.strictEqual(stats.hasErrors(), false);

        if (pass === 1) {
          assert.strictEqual(gates.length, 1);
          writeFileSync(entry, "console.log('two');\n");

          return;
        }

        // The rebuild is over with the check of it still running: had the
        // build waited for the second run, nothing would release it.
        assert.deepStrictEqual(logs, []);

        await waitFor(() => gates.length === 2);

        gates[1]();

        await waitFor(() => logs.length > 0);

        assert.match(logs.join("\n"), /\[gated\]/u);
        assert.match(logs.join("\n"), /entry\.js/u);
      })().then(() => {
        if (pass > 1) done();
      }, done);
    });
  });

  it("should hold a rebuild for a check the build carries the results of", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    let released = false;
    let pass = 0;

    const compiler = compilerFor(
      {
        use: gated((end) => {
          setTimeout(() => {
            released = true;
            end();
          }, 20);
        }),
      },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      try {
        pass += 1;

        assert.strictEqual(err, null);
        assert.strictEqual(released, true);
        assert.strictEqual(stats.hasErrors(), true);

        if (pass === 1) {
          released = false;
          writeFileSync(entry, "console.log('two');\n");

          return;
        }

        done();
      } catch (err_) {
        done(err_);
      }
    });
  });

  it("should print what an advisory check fails with rather than lose it", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    let runs = 0;
    let pass = 0;

    const compiler = compilerFor(
      {
        use: {
          name: "failing",
          filesSource: "glob",
          resultPath: (/** @type {EXPECTED_ANY} */ result) => result.filePath,
          create: async () => ({
            cleanup: async () => {},
            getFormatter: async () => async () => "",
            getResults: async (/** @type {EXPECTED_ANY[]} */ raw) => raw,
            lintFiles: async () => {
              runs += 1;

              if (runs > 1) throw new Error("the check broke");

              return [];
            },
            splitResults: () => ({ errors: [], warnings: [] }),
          }),
        },
        reportAs: "log",
      },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      (async () => {
        pass += 1;

        assert.strictEqual(err, null);

        // The build carries nothing of the check, a failure of it included, so
        // the terminal is the only place left to say so.
        assert.strictEqual(stats.hasErrors(), false);

        if (pass === 1) {
          writeFileSync(entry, "console.log('two');\n");

          return;
        }

        await waitFor(() => logs.length > 0);

        assert.match(logs.join("\n"), /the check broke/u);
      })().then(() => {
        if (pass > 1) done();
      }, done);
    });
  });

  it("should print what reporting an advisory check fails with", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    let runs = 0;
    let pass = 0;

    const compiler = compilerFor(
      {
        use: {
          name: "broken-report",
          filesSource: "glob",
          resultPath: (/** @type {EXPECTED_ANY} */ result) => result.filePath,
          create: async () => ({
            cleanup: async () => {},
            getFormatter: async () => async () => "",
            getResults: async (/** @type {EXPECTED_ANY[]} */ raw) => {
              runs += 1;

              if (runs > 1) throw new Error("the results broke");

              return raw;
            },
            lintFiles: async (/** @type {string[]} */ files) =>
              files.map((filePath) => ({ filePath })),
            splitResults: (/** @type {EXPECTED_ANY[]} */ results) => ({
              errors: results,
              warnings: [],
            }),
          }),
        },
        reportAs: "log",
      },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      (async () => {
        pass += 1;

        assert.strictEqual(err, null);
        assert.strictEqual(stats.hasErrors(), false);

        if (pass === 1) {
          writeFileSync(entry, "console.log('two');\n");

          return;
        }

        await waitFor(() => logs.length > 0);

        assert.match(logs.join("\n"), /the results broke/u);
      })().then(() => {
        if (pass > 1) done();
      }, done);
    });
  });

  it("should drop what a rebuild has already checked again", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    /** @type {(() => void)[]} */
    const gates = [];
    let pass = 0;

    const compiler = compilerFor(
      {
        use: gated((end) => {
          gates.push(end);

          if (gates.length === 1) end();
        }),
        reportAs: "log",
      },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      (async () => {
        pass += 1;

        assert.strictEqual(err, null);
        assert.strictEqual(stats.hasErrors(), false);

        if (pass < 3) {
          writeFileSync(entry, `console.log('${pass}');\n`);

          return;
        }

        // The second build's check lands with a third build already done, so
        // what it found is of files that have been checked again since.
        gates[1]();

        await waitFor(() => gates.length === 3);

        assert.deepStrictEqual(logs, []);

        gates[2]();

        await waitFor(() => logs.length > 0);
      })().then(() => {
        if (pass > 2) done();
      }, done);
    });
  });

  it("should watch what an advisory check reads and webpack does not", (t, done) => {
    write("console.log('one');\n");

    /** @type {string[]} */
    const logs = [];
    let pass = 0;

    const compiler = compilerFor(
      { use: gated((end) => end()), reportAs: "log" },
      logs,
    );

    watching = compiler.watch({}, (err, stats) => {
      try {
        pass += 1;

        assert.strictEqual(err, null);
        assert.strictEqual(stats.hasErrors(), false);

        // The second build is the first the check is left to finish after, so
        // the files it reads are the ones the build before it reported.
        if (pass === 1) {
          writeFileSync(entry, "console.log('two');\n");

          return;
        }

        // Nothing webpack built changed here: the rebuild is the watcher
        // answering for a file only the check reads.
        if (pass === 2) {
          writeFileSync(read, "changed\n");

          return;
        }

        assert.ok(
          [...stats.compilation.fileDependencies].includes(read),
          "the file the check alone reads is watched",
        );
        done();
      } catch (err_) {
        done(err_);
      }
    });
  });
});
