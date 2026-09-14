import { importFrom } from "../utils.js";

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

export { lintFiles, loadESLintClass, setup };
