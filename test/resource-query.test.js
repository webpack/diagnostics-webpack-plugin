import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pack from "./utils/pack.js";

/**
 * Two modules of the same query, so that a regexp answering for one of them and
 * not the next is a failure rather than a coin toss.
 * @param {EXPECTED_ANY} resourceQueryExclude what not to lint
 * @returns {Promise<number>} how many files were reported
 */
async function reported(resourceQueryExclude) {
  const stats = await pack("query-exclude", {
    resourceQueryExclude,
  }).runAsync();
  const [error] = stats.compilation.errors;

  return error ? (error.message.match(/no-var/gu) || []).length : 0;
}

describe("resource-query", () => {
  it("should lint what nothing excludes", async () => {
    assert.strictEqual(await reported(undefined), 2);
  });

  it("should exclude the match resource query", async () => {
    assert.strictEqual(await reported(/media/u), 0);
  });

  it("should exclude every match of a regexp that remembers the last one", async () => {
    // `g` and `y` make `test` start where the last answer left off, so a regexp
    // carrying either would answer for every other file.
    assert.strictEqual(await reported(/media/gu), 0);
    assert.strictEqual(await reported(/media/y), 0);
  });

  it("should exclude the match resource query written as a string", async () => {
    assert.strictEqual(await reported(["media"]), 0);
  });
});
