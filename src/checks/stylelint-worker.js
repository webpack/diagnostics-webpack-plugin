import { importFrom } from "../utils.js";

/** @typedef {import("./stylelint.js").LintResult} LintResult */
/** @typedef {import("./stylelint.js").Reported} Reported */
/** @typedef {import("./stylelint.js").StylelintOptions} StylelintOptions */
/** @typedef {import("./stylelint.js").Stylelint} Stylelint */
/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {{ getStylelint: () => Promise<Stylelint>, lintFiles: (files: string | string[]) => Promise<Reported[]> }} Linter */

/**
 * A stylelint loaded under one set of options. A worker holds the one it was
 * started with; the plugin's own thread holds one per check, which is what
 * keeps two checks of the same tool out of each other's options.
 * @param {string} stylelintPath what names the stylelint to load
 * @param {Partial<StylelintOptions>} linterOptions the options it lints under
 * @returns {Linter} the linter those options describe
 */
function createLinter(stylelintPath, linterOptions) {
  /** @type {Promise<Stylelint> | null} */
  let loading = null;

  /**
   * Lazily load stylelint on first use.
   * @returns {Promise<Stylelint>} stylelint instance
   */
  const getStylelint = () => {
    if (!loading) {
      loading = (async () => {
        const mod = await importFrom(stylelintPath);
        // A `stylelintPath` may name a CommonJS module, which has no default export
        return mod.default || mod;
      })();
    }

    return loading;
  };

  return {
    getStylelint,
    async lintFiles(files) {
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
    },
  };
}

// The one this worker was started for, which is a thread of its own.
/** @type {Linter} */
let own;

/**
 * @param {Options} options the worker options
 * @param {Partial<StylelintOptions>} stylelintOptions the stylelint options
 */
function setup(options, stylelintOptions) {
  own = createLinter(
    String(options.stylelintPath || "stylelint"),
    stylelintOptions,
  );
}

/**
 * @returns {Promise<Stylelint>} stylelint instance
 */
function getStylelint() {
  return own.getStylelint();
}

/**
 * @param {string | string[]} files files
 * @returns {Promise<Reported[]>} results
 */
function lintFiles(files) {
  return own.lintFiles(files);
}

export { createLinter, getStylelint, lintFiles, setup };
