export type LintResult = import("./stylelint.js").LintResult;
export type Reported = import("./stylelint.js").Reported;
export type StylelintOptions = import("./stylelint.js").StylelintOptions;
export type Stylelint = import("./stylelint.js").Stylelint;
export type Options = import("../options.js").CheckOptions;
/**
 * Lazily load stylelint on first use.
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
