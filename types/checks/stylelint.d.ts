declare namespace _default {
  export let name: string;
  export let label: string;
  export let filesSource: string;
  export const schema: any;
  export namespace defaults {
    let cache: boolean;
    let cacheLocation: string;
    let extensions: string[];
  }
  export { getLoadedStylelint };
  export { getStylelintOptions };
  export function resultPath(result: EXPECTED_ANY): string | undefined;
  export function defaultExclude(compiler: Compiler): string[];
  export { create };
}
export default _default;
export type EXPECTED_ANY = any;
export type Formatter = import("stylelint").Formatter;
export type FormatterType = import("stylelint").FormatterType;
export type LintResult = import("stylelint").LintResult;
export type StylelintOptions = import("stylelint").LinterOptions;
export type LinterResult = import("stylelint").LinterResult;
export type RuleMeta = import("stylelint").RuleMeta;
export type Compiler = import("webpack").Compiler;
export type FormatterOption = import("../checks/index.js").FormatterOption;
export type CheckContext = import("../checks/index.js").CheckContext;
export type CheckInstance = import("../checks/index.js").CheckInstance;
export type Options = import("../options.js").CheckOptions;
export type Stylelint = {
  lint: (options: StylelintOptions) => Promise<LinterResult>;
  formatters: {
    [key: string]: Formatter;
  };
};
export type LintTask = (files: string | string[]) => Promise<LintResult[]>;
export type Loaded = {
  getStylelint: () => Promise<Stylelint>;
  lintFiles: LintTask;
  cleanup: () => Promise<void>;
  threads: number;
};
export type LintResultMap = {
  [file: string]: LintResult;
};
export type RuleMetadata = {
  [ruleName: string]: Partial<RuleMeta>;
};
export type Reported = LintResult & {
  ruleMetadata?: RuleMetadata;
};
/**
 * Stylelint is loaded once per key and options, so a watch rebuild reuses the
 * worker pool the previous run started.
 * @param {string | undefined} key a cache key
 * @param {Options} options options
 * @returns {Loaded} loaded stylelint
 */
export function getLoadedStylelint(
  key: string | undefined,
  options: Options,
): Loaded;
/**
 * @param {Options} options options
 * @returns {Partial<StylelintOptions>} stylelint options
 */
export function getStylelintOptions(
  options: Options,
): Partial<StylelintOptions>;
/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} stylelint check
 */
declare function create({ key, options }: CheckContext): Promise<CheckInstance>;
