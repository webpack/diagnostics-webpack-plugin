// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { toPosixPath } from "./utils.js";

/** @typedef {import("./checks/index.js").CheckResult} CheckResult */

const nodeRequire = createRequire(import.meta.url);

// A project's worth of diagnostics does not fit the default buffer.
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/**
 * The entry of a tool that ships a binary behind one rather than a library, so
 * that it is run rather than called.
 * @param {string} specifier what names the package
 * @param {string} binary which of its binaries to run
 * @returns {string} the script to run
 */
function findBinary(specifier, binary) {
  const manifest = nodeRequire.resolve(join(specifier, "package.json"));
  const { bin } = nodeRequire(manifest);

  return resolve(
    dirname(manifest),
    typeof bin === "string" ? bin : bin[binary],
  );
}

/**
 * Runs a tool and reads the JSON it answers with on stdout. A tool that found
 * something answers non-zero, which is not a failure to run; an empty answer
 * with one is.
 * @param {string} script the entry to run
 * @param {string[]} args what to run it with
 * @param {string} cwd where to run it
 * @returns {Promise<EXPECTED_ANY>} what it answered
 */
function runJson(script, args, cwd) {
  return new Promise((promiseResolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd, maxBuffer: OUTPUT_LIMIT },
      (error, stdout) => {
        if (!stdout && error) {
          reject(error);
          return;
        }

        try {
          promiseResolve(JSON.parse(stdout));
        } catch {
          reject(
            new Error(
              `answered something other than the JSON it was asked for: ${stdout.slice(0, 200)}`,
            ),
          );
        }
      },
    );
  });
}

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
function groupByFile(diagnostics, pathOf, cwd) {
  /** @type {Map<string, { filename: string, diagnostics: T[] }>} */
  const byFile = new Map();

  for (const diagnostic of diagnostics) {
    const filename = toPosixPath(resolve(cwd, pathOf(diagnostic)));
    const found = byFile.get(filename);

    if (found) found.diagnostics.push(diagnostic);
    else byFile.set(filename, { filename, diagnostics: [diagnostic] });
  }

  return [...byFile.values()];
}

/**
 * Keeps what a predicate accepts of every file's diagnostics, dropping a file
 * left with none of them.
 * @template {{ severity: string, message: string }} T
 * @param {{ filename: string, diagnostics: T[] }[]} files the results to filter
 * @param {(message: import("./options.js").Message) => boolean} keep whether to keep one
 * @param {(diagnostic: T) => string | undefined} codeOf the rule it came from
 * @returns {CheckResult[]} what is left of them
 */
function filterDiagnostics(files, keep, codeOf) {
  /** @type {CheckResult[]} */
  const kept = [];

  for (const file of files) {
    const diagnostics = file.diagnostics.filter((diagnostic) =>
      keep({
        file: file.filename,
        code: codeOf(diagnostic),
        severity: diagnostic.severity === "error" ? "error" : "warning",
        text: diagnostic.message,
      }),
    );

    if (diagnostics.length > 0) kept.push({ ...file, diagnostics });
  }

  return kept;
}

/**
 * Splits a file's diagnostics by the severity the tool gave them, so that
 * `reportAs` moves them from there rather than deciding them.
 * @template {{ severity: string }} T
 * @param {{ filename: string, diagnostics: T[] }[]} files the results to split
 * @returns {{ errors: CheckResult[], warnings: CheckResult[] }} them, split
 */
function splitBySeverity(files) {
  /** @type {CheckResult[]} */
  const errors = [];
  /** @type {CheckResult[]} */
  const warnings = [];

  // A file holding both is reported in both, each with its own half.
  for (const file of files) {
    for (const [wanted, into] of /** @type {const} */ ([
      [true, errors],
      [false, warnings],
    ])) {
      const diagnostics = file.diagnostics.filter(
        (diagnostic) => (diagnostic.severity === "error") === wanted,
      );

      if (diagnostics.length > 0) into.push({ ...file, diagnostics });
    }
  }

  return { errors, warnings };
}

export { filterDiagnostics, findBinary, groupByFile, runJson, splitBySeverity };
