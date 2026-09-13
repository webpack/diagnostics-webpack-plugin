// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { statSync } from "node:fs";
import { createRequire } from "node:module";

import { importFrom, omitPluginOptions } from "../utils.js";

/** @typedef {import("./index.js").CheckContext} CheckContext */
/** @typedef {import("./index.js").CheckInstance} CheckInstance */
/** @typedef {import("./index.js").Format} Format */
/** @typedef {import("./index.js").FormatterOption} FormatterOption */
/** @typedef {import("../options.js").CheckOptions} Options */

/** @typedef {EXPECTED_ANY} TypeScript */
/** @typedef {EXPECTED_ANY} Diagnostic */
/**
 * What one compilation leaves for the next: the files it parsed, the host that
 * hands them back, and the program that type checked them.
 * @typedef {{ signature: string, files: Map<string, EXPECTED_ANY>, seen: Set<string>, host: EXPECTED_ANY, program: EXPECTED_ANY }} Held
 */

const nodeRequire = createRequire(import.meta.url);

/** @type {WeakMap<EXPECTED_ANY, Map<string, Held>>} */
const heldByCompiler = new WeakMap();

/**
 * A program is kept for the compiler that built it, so that a rebuild type
 * checks what changed rather than the project over again.
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @param {string} id a key unique to the check within that compiler
 * @returns {Held} what the last compilation left behind
 */
function getHeld(compiler, id) {
  let checks = heldByCompiler.get(compiler);

  if (!checks) {
    checks = new Map();
    heldByCompiler.set(compiler, checks);
  }

  let held = checks.get(id);

  if (!held) {
    held = {
      signature: "",
      files: new Map(),
      seen: new Set(),
      host: undefined,
      program: undefined,
    };
    checks.set(id, held);
  }

  return held;
}

/**
 * @param {string} file the file to read the state of
 * @returns {string | undefined} what tells one write of it from the next
 */
function versionOf(file) {
  try {
    const { mtimeMs, size } = statSync(file);

    return `${mtimeMs}:${size}`;
  } catch {
    return undefined;
  }
}

/**
 * A host answering with the source file it read last time for as long as the
 * file on disk is untouched, which is what a program has to be handed to reuse
 * the work of the one before it.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {EXPECTED_ANY} options the options the program is built with
 * @param {Map<string, EXPECTED_ANY>} files what was read, by path
 * @param {Set<string>} seen the paths this program asked for
 * @returns {EXPECTED_ANY} the host
 */
function createHost(ts, options, files, seen) {
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);

  host.getSourceFile = (
    /** @type {string} */ fileName,
    /** @type {EXPECTED_ANY} */ languageVersion,
    /** @type {EXPECTED_ANY} */ onError,
    /** @type {EXPECTED_ANY} */ shouldCreate,
  ) => {
    const version = versionOf(fileName);
    const held = files.get(fileName);

    seen.add(fileName);

    if (held && version && held.version === version) return held.file;

    const file = read(fileName, languageVersion, onError, shouldCreate);

    if (file && version) {
      // What the builder compares to decide which files it must check again.
      file.version = version;
      files.set(fileName, { version, file });
    }

    return file;
  };

  return host;
}

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
      own: nodeRequire("./typescript.json"),
    };
  }

  return schemas;
}

/**
 * @param {Options} options plugin options
 * @returns {EXPECTED_ANY} the options TypeScript itself understands
 */
function getTypeScriptOptions(options) {
  return omitPluginOptions(options, {
    ...getSchemas().plugin.properties,
    ...getSchemas().shared.properties,
    ...getSchemas().own.properties,
  });
}

/**
 * The program the config file describes, with emit off: webpack writes the
 * output, so a check that wrote any of its own would fight it.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Options} options options
 * @param {Held} held what the last compilation left behind
 * @returns {{ diagnostics: Diagnostic[], host: EXPECTED_ANY, files: string[] }} what it found, and what it read to find it
 */
function check(ts, options, held) {
  const context = String(options.context);
  const configFile =
    options.configFile ||
    ts.findConfigFile(context, ts.sys.fileExists, "tsconfig.json");

  /** @type {Diagnostic[]} */
  const unrecoverable = [];
  const host = {
    getCanonicalFileName: (/** @type {string} */ file) => file,
    getCurrentDirectory: () => context,
    getNewLine: () => ts.sys.newLine,
  };

  // Unreachable from the suite: every fixture sits under this repository's own
  // config, which the search finds on its way up.
  /* istanbul ignore next */
  if (!configFile) {
    throw new Error(
      `no 'tsconfig.json' was found above '${context}', and none was named by 'configFile'.`,
    );
  }

  const overrides = {
    ...getTypeScriptOptions(options),
    ...options.compilerOptions,
    // A check reports; webpack emits.
    noEmit: true,
  };

  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, overrides, {
    ...ts.sys,
    getCurrentDirectory: () => context,
    onUnRecoverableConfigFileDiagnostic: (
      /** @type {Diagnostic} */ diagnostic,
    ) => unrecoverable.push(diagnostic),
  });

  if (!parsed) return { diagnostics: unrecoverable, host, files: [configFile] };

  const signature = `${configFile}\0${JSON.stringify(parsed.options)}`;

  // Nothing the last program was built from survives a change to how it is
  // built, so the whole of it is dropped rather than handed over.
  if (held.signature !== signature) {
    held.signature = signature;
    held.files = new Map();
    held.host = createHost(ts, parsed.options, held.files, held.seen);
    held.program = undefined;
  }

  held.seen.clear();
  held.program = ts.createSemanticDiagnosticsBuilderProgram(
    parsed.fileNames,
    parsed.options,
    held.host,
    held.program,
    parsed.errors,
    parsed.projectReferences,
  );

  const program = held.program.getProgram();
  const extended = parsed.options.configFile
    ? parsed.options.configFile.extendedSourceFiles || []
    : [];

  const diagnostics = [
    ...unrecoverable,
    ...ts.sortAndDeduplicateDiagnostics([
      ...program.getConfigFileParsingDiagnostics(),
      ...program.getOptionsDiagnostics(),
      ...held.program.getSyntacticDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...held.program.getSemanticDiagnostics(),
      ...(parsed.options.declaration || parsed.options.composite
        ? program.getDeclarationDiagnostics()
        : []),
    ]),
  ];

  // A file this program never asked for is one it no longer holds.
  for (const file of held.files.keys()) {
    if (!held.seen.has(file)) held.files.delete(file);
  }

  return {
    diagnostics,
    host,
    // The config file decides which files the program holds, so reading it
    // again is what a change to it takes.
    files: [configFile, ...extended, ...parsed.fileNames],
  };
}

/**
 * @param {CheckContext} context check context
 * @returns {Promise<CheckInstance>} typescript check
 */
async function create({ key, options, compilation }) {
  const ts = await importFrom(options.typescriptPath || "typescript");
  /** @type {TypeScript} */
  const typescript = ts.default || ts;

  const held = getHeld(
    compilation.compiler,
    `${key}\0${options.configFile || ""}`,
  );
  /** @type {EXPECTED_ANY} */
  let host;
  /** @type {string[]} */
  let read = [];
  // The program is the whole project, so it is built once however many batches
  // of files the plugin hands over.
  let checked = false;

  return {
    async lintFiles() {
      if (checked) return [];

      checked = true;

      const found = check(typescript, options, held);

      host = found.host;
      read = found.files;

      return found.diagnostics;
    },
    readFiles() {
      return read;
    },
    async getResults(results) {
      return results;
    },
    splitResults(results) {
      /** @type {Diagnostic[]} */
      const errors = [];
      /** @type {Diagnostic[]} */
      const warnings = [];

      for (const diagnostic of /** @type {Diagnostic[]} */ (results)) {
        if (diagnostic.category === typescript.DiagnosticCategory.Error) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      }

      return { errors, warnings };
    },
    async getFormatter(formatter) {
      if (typeof formatter === "function") {
        return async (results) => String(await formatter(results));
      }

      return async (results) =>
        typescript
          .formatDiagnosticsWithColorAndContext(
            /** @type {Diagnostic[]} */ (results),
            host,
          )
          .trim();
    },
    async cleanup() {},
  };
}

export { getTypeScriptOptions };

export default {
  name: "typescript",
  label: "TypeScript",
  // The program is the one the config file describes rather than the graph
  // webpack built, so a file nothing imports is still checked.
  filesSource: "glob",
  get schema() {
    return getSchemas().own;
  },
  defaults: {
    extensions: ["ts", "tsx", "mts", "cts"],
  },
  defaultExclude: () => "**/node_modules/**",
  create,
  // No `resultPath`: a diagnostic belongs to the program, not to the file the
  // plugin happened to hand over, so there is nothing to report a file from.
};
