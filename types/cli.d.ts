export type EXPECTED_ANY = any;
export type CheckResult = import("./checks/index.js").CheckResult;
/**
 * Keeps what a predicate accepts of every file's diagnostics, dropping a file
 * left with none of them.
 * @template {{ severity: string, message: string }} T
 * @param {{ filename: string, diagnostics: T[] }[]} files the results to filter
 * @param {(message: import("./options.js").Message) => boolean} keep whether to keep one
 * @param {(diagnostic: T) => string | undefined} codeOf the rule it came from
 * @returns {CheckResult[]} what is left of them
 */
export function filterDiagnostics<
  T extends {
    severity: string;
    message: string;
  },
>(
  files: {
    filename: string;
    diagnostics: T[];
  }[],
  keep: (message: import("./options.js").Message) => boolean,
  codeOf: (diagnostic: T) => string | undefined,
): CheckResult[];
/**
 * The entry of a tool that ships a binary behind one rather than a library, so
 * that it is run rather than called.
 * @param {string} specifier what names the package
 * @param {string} binary which of its binaries to run
 * @returns {string} the script to run
 */
export function findBinary(specifier: string, binary: string): string;
/**
 * One result per file rather than per diagnostic: the plugin remembers a file
 * by one result, so several would leave only the last of them. The path is made
 * absolute at the same time, a tool naming it relative to where it ran and the
 * plugin remembering it as webpack spells it.
 * @template T
 * @param {T[]} diagnostics what the tool found
 * @param {(diagnostic: T) => string} pathOf where it found each one
 * @param {string} cwd where it ran
 * @returns {{ filename: string, diagnostics: T[] }[]} them, by file
 */
export function groupByFile<T>(
  diagnostics: T[],
  pathOf: (diagnostic: T) => string,
  cwd: string,
): {
  filename: string;
  diagnostics: T[];
}[];
/**
 * Runs a tool and reads the JSON it answers with on stdout. A tool that found
 * something answers non-zero, which is not a failure to run; an empty answer
 * with one is.
 * @param {string} script the entry to run
 * @param {string[]} args what to run it with
 * @param {string} cwd where to run it
 * @returns {Promise<EXPECTED_ANY>} what it answered
 */
export function runJson(
  script: string,
  args: string[],
  cwd: string,
): Promise<EXPECTED_ANY>;
/**
 * Splits a file's diagnostics by the severity the tool gave them, so that
 * `reportAs` moves them from there rather than deciding them.
 * @template {{ severity: string }} T
 * @param {{ filename: string, diagnostics: T[] }[]} files the results to split
 * @returns {{ errors: CheckResult[], warnings: CheckResult[] }} them, split
 */
export function splitBySeverity<
  T extends {
    severity: string;
  },
>(
  files: {
    filename: string;
    diagnostics: T[];
  }[],
): {
  errors: CheckResult[];
  warnings: CheckResult[];
};
