export default DiagnosticsWebpackPlugin;
export type Compilation = import("webpack").Compilation;
export type Compiler = import("webpack").Compiler;
export type Module = import("webpack").Module;
export type NormalModule = import("webpack").NormalModule;
export type Dependencies = import("./check.js").Dependencies;
export type Runner = import("./check.js").Runner;
export type CheckAdapter = import("./checks/index.js").CheckAdapter;
export type EnabledCheck = import("./options.js").EnabledCheck;
export type CheckOptions = import("./options.js").CheckOptions;
export type Options = import("./options.js").Options;
export type ResolvedCheck = {
  /**
   * what tells this entry from another of the same check
   */
  id: string;
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
  /**
   * the globs of the files to lint
   */
  wanted: string[];
  /**
   * the globs of the files not to lint
   */
  exclude: string[];
  /**
   * where the check's files come from
   */
  filesSource: "modules" | "glob";
  /**
   * whether a path is one to lint
   */
  isWanted: (file: string) => boolean;
  /**
   * whether a path is left out
   */
  isExcluded: (file: string) => boolean;
};
declare class DiagnosticsWebpackPlugin {
  /**
   * @param {Options} options options
   */
  constructor(options?: Options);
  key: string;
  given: import("./options.js").Options;
  options: import("./options.js").NormalizedOptions;
  /**
   * @param {Compiler} compiler compiler
   * @param {ResolvedCheck[]} checks the checks to run
   */
  run(compiler: Compiler, checks: ResolvedCheck[]): Promise<void>;
  /**
   * @param {Compiler} compiler compiler
   * @returns {void}
   */
  apply(compiler: Compiler): void;
  /**
   * @param {Compiler} compiler compiler
   * @param {string} context context
   * @param {EnabledCheck} check the check to resolve the globs of
   * @returns {Promise<ResolvedCheck>} the check with its globs resolved
   */
  resolveCheck(
    compiler: Compiler,
    context: string,
    { id, name, adapter, options }: EnabledCheck,
  ): Promise<ResolvedCheck>;
  /**
   * @param {ResolvedCheck} check the check to create a runner for
   * @param {Compilation} compilation compilation
   * @returns {Runner} runner
   */
  createRunner(
    { id, name, adapter, options }: ResolvedCheck,
    compilation: Compilation,
  ): Runner;
  /**
   * @param {Compiler} compiler compiler
   * @returns {string} context
   */
  getContext(compiler: Compiler): string;
}
