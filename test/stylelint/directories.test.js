import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const fixture = join(import.meta.dirname, "fixtures", "unbuilt");
const output = join(fixture, "dist");
const dependencies = join(fixture, "node_modules");

const watched = async (/** @type {EXPECTED_ANY} */ webpackConf) => {
  const compiler = pack("unbuilt", {}, webpackConf);
  const stats = await compiler.runAsync();

  return [...stats.compilation.contextDependencies];
};

describe("directories", () => {
  afterEach(() => {
    rmSync(output, { force: true, recursive: true });
    rmSync(dependencies, { force: true, recursive: true });
  });

  it("should watch the folder a check takes its files from", async () => {
    assert.ok((await watched({})).includes(fixture));
  });

  it("should not watch a folder holding what the build writes", async () => {
    // Webpack rebuilds on a change anywhere under a folder it watches, and the
    // output of one build lands under this one.
    assert.ok(!(await watched({ output: { path: output } })).includes(fixture));
  });

  it("should not watch a folder that is not there", async () => {
    const compiler = pack("unbuilt", { files: "gone/**/*.css" });
    const stats = await compiler.runAsync();

    assert.deepStrictEqual([...stats.compilation.contextDependencies], []);
  });

  it("should not watch a folder holding what the check leaves out", async () => {
    mkdirSync(dependencies, { recursive: true });
    writeFileSync(join(dependencies, "vendor.css"), "a {}\n");

    assert.ok(!(await watched({})).includes(fixture));
  });
});
