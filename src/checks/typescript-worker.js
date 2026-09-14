// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { importFrom } from "../utils.js";

import { check, describe, getHeld } from "./typescript-program.js";

/** @typedef {import("../options.js").CheckOptions} Options */
/** @typedef {EXPECTED_ANY} TypeScript */

/** @type {Options} */
let checkOptions;

/** @type {Promise<TypeScript> | null} */
let loading = null;

/** The worker is the whole of one check, so what it holds is one program. */
const compiler = {};

/**
 * @returns {Promise<TypeScript>} the loaded TypeScript
 */
async function getTypeScript() {
  if (!loading) {
    loading = (async () => {
      const loaded = await importFrom(
        checkOptions.typescriptPath || "typescript",
      );

      return loaded.default || loaded;
    })();
  }

  return loading;
}

/**
 * @param {Options} options the options the check was configured with
 */
function setup(options) {
  checkOptions = options;
  loading = null;
}

/**
 * Runs the check and answers with what crosses back: a `Diagnostic` holds the
 * source file it was found in, so each one is described and formatted here.
 * @returns {Promise<EXPECTED_ANY>} what it found, and what it read to find it
 */
async function lintFiles() {
  const ts = await getTypeScript();
  const held = getHeld(compiler, "worker");
  const found = check(ts, checkOptions, held);
  // Each on its own, so that what is left after `ignoreDiagnostics` can be
  // printed without asking the worker again. Each block carries the newline
  // TypeScript ends it with, which is what separates one from the next, so
  // they are joined rather than put back together with a newline of our own.
  const diagnostics = found.diagnostics.map((diagnostic) => ({
    ...describe(ts, diagnostic),
    formatted: ts.formatDiagnosticsWithColorAndContext(
      [diagnostic],
      found.host,
    ),
  }));

  return {
    diagnostics,
    files: found.files,
    directories: found.directories,
    writes: found.writes,
    missing: [...held.missing],
  };
}

export { lintFiles, setup };
