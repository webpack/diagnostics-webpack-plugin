declare namespace _default {
  export let name: string;
  export let label: string;
  export let filesSource: string;
  export const schema: any;
  export namespace defaults {
    let cache: boolean;
    let cacheLocation: string;
    let configType: string;
    let extensions: string;
  }
  export function defaultExclude(): string;
  export function resultPath(result: EXPECTED_ANY): string;
  export function readsAcrossFiles(compiler: EXPECTED_ANY): boolean;
  export { create };
  export { getESLintOptions };
}
export default _default;
export type EXPECTED_ANY = any;
export type ESLint = import("eslint").ESLint;
export type Formatter = import("eslint").ESLint.Formatter;
export type LintResult = import("eslint").ESLint.LintResult;
export type ESLintOptions = import("eslint").ESLint.Options;
export type FormatterOption = import("../checks/index.js").FormatterOption;
export type CheckContext = import("../checks/index.js").CheckContext;
export type CheckInstance = import("../checks/index.js").CheckInstance;
export type Options = import("../options.js").CheckOptions;
export type ESLintClass = {
  new (arg0: ESLintOptions): ESLint;
  outputFixes: (arg0: LintResult[]) => Promise<void>;
  version: string;
};
/**
 * @param {Options} options plugin options
 * @returns {ESLintOptions} the options ESLint itself understands
 */
export function getESLintOptions(options: Options): ESLintOptions;
/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} eslint check
 */
declare function create({
  options,
  compilation,
}: CheckContext): Promise<CheckInstance>;
