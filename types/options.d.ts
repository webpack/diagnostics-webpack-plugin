export type EXPECTED_ANY = any;
export type Compiler = import("webpack").Compiler;
export type Severity = "error" | "warning" | "log" | false;
export type Results = "errors" | "warnings";
export type Threads = number | boolean | "auto";
export type ReportAs =
  | Severity
  | {
      errors?: Severity;
      warnings?: Severity;
    };
export type FormatterOption = import("./checks/index.js").FormatterOption;
export type CheckAdapter = import("./checks/index.js").CheckAdapter;
export type CheckAdapterInput = import("./checks/index.js").CheckAdapterInput;
export type OutputReport = {
  /**
   * a file path
   */
  filePath?: string | undefined;
  /**
   * a formatter
   */
  formatter?: FormatterOption | undefined;
};
export type SharedOptions = {
  /**
   * enable the tool's cache to decrease execution time
   */
  cache?: boolean | undefined;
  /**
   * specify the path to the cache location
   */
  cacheLocation?: string | undefined;
  /**
   * what a check reports its results as
   */
  reportAs?: ReportAs | undefined;
  /**
   * how many threads a check spreads its work over
   */
  threads?: Threads | undefined;
  /**
   * specify the files and/or directories to exclude
   */
  exclude?: (string | string[]) | undefined;
  /**
   * specify the extensions that should be checked
   */
  extensions?: (string | string[]) | undefined;
  /**
   * specify directories, files, or globs
   */
  files?: (string | string[]) | undefined;
  /**
   * apply fixes
   */
  fix?: boolean | undefined;
  /**
   * specify the formatter you would like to use to format your results
   */
  formatter?: FormatterOption | undefined;
  /**
   * writes the output of the errors to a file - for example, a `json` file for use for reporting
   */
  outputReport?: OutputReport | undefined;
  /**
   * specify the resource query to exclude
   */
  resourceQueryExclude?: (RegExp | RegExp[] | string | string[]) | undefined;
};
export type CheckEntry =
  | string
  | (SharedOptions & {
      use: string | CheckAdapterInput;
      [option: string]: EXPECTED_ANY;
    });
/**
 * The options of one check, as given and then as the plugin resolves them
 * against a compiler.
 */
export type CheckOptions = SharedOptions & {
  [option: string]: EXPECTED_ANY;
};
export type PluginOptions = {
  /**
   * a string indicating the root of your files
   */
  context?: string | undefined;
  /**
   * whether the first compilation lints everything
   */
  lintOnStart?: boolean | undefined;
  /**
   * the checks to run
   */
  checks: CheckEntry[];
};
export type Options = SharedOptions & PluginOptions;
export type EnabledCheck = {
  /**
   * check name
   */
  name: string;
  /**
   * the adapter running it
   */
  adapter: CheckAdapter;
  /**
   * options resolved for this check
   */
  options: CheckOptions;
};
export type NormalizedOptions = {
  /**
   * a string indicating the root of your files
   */
  context?: string | undefined;
  /**
   * whether the first compilation lints everything
   */
  lintOnStart: boolean;
  /**
   * the checks to run
   */
  checks: EnabledCheck[];
};
/**
 * Splits the options shared by every check from the per-check entries and
 * merges each entry over them.
 * @param {Options} pluginOptions plugin options
 * @returns {NormalizedOptions} normalized plugin options
 */
export function getOptions(pluginOptions: Options): NormalizedOptions;
/**
 * A severity covers a check's errors and its warnings alike unless an object
 * sets them apart, and one it leaves out keeps its own.
 * @param {ReportAs | undefined} reportAs the option as it was given
 * @param {Results} results which of a check's results to answer for
 * @returns {Severity} what they are reported as
 */
export function reportedAs(
  reportAs: ReportAs | undefined,
  results: Results,
): Severity;
/**
 * Runs from `compiler.hooks.validate`, so webpack's own `validate: false`
 * turns it off the way it does for webpack's plugins.
 * @param {Compiler} compiler compiler
 * @param {Options} pluginOptions the options as they were given
 * @param {EnabledCheck[]} checks the checks resolved from them
 * @returns {void}
 */
export function validateOptions(
  compiler: Compiler,
  pluginOptions: Options,
  checks: EnabledCheck[],
): void;
