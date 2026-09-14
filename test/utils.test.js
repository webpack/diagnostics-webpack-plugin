import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  arrify,
  parseFiles,
  parseFoldersToGlobs,
  toPosixPath,
} from "../src/utils.js";

// `parseFoldersToGlobs` stats what it is given, so the fixtures have to exist.
const directory = join(import.meta.dirname, "fixtures");
const file = join(import.meta.dirname, "fixtures", "good.js");

describe("utils", () => {
  it("arrify should answer with an array for whatever it is given", () => {
    assert.deepStrictEqual(arrify(undefined), []);
    assert.deepStrictEqual(arrify(null), []);
    assert.deepStrictEqual(arrify(["a"]), ["a"]);
    // A string is one value rather than a sequence of characters, which is the
    // one thing iterating it would get wrong.
    assert.deepStrictEqual(arrify("ab"), ["ab"]);
    assert.deepStrictEqual(arrify(new Set(["a", "b"])), ["a", "b"]);
    assert.deepStrictEqual(arrify(42), [42]);
  });

  it("toPosixPath should turn every separator into a forward slash", () => {
    assert.strictEqual(toPosixPath("/home/user/a.css"), "/home/user/a.css");
    assert.strictEqual(
      toPosixPath(String.raw`C:\Users\me\a.css`),
      "C:/Users/me/a.css",
    );
    // A UNC share and a drive root keep their shape, which is what a path
    // walked back to `\\server` or `C:` would no longer name.
    assert.strictEqual(
      toPosixPath(String.raw`\\server\share\a.css`),
      "//server/share/a.css",
    );
    assert.strictEqual(toPosixPath("C:\\"), "C:/");
  });

  it("parseFiles should return relative files from context", () => {
    const [all, packageA, packageB] = parseFiles(
      ["**/*", "../package-a/src/**/", "../package-b/src/**/"],
      "main/src",
    );

    assert.ok(all.endsWith("main/src/**/*"));
    assert.ok(packageA.endsWith("main/package-a/src/**"));
    assert.ok(packageB.endsWith("main/package-b/src/**"));
  });

  it("parseFoldersToGlobs should return globs for folders", () => {
    assert.deepStrictEqual(parseFoldersToGlobs(directory, "js"), [
      `${directory}/**/*.js`,
    ]);
    assert.deepStrictEqual(parseFoldersToGlobs(`${directory}/`, "js"), [
      `${directory}/**/*.js`,
    ]);

    assert.deepStrictEqual(
      parseFoldersToGlobs(
        [directory, `${directory}/`, file],
        ["js", "cjs", "mjs"],
      ),
      [
        `${directory}/**/*.{js,cjs,mjs}`,
        `${directory}/**/*.{js,cjs,mjs}`,
        file,
      ],
    );

    assert.deepStrictEqual(parseFoldersToGlobs(directory), [`${directory}/**`]);
    assert.deepStrictEqual(parseFoldersToGlobs(`${directory}/`), [
      `${directory}/**`,
    ]);
  });

  it("parseFoldersToGlobs should return unmodified globs for globs (ignoring extensions)", () => {
    assert.deepStrictEqual(parseFoldersToGlobs("**.notjs", "js"), ["**.notjs"]);
  });
});
