// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validate } from "schema-utils";

import adapters from "../src/checks/index.js";
import optionsCheck from "../src/options.check.js";
import { ENTRY_CHECKS } from "../src/options.js";
import { getEntrySchema, getSchemas } from "../src/schemas.js";

// A precompiled check that passes skips the schema, so the two must never
// disagree on what is valid.

// Every kind of value, so each property is tried with every type
const VALUES = [
  undefined,
  null,
  true,
  false,
  0,
  42,
  -1,
  "",
  "eslint",
  "error",
  "warning",
  "auto",
  [],
  ["js"],
  [42],
  [/media/u, "media"],
  {},
  { errors: "warning" },
  { errors: "info" },
  { info: "error" },
  { filePath: "report.json" },
  { file: "a.js", code: "no-undef" },
  /media/u,
  () => true,
  Promise.resolve(),
];

/**
 * @param {import("schema-utils").Schema} schema schema
 * @param {EXPECTED_ANY} value value
 * @returns {boolean} whether the full validation accepts the value
 */
function isValid(schema, value) {
  try {
    validate(schema, value);

    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import("schema-utils").Schema & { properties: Record<string, unknown> }} schema schema
 * @param {(value: unknown) => boolean} check the precompiled check
 * @param {Record<string, unknown>} base a valid value to vary one property of
 */
function assertAgree(schema, check, base) {
  const values = [
    base,
    {},
    { ...base, unknown: true },
    ...Object.keys(schema.properties).flatMap((key) =>
      VALUES.map((value) => ({ ...base, [key]: value })),
    ),
  ];

  for (const value of values) {
    assert.strictEqual(
      check(value),
      isValid(schema, value),
      `the check and the schema disagree on ${JSON.stringify(value)}`,
    );
  }
}

describe("precompiled options check", () => {
  it("should agree with the plugin schema", () => {
    const { schema } = getSchemas();

    assertAgree(schema, optionsCheck, { checks: ["eslint"] });

    for (const checks of [
      [],
      ["eslint", "stylelint"],
      [{ use: "eslint", fix: true }],
      [{ fix: true }],
      [{ use: "eslint", cache: "yes" }],
      [42],
    ]) {
      assert.strictEqual(
        optionsCheck({ checks }),
        isValid(schema, { checks }),
        `the check and the schema disagree on ${JSON.stringify(checks)}`,
      );
    }
  });

  for (const [name, adapter] of adapters) {
    it(`should agree with the ${name} entry schema`, () => {
      assertAgree(getEntrySchema(adapter), ENTRY_CHECKS[name], { use: name });
    });
  }

  it("should have a check for every built-in check", () => {
    assert.deepStrictEqual(
      Object.keys(ENTRY_CHECKS).toSorted(),
      [...adapters.keys()].toSorted(),
    );
  });
});
