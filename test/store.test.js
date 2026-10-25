import assert from "node:assert/strict";
import { describe, it } from "node:test";

import createCheckRunner from "../src/check.js";

const win32 = (/** @type {string} */ file) => `C:\\project\\${file}`;

/**
 * @param {string[]} dirty the files the check finds something in
 * @returns {EXPECTED_ANY} an adapter answering with the paths it was given
 */
function adapterFinding(dirty) {
  return {
    name: "fake",
    resultPath: (/** @type {EXPECTED_ANY} */ result) => result.filePath,
    create: async () => ({
      cleanup: async () => {},
      getFormatter: async () => (/** @type {EXPECTED_ANY[]} */ results) =>
        results.map((result) => result.filePath).join(","),
      getResults: async (/** @type {EXPECTED_ANY[]} */ raw) => raw,
      lintFiles: async (/** @type {string[]} */ files) =>
        files
          .filter((file) => dirty.includes(file))
          .map((file) => ({ filePath: file })),
      splitResults: (/** @type {EXPECTED_ANY[]} */ results) => ({
        errors: results,
        warnings: [],
      }),
    }),
  };
}

/**
 * @param {EXPECTED_ANY} adapter the check to run
 * @param {EXPECTED_ANY} compiler the compiler the store hangs off
 * @param {string} id which entry of the plugin's checks it is
 * @returns {EXPECTED_ANY} a runner over a fresh compilation of that compiler
 */
function runnerFor(adapter, compiler, id = "fake\u00000") {
  const compilation = { compiler, errors: [], warnings: [] };

  return createCheckRunner(
    "test",
    { adapter, id, name: "fake", options: {} },
    compilation,
  );
}

const reported = async (/** @type {EXPECTED_ANY} */ runner) => {
  const { errors } = await runner.report();

  return errors ? errors.message.replace("[fake] ", "").split(",") : [];
};

describe("store", () => {
  it("should keep a file webpack spells with backslashes", async () => {
    const compiler = { outputPath: "/out" };
    const adapter = adapterFinding([win32("a.css")]);
    const first = runnerFor(adapter, compiler);

    first.lint([win32("a.css"), win32("b.css")]);

    assert.deepStrictEqual(await reported(first), [win32("a.css")]);

    const second = runnerFor(adapterFinding([]), compiler);

    second.keep([win32("a.css"), win32("b.css")]);

    assert.deepStrictEqual(await reported(second), [win32("a.css")]);
  });

  it("should drop a file it is no longer handed", async () => {
    const compiler = { outputPath: "/out" };
    const dirty = [win32("a.css"), win32("b.css")];
    const first = runnerFor(adapterFinding(dirty), compiler);

    first.lint(dirty);

    assert.deepStrictEqual(await reported(first), dirty);

    const second = runnerFor(adapterFinding([]), compiler);

    // Nothing says a file was removed: what the walk no longer finds is gone.
    second.keep([win32("a.css")]);

    assert.deepStrictEqual(await reported(second), [win32("a.css")]);
  });

  it("should keep what one entry found out of what another reports", async () => {
    const compiler = { outputPath: "/out" };
    const first = runnerFor(
      adapterFinding(["/a.css"]),
      compiler,
      "fake\u00000",
    );

    first.lint(["/a.css"]);

    assert.deepStrictEqual(await reported(first), ["/a.css"]);

    // A second entry of the same check runs the same tool under options of its
    // own, so what the first one found is not its to report.
    const second = runnerFor(adapterFinding([]), compiler, "fake\u00001");

    second.keep(["/a.css"]);

    assert.deepStrictEqual(await reported(second), []);
  });
});
