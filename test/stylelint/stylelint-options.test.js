import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStylelintOptions } from "../../src/checks/stylelint.js";

describe("stylelint options", () => {
  it("should filter plugin options", () => {
    const options = {
      formatter: "json",
      reportAs: false,
    };

    // `formatter` is the plugin's: what Stylelint would format is the whole
    // run, before `ignoreDiagnostics` has taken anything out of it.
    assert.deepStrictEqual(getStylelintOptions(options), {});
  });

  it("should keep the stylelint options", () => {
    const options = {
      stylelintPath: "some/place/where/stylelint/lives",
      formatter: "json",
      files: ["file.scss"],
      reportAs: false,
      outputReport: true,
    };
    assert.deepStrictEqual(getStylelintOptions(options), {
      files: ["file.scss"],
    });
  });
});
