export default adapters;
export type EXPECTED_ANY = any;
export type Compilation = import("webpack").Compilation;
export type Compiler = import("webpack").Compiler;
export type CheckOptions = import("../options.js").CheckOptions;
export type Message = import("../options.js").Message;
/**
 * A result produced by a check, only the adapter that created it knows its shape.
 */
export type CheckResult = EXPECTED_ANY;
export type FormatterOption =
  | string
  | ((
      results: CheckResult[],
      ...args: EXPECTED_ANY[]
    ) => string | Promise<string>);
export type Format = (results: CheckResult[]) => Promise<string>;
export type CheckContext = {
  /**
   * a key unique to the compiler the check runs for
   */
  key: string;
  /**
   * resolved options for this check
   */
  options: CheckOptions;
  /**
   * the compilation being linted
   */
  compilation: Compilation;
};
export type CheckInstance = {
  /**
   * lints the given files
   */
  lintFiles: (files: string[]) => Promise<CheckResult[]>;
  /**
   * turns the raw results of every `lintFiles` call into the results to report
   */
  getResults: (results: CheckResult[]) => Promise<CheckResult[]>;
  /**
   * splits the results by their own severity, leaving `reportAs` to the plugin
   */
  splitResults: (results: CheckResult[]) => {
    errors: CheckResult[];
    warnings: CheckResult[];
  };
  /**
   * the file a result came from, without which a rebuild re-lints everything
   */
  resultPath?: ((result: CheckResult) => string | undefined) | undefined;
  /**
   * the files the check read beyond the ones it was handed, so that a watcher picks up a change to them
   */
  readFiles?: (() => string[]) | undefined;
  /**
   * the directories the check takes its files from, so that a file appearing in one is picked up
   */
  readDirectories?: (() => string[]) | undefined;
  /**
   * the files the check looked for and did not find, so that creating one is picked up
   */
  missingFiles?: (() => string[]) | undefined;
  /**
   * the paths the check itself writes, which are watched by nothing so that a build is not its own trigger
   */
  writesTo?: (() => string[]) | undefined;
  /**
   * keeps what a predicate accepts of every result, which is what `ignore` is applied through
   */
  filterResults?:
    | ((
        results: CheckResult[],
        keep: (message: Message) => boolean,
      ) => CheckResult[])
    | undefined;
  /**
   * loads a formatter, falling back to the tool's default one
   */
  getFormatter: (formatter?: FormatterOption) => Promise<Format>;
  /**
   * releases whatever the tool holds after a run
   */
  cleanup: () => Promise<void>;
};
/**
 * What a check shipped outside this package has to provide; everything the
 * plugin can default is optional.
 */
export type CheckAdapterInput = {
  /**
   * the option key the check is configured under
   */
  name: string;
  /**
   * creates a check for one compilation
   */
  create: (context: CheckContext) => Promise<CheckInstance>;
  /**
   * the human readable name, used in diagnostics
   */
  label?: string | undefined;
  /**
   * whether the check reads the files webpack built or every file matching `files`
   */
  filesSource?: ("modules" | "glob") | undefined;
  /**
   * JSON schema of the options only this check understands
   */
  schema?:
    | {
        properties: {
          [key: string]: EXPECTED_ANY;
        };
      }
    | undefined;
  /**
   * default options for this check
   */
  defaults?:
    | {
        [key: string]: EXPECTED_ANY;
      }
    | undefined;
  /**
   * the globs excluded when the user specifies none
   */
  defaultExclude?: ((compiler: Compiler) => string | string[]) | undefined;
  /**
   * whether what the check reports of one file can turn on another, so that a rebuild lints every file it covers rather than keeping what it said of the ones that did not change
   */
  readsAcrossFiles?: ((compiler: Compiler) => boolean) | undefined;
};
export type CheckAdapter = {
  /**
   * the option key the check is configured under
   */
  name: string;
  /**
   * the human readable name, used in diagnostics
   */
  label: string;
  /**
   * whether the check reads the files webpack built or every file matching `files`
   */
  filesSource: "modules" | "glob";
  /**
   * JSON schema of the options only this check understands
   */
  schema: {
    properties: {
      [key: string]: EXPECTED_ANY;
    };
  };
  /**
   * default options for this check
   */
  defaults: {
    [key: string]: EXPECTED_ANY;
  };
  /**
   * the globs excluded when the user specifies none
   */
  defaultExclude: (compiler: Compiler) => string | string[];
  /**
   * creates a check for one compilation
   */
  create: (context: CheckContext) => Promise<CheckInstance>;
  /**
   * the file a result came from, without which a rebuild re-lints everything
   */
  resultPath?: ((result: CheckResult) => string | undefined) | undefined;
  /**
   * whether what the check reports of one file can turn on another, so that a rebuild lints every file it covers rather than keeping what it said of the ones that did not change
   */
  readsAcrossFiles?: ((compiler: Compiler) => boolean) | undefined;
};
/** @typedef {import("webpack").Compilation} Compilation */
/** @typedef {import("webpack").Compiler} Compiler */
/** @typedef {import("../options.js").CheckOptions} CheckOptions */
/** @typedef {import("../options.js").Message} Message */
/**
 * A result produced by a check, only the adapter that created it knows its shape.
 * @typedef {EXPECTED_ANY} CheckResult
 */
/**
 * @typedef {string | ((results: CheckResult[], ...args: EXPECTED_ANY[]) => string | Promise<string>)} FormatterOption
 */
/** @typedef {(results: CheckResult[]) => Promise<string>} Format */
/**
 * @typedef {object} CheckContext
 * @property {string} key a key unique to the compiler the check runs for
 * @property {CheckOptions} options resolved options for this check
 * @property {Compilation} compilation the compilation being linted
 */
/**
 * @typedef {object} CheckInstance
 * @property {(files: string[]) => Promise<CheckResult[]>} lintFiles lints the given files
 * @property {(results: CheckResult[]) => Promise<CheckResult[]>} getResults turns the raw results of every `lintFiles` call into the results to report
 * @property {(results: CheckResult[]) => { errors: CheckResult[], warnings: CheckResult[] }} splitResults splits the results by their own severity, leaving `reportAs` to the plugin
 * @property {((result: CheckResult) => string | undefined)=} resultPath the file a result came from, without which a rebuild re-lints everything
 * @property {(() => string[])=} readFiles the files the check read beyond the ones it was handed, so that a watcher picks up a change to them
 * @property {(() => string[])=} readDirectories the directories the check takes its files from, so that a file appearing in one is picked up
 * @property {(() => string[])=} missingFiles the files the check looked for and did not find, so that creating one is picked up
 * @property {(() => string[])=} writesTo the paths the check itself writes, which are watched by nothing so that a build is not its own trigger
 * @property {((results: CheckResult[], keep: (message: Message) => boolean) => CheckResult[])=} filterResults keeps what a predicate accepts of every result, which is what `ignore` is applied through
 * @property {(formatter?: FormatterOption) => Promise<Format>} getFormatter loads a formatter, falling back to the tool's default one
 * @property {() => Promise<void>} cleanup releases whatever the tool holds after a run
 */
/**
 * What a check shipped outside this package has to provide; everything the
 * plugin can default is optional.
 * @typedef {object} CheckAdapterInput
 * @property {string} name the option key the check is configured under
 * @property {(context: CheckContext) => Promise<CheckInstance>} create creates a check for one compilation
 * @property {string=} label the human readable name, used in diagnostics
 * @property {"modules" | "glob"=} filesSource whether the check reads the files webpack built or every file matching `files`
 * @property {{ properties: { [key: string]: EXPECTED_ANY } }=} schema JSON schema of the options only this check understands
 * @property {{ [key: string]: EXPECTED_ANY }=} defaults default options for this check
 * @property {((compiler: Compiler) => string | string[])=} defaultExclude the globs excluded when the user specifies none
 * @property {((compiler: Compiler) => boolean)=} readsAcrossFiles whether what the check reports of one file can turn on another, so that a rebuild lints every file it covers rather than keeping what it said of the ones that did not change
 */
/**
 * @typedef {object} CheckAdapter
 * @property {string} name the option key the check is configured under
 * @property {string} label the human readable name, used in diagnostics
 * @property {"modules" | "glob"} filesSource whether the check reads the files webpack built or every file matching `files`
 * @property {{ properties: { [key: string]: EXPECTED_ANY } }} schema JSON schema of the options only this check understands
 * @property {{ [key: string]: EXPECTED_ANY }} defaults default options for this check
 * @property {(compiler: Compiler) => string | string[]} defaultExclude the globs excluded when the user specifies none
 * @property {(context: CheckContext) => Promise<CheckInstance>} create creates a check for one compilation
 * @property {((result: CheckResult) => string | undefined)=} resultPath the file a result came from, without which a rebuild re-lints everything
 * @property {((compiler: Compiler) => boolean)=} readsAcrossFiles whether what the check reports of one file can turn on another, so that a rebuild lints every file it covers rather than keeping what it said of the ones that did not change
 */
/** @type {Map<string, CheckAdapter>} */
declare const adapters: Map<string, CheckAdapter>;
