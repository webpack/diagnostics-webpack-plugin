// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";

import { pathToFileURL } from "node:url";

import picomatch from "picomatch";

const nodeRequire = createRequire(import.meta.url);

/** @typedef {import("webpack").Compiler} Compiler */

/**
 * @template T
 * @typedef {T extends (null | undefined)
 * ? []
 * : T extends string
 * ? [string]
 * : T extends readonly unknown[]
 * ? T
 * : T extends Iterable<infer T>
 * ? T[]
 * : [T]} ArrifyResult
 */

/* istanbul ignore next */
/**
 * @template T
 * @param {T} value value
 * @returns {ArrifyResult<T>} array of values
 */
function arrify(value) {
  if (value === null || value === undefined) {
    return /** @type {ArrifyResult<T>} */ ([]);
  }

  if (Array.isArray(value)) {
    return /** @type {ArrifyResult<T>} */ (value);
  }

  if (typeof value === "string") {
    return /** @type {ArrifyResult<T>} */ ([value]);
  }

  // @ts-expect-error need better types
  if (typeof value[Symbol.iterator] === "function") {
    // @ts-expect-error need better types
    return [...value];
  }

  return /** @type {ArrifyResult<T>} */ ([value]);
}

/**
 * A package name is imported as it is, so a test can still mock it. A path may
 * name a directory, which `import.meta.resolve` returns unchanged for
 * `import` to reject, so CommonJS resolution finds the entry file first.
 * @param {string} specifier a module specifier or path
 * @returns {Promise<EXPECTED_ANY>} the imported module
 */
async function importFrom(specifier) {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
    return import(specifier);
  }

  try {
    return await import(pathToFileURL(nodeRequire.resolve(specifier)).href);
  } catch {
    return import(specifier);
  }
}

/**
 * Globs only know the forward slash, so a path is compared and matched as one.
 * @param {string} file a path
 * @returns {string} the path with its separators turned into forward slashes
 */
function toPosixPath(file) {
  return file.replaceAll("\\", "/");
}

/**
 * @param {string | string[]} files files
 * @param {string} context context
 * @returns {string[]} normalized paths
 */
function parseFiles(files, context) {
  return arrify(files).map((/** @type {string} */ file) =>
    toPosixPath(resolve(context, file)),
  );
}

/**
 * @param {string | string[]} patterns patterns
 * @param {string | string[]} extensions extensions
 * @returns {string[]} globs
 */
function parseFoldersToGlobs(patterns, extensions = []) {
  const extensionsList = arrify(extensions);
  const [prefix, postfix] = extensionsList.length > 1 ? ["{", "}"] : ["", ""];
  const extensionsGlob = extensionsList
    .map((/** @type {string} */ extension) => extension.replace(/^\./u, ""))
    .join(",");

  /**
   * @param {string} pattern a path naming a folder
   * @returns {string} what matches everything the folder holds
   */
  const asFolder = (pattern) =>
    pattern.replace(
      /[/\\]*?$/u,
      `/**${extensionsGlob ? `/*.${prefix + extensionsGlob + postfix}` : ""}`,
    );

  return arrify(patterns).flatMap((/** @type {string} */ pattern) => {
    try {
      // The patterns are absolute because they are prepended with the context.
      // A folder is read as one whatever its name is made of, so this is asked
      // before the pattern is: `[symbols]` is a directory and a character class.
      if (statSync(pattern).isDirectory()) return asFolder(pattern);

      return pattern;
    } catch {
      // A glob already says what it covers, whether or not anything is there.
      if (picomatch.scan(pattern).isGlob) return pattern;

      // A path that is not there yet is one the build may go on to write, and
      // the globs are read once. Naming it both ways is what covers a folder
      // that appears later without missing a file of the same name.
      return [pattern, asFolder(pattern)];
    }
  });
}

/**
 * @param {{ [key: string]: EXPECTED_ANY }} options options
 * @param {{ [key: string]: EXPECTED_ANY }} properties schema properties to drop
 * @param {string[]=} keep keys to keep even when the schema describes them
 * @returns {{ [key: string]: EXPECTED_ANY }} options the tool itself understands
 */
function omitPluginOptions(options, properties, keep = []) {
  const toolOptions = { ...options };

  // No need to guard the for-in because the schema properties are hardcoded.

  for (const option in properties) {
    if (!keep.includes(option)) {
      delete toolOptions[option];
    }
  }

  return toolOptions;
}

/**
 * @param {string} _ key, but unused
 * @param {EXPECTED_ANY} value value
 * @returns {{ [key: string]: EXPECTED_ANY }} result
 */
const jsonStringifyReplacerSortKeys = (_, value) => {
  /**
   * @param {{ [key: string]: EXPECTED_ANY }} sorted sorted
   * @param {string | number} key key
   * @returns {{ [key: string]: EXPECTED_ANY }} result
   */
  const insert = (sorted, key) => {
    sorted[key] = value[key];
    return sorted;
  };

  return value instanceof Object && !Array.isArray(value)
    ? Object.keys(value).toSorted().reduce(insert, {})
    : value;
};

/**
 * @param {Compiler} compiler compiler
 * @param {string} name absolute file name
 * @param {string | Buffer} content content
 * @returns {Promise<void>}
 */
function writeOutputFile(compiler, name, content) {
  return /** @type {Promise<void>} */ (
    new Promise((finish, bail) => {
      if (!compiler.outputFileSystem) return;

      const { mkdir, writeFile } = compiler.outputFileSystem;

      mkdir(dirname(name), { recursive: true }, (err) => {
        /* istanbul ignore if */
        if (err) {
          bail(err);
        } else {
          writeFile(name, content, (/** @type {unknown} */ err2) => {
            /* istanbul ignore if */
            if (err2) bail(err2);
            else finish();
          });
        }
      });
    })
  );
}

export {
  arrify,
  importFrom,
  jsonStringifyReplacerSortKeys,
  omitPluginOptions,
  parseFiles,
  parseFoldersToGlobs,
  toPosixPath,
  writeOutputFile,
};
