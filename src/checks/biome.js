// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";

import {
  filterDiagnostics,
  findBinary,
  groupByFile,
  runJson,
  splitBySeverity,
} from "../cli.js";

/** @typedef {import("./index.js").CheckContext} CheckContext */
/** @typedef {import("./index.js").CheckInstance} CheckInstance */
/** @typedef {import("../options.js").CheckOptions} Options */

/**
 * @typedef {object} FileResult
 * @property {string} filename the file every diagnostic of it was found in
 * @property {Diagnostic[]} diagnostics what Biome found there
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} severity how Biome rates it
 * @property {string} message what Biome found
 * @property {string=} category the rule it came from
 * @property {{ path?: string, start?: { line: number, column: number } }=} location where it is
 * @property {string} path the file it was found in, as this check reads it
 */

const nodeRequire = createRequire(import.meta.url);

// An argument list is not unbounded, so a batch past this is run in several.
const FILES_PER_RUN = 500;

/** @type {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY } | undefined} */
let schemas;

/**
 * Read on demand so that requiring the plugin does not read three files.
 * @returns {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY }} the schemas
 */
function getSchemas() {
  if (!schemas) {
    schemas = {
      plugin: nodeRequire("../options.json"),
      shared: nodeRequire("../shared-options.json"),
      own: nodeRequire("./biome.json"),
    };
  }

  return schemas;
}

/**
 * @param {string} filename the file it was found in
 * @param {Diagnostic} diagnostic what Biome found
 * @returns {string} it as one line, Biome's own reporters being a second run
 */
function formatDiagnostic(filename, diagnostic) {
  const start = diagnostic.location && diagnostic.location.start;
  const at = start ? `:${start.line}:${start.column}` : "";
  const rule = diagnostic.category ? `  ${diagnostic.category}` : "";

  return `${filename}${at}  ${diagnostic.severity}  ${diagnostic.message}${rule}`;
}

/** @type {Map<string, string | undefined>} */
const natives = new Map();

// Where each platform's build of Biome is published, as Biome's own launcher
// names them.
/** @type {Record<string, Record<string, string>>} */
const PLATFORMS = {
  win32: {
    x64: "@biomejs/cli-win32-x64/biome.exe",
    arm64: "@biomejs/cli-win32-arm64/biome.exe",
  },
  darwin: {
    x64: "@biomejs/cli-darwin-x64/biome",
    arm64: "@biomejs/cli-darwin-arm64/biome",
  },
  linux: {
    x64: "@biomejs/cli-linux-x64/biome",
    arm64: "@biomejs/cli-linux-arm64/biome",
  },
  "linux-musl": {
    x64: "@biomejs/cli-linux-x64-musl/biome",
    arm64: "@biomejs/cli-linux-arm64-musl/biome",
  },
};

/**
 * @param {string} script the launcher
 * @returns {string | undefined} the binary published for this platform beside it
 */
function lookUpNative(script) {
  // Node built against glibc says which one; on musl it says nothing.
  const { header } = /** @type {EXPECTED_ANY} */ (process.report.getReport());
  const platform =
    process.platform === "linux" && !header.glibcVersionRuntime
      ? "linux-musl"
      : process.platform;
  const published = PLATFORMS[platform] && PLATFORMS[platform][process.arch];

  if (!published) return undefined;

  try {
    // Resolved from the launcher, whose optional dependency the build is.
    return createRequire(script).resolve(published);
  } catch {
    return undefined;
  }
}

/**
 * The binary Biome's launcher would run, found as the launcher finds it: what
 * `BIOME_BINARY` names, or the build published for this platform beside the
 * package. The launcher is a Node process of its own on every run, for nothing
 * but to start this one.
 * @param {string} script the launcher
 * @returns {string | undefined} the binary, or nothing where none is found
 */
function findNative(script) {
  if (process.env.BIOME_BINARY) return process.env.BIOME_BINARY;

  // Asked by every compilation, and the answer is the machine's.
  if (natives.has(script)) return natives.get(script);

  const found = lookUpNative(script);

  natives.set(script, found);

  return found;
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} biome check
 */
async function create({ options }) {
  const script = findBinary(
    String(options.biomePath || "@biomejs/biome"),
    "biome",
  );
  const native = findNative(script);
  const cwd = String(options.context);
  const flags = [
    String(options.command || "lint"),
    // Biome calls this reporter experimental, so a release of its own may move
    // the shape this check reads. It is the only one that carries severities.
    "--reporter=json",
    ...(options.configFile
      ? ["--config-path", String(options.configFile)]
      : []),
    ...(options.fix ? ["--write"] : []),
    .../** @type {string[]} */ (options.args || []),
  ];

  return {
    async lintFiles(files) {
      /** @type {Diagnostic[]} */
      const found = [];

      for (let i = 0; i < files.length; i += FILES_PER_RUN) {
        const answer = await runJson(
          native || script,
          [...flags, ...files.slice(i, i + FILES_PER_RUN)],
          cwd,
          Boolean(native),
        );

        found.push(...(answer.diagnostics || []));
      }

      // A diagnostic Biome cannot put a file to is about the run rather than
      // about the sources, and there is nothing to report it against.
      return found.flatMap((diagnostic) => {
        const path = diagnostic.location && diagnostic.location.path;

        return path ? [{ ...diagnostic, path }] : [];
      });
    },
    async getResults(results) {
      return groupByFile(
        /** @type {Diagnostic[]} */ (results),
        (diagnostic) => diagnostic.path,
        cwd,
      );
    },
    filterResults(results, keep) {
      return filterDiagnostics(
        /** @type {FileResult[]} */ (results),
        keep,
        (diagnostic) => diagnostic.category,
      );
    },
    splitResults(results) {
      return splitBySeverity(/** @type {FileResult[]} */ (results));
    },
    async getFormatter(formatter) {
      if (typeof formatter === "function") {
        return async (results) => String(await formatter(results));
      }

      return async (results) =>
        /** @type {FileResult[]} */ (results)
          .flatMap((file) =>
            file.diagnostics.map((diagnostic) =>
              formatDiagnostic(file.filename, diagnostic),
            ),
          )
          .join("\n");
    },
    async cleanup() {},
  };
}

export default {
  name: "biome",
  label: "Biome",
  filesSource: "modules",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    extensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  resultPath: (/** @type {EXPECTED_ANY} */ result) =>
    /** @type {FileResult} */ (result).filename,
  // Biome's project and types domains — `noImportCycles`, `noFloatingPromises`
  // — answer for a file from the files it imports, and which rules sit in them
  // is Biome's to say from one release to the next, so its config cannot be
  // read for the answer the way oxlint's can. A rebuild lints again what a
  // change reaches, which a run of Biome barely notices; a project using none
  // of those rules can write `readsAcrossFiles: false`.
  readsAcrossFiles: () => true,
};

export { findNative };
