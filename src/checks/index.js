// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import biome from "./biome.js";
import eslint from "./eslint.js";
import oxlint from "./oxlint.js";
import stylelint from "./stylelint.js";
import typescript from "./typescript.js";

/** @typedef {import("webpack").Compilation} Compilation */
/** @typedef {import("webpack").Compiler} Compiler */
/** @typedef {import("../options.js").CheckOptions} CheckOptions */

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
 */

/** @type {Map<string, CheckAdapter>} */
const adapters = new Map([
  [biome.name, /** @type {CheckAdapter} */ (biome)],
  [eslint.name, /** @type {CheckAdapter} */ (eslint)],
  [oxlint.name, /** @type {CheckAdapter} */ (oxlint)],
  [stylelint.name, /** @type {CheckAdapter} */ (stylelint)],
  [typescript.name, /** @type {CheckAdapter} */ (typescript)],
]);

export default adapters;
