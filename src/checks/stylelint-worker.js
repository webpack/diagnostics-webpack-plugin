import { importFrom } from "../utils.js";

/** @typedef {import("./stylelint.js").LintResult} LintResult */
/** @typedef {import("./stylelint.js").Reported} Reported */
/** @typedef {import("./stylelint.js").StylelintOptions} StylelintOptions */
/** @typedef {import("./stylelint.js").Stylelint} Stylelint */
/** @typedef {import("../options.js").CheckOptions} Options */

/** @type {string} */
let stylelintPath = "stylelint";

/** @type {Partial<StylelintOptions>} */
let linterOptions;

/** @type {Promise<Stylelint> | null} */
let stylelintPromise = null;

/**
 * Lazily load stylelint on first use.
 * @returns {Promise<Stylelint>} stylelint instance
 */
async function getStylelint() {
  if (!stylelintPromise) {
    stylelintPromise = (async () => {
      const mod = await importFrom(stylelintPath);
      // A `stylelintPath` may name a CommonJS module, which has no default export
      return mod.default || mod;
    })();
  }

  return stylelintPromise;
}

/**
 * @param {Options} options the worker options
 * @param {Partial<StylelintOptions>} stylelintOptions the stylelint options
 */
function setup(options, stylelintOptions) {
  stylelintPath = options.stylelintPath || "stylelint";
  linterOptions = stylelintOptions;
  // Reset cached stylelint in case path changed
  stylelintPromise = null;
}

/**
 * @param {string | string[]} files files
 * @returns {Promise<Reported[]>} results
 */
async function lintFiles(files) {
  const stylelint = await getStylelint();
  const { results, ruleMetadata } = await stylelint.lint({
    ...linterOptions,
    files,
    quietDeprecationWarnings: true,
  });

  // Reset result to work with worker
  return results.map((result) => ({
    source: result.source,
    errored: result.errored,
    ignored: result.ignored,
    warnings: result.warnings,
    deprecations: result.deprecations,
    invalidOptionWarnings: result.invalidOptionWarnings,
    parseErrors: result.parseErrors,
    // What a formatter looks a warning's rule up in. The postcss result it
    // otherwise hangs off cannot cross a worker, and this is the same object
    // on every result of a batch, so it crosses once.
    ruleMetadata,
  }));
}

export { getStylelint, lintFiles, setup };
