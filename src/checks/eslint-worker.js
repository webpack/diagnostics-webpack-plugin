import { importFrom } from "../utils.js";

import { forRun } from "./worker-runs.js";

/** @typedef {import("./eslint.js").ESLintClass} ESLintClass */
/** @typedef {import("./eslint.js").ESLintOptions} ESLintOptions */
/** @typedef {import("./eslint.js").LintResult} LintResult */
/** @typedef {InstanceType<ESLintClass>} ESLintInstance */

/** @type {string} */
let specifier = "eslint";

/** @type {ESLintOptions} */
let eslintOptions;

/** @type {boolean} */
let useFlatConfig = true;

/** @type {Promise<ESLintInstance> | null} */
let pending = null;

/**
 * @param {string} path what names the eslint to load
 * @param {ESLintOptions} options the options it is constructed with
 * @param {boolean} flat whether it is loaded in flat mode
 * @returns {void}
 */
function setup(path, options, flat) {
  specifier = path;
  eslintOptions = options;
  useFlatConfig = flat;
}

/**
 * The `ESLint` class the given eslint answers with, which is what says its
 * version and applies its fixes as well as what lints.
 * @param {string} path what names the eslint to load
 * @param {boolean} flat whether to load it in flat mode
 * @returns {Promise<ESLintClass>} the class to lint through
 */
async function loadESLintClass(path, flat) {
  const eslintModule = await importFrom(path);

  return eslintModule.loadESLint({ useFlatConfig: flat });
}

/**
 * Loads eslint once per worker, on the first file it is given.
 * @returns {Promise<ESLintInstance>} the eslint instance this worker lints with
 */
function getESLint() {
  if (!pending) {
    pending = (async () => {
      const ESLint = await loadESLintClass(specifier, useFlatConfig);

      return new ESLint(eslintOptions);
    })();
  }

  return pending;
}

/**
 * @param {string[]} files the files to lint
 * @returns {Promise<LintResult[]>} what eslint found in them
 */
async function lintFiles(files) {
  const eslint = await getESLint();

  return eslint.lintFiles(files);
}

/** @type {Map<string, { run: number, value: Promise<ESLintInstance> }>} */
const runs = new Map();

/**
 * Lints on a thread of webpack's shared pool, which is handed the setup with
 * each call rather than once at its start.
 * @param {number} run the run that handed the call over
 * @param {[string, ESLintOptions, boolean]} setupArgs what `setup` is handed on a jest-worker thread
 * @param {string[]} files the files to lint
 * @returns {Promise<LintResult[]>} what eslint found in them
 */
async function lintFilesWith(run, setupArgs, files) {
  const eslint = await forRun(runs, run, setupArgs, async () => {
    const [path, options, flat] = setupArgs;
    const ESLint = await loadESLintClass(path, flat);

    return new ESLint(options);
  });

  return eslint.lintFiles(files);
}

export { lintFiles, lintFilesWith, loadESLintClass, setup };
