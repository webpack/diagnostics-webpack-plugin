export type ESLintClass = import("./eslint.js").ESLintClass;
export type ESLintOptions = import("./eslint.js").ESLintOptions;
export type LintResult = import("./eslint.js").LintResult;
export type ESLintInstance = InstanceType<ESLintClass>;
/**
 * @param {string[]} files the files to lint
 * @returns {Promise<LintResult[]>} what eslint found in them
 */
export function lintFiles(files: string[]): Promise<LintResult[]>;
/**
 * The `ESLint` class the given eslint answers with, which is what says its
 * version and applies its fixes as well as what lints.
 * @param {string} path what names the eslint to load
 * @param {boolean} flat whether to load it in flat mode
 * @returns {Promise<ESLintClass>} the class to lint through
 */
export function loadESLintClass(
  path: string,
  flat: boolean,
): Promise<ESLintClass>;
/**
 * @param {string} path what names the eslint to load
 * @param {ESLintOptions} options the options it is constructed with
 * @param {boolean} flat whether it is loaded in flat mode
 * @returns {void}
 */
export function setup(
  path: string,
  options: ESLintOptions,
  flat: boolean,
): void;
