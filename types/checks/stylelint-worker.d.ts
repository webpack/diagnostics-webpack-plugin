export type LintResult = import("./stylelint.js").LintResult;
export type Reported = import("./stylelint.js").Reported;
export type StylelintOptions = import("./stylelint.js").StylelintOptions;
export type Stylelint = import("./stylelint.js").Stylelint;
export type Options = import("../options.js").CheckOptions;
export type Linter = {
  getStylelint: () => Promise<Stylelint>;
  lintFiles: (files: string | string[]) => Promise<Reported[]>;
};
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
export function createLinter(
  stylelintPath: string,
  linterOptions: Partial<StylelintOptions>,
): Linter;
/**
 * @returns {Promise<Stylelint>} stylelint instance
 */
export function getStylelint(): Promise<Stylelint>;
/**
 * @param {string | string[]} files files
 * @returns {Promise<Reported[]>} results
 */
export function lintFiles(files: string | string[]): Promise<Reported[]>;
/**
 * @param {Options} options the worker options
 * @param {Partial<StylelintOptions>} stylelintOptions the stylelint options
 */
export function setup(
  options: Options,
  stylelintOptions: Partial<StylelintOptions>,
): void;
