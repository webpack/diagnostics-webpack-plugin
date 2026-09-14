// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { statSync } from "node:fs";
import { createRequire } from "node:module";

import { omitPluginOptions } from "../utils.js";

/** @typedef {import("../options.js").CheckOptions} Options */

/** @typedef {EXPECTED_ANY} TypeScript */
/** @typedef {EXPECTED_ANY} Diagnostic */
/**
 * What one compilation leaves for the next: the files it parsed, the host that
 * hands them back, and the program that type checked them.
 * What a run of the check answers with: what it found, and what a watcher has
 * to follow for it to answer the same way again.
 * @typedef {{ diagnostics: Diagnostic[], host: EXPECTED_ANY, files: string[], directories: string[], writes: string[] }} Found
 */

/**
 * @typedef {{ signature: string, files: Map<string, EXPECTED_ANY>, seen: Set<string>, missing: Set<string>, host: EXPECTED_ANY, program: EXPECTED_ANY, programs: Map<string, EXPECTED_ANY>, readAt: number, dropped: Map<string, { text: string, time: Date }> }} Held
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
      missing: new Set(),
      host: undefined,
      program: undefined,
      programs: new Map(),
      readAt: 0,
      dropped: new Map(),
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

/** @type {WeakSet<EXPECTED_ANY>} */
const keeping = new WeakSet();

/**
 * A host answering with the source file it read last time for as long as the
 * file on disk is untouched, which is what a program has to be handed to reuse
 * the work of the one before it.
 * @param {EXPECTED_ANY} host the host to read through
 * @param {Map<string, EXPECTED_ANY>} files what was read, by path
 * @param {Set<string>} seen the paths this program asked for
 * @returns {EXPECTED_ANY} the same host
 */
function keepSourceFiles(host, files, seen) {
  if (keeping.has(host)) return host;

  keeping.add(host);

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

/**
 * @param {TypeScript} ts the loaded TypeScript
 * @param {EXPECTED_ANY} options the options the program is built with
 * @param {Map<string, EXPECTED_ANY>} files what was read, by path
 * @param {Set<string>} seen the paths this program asked for
 * @param {Set<string>} missing the paths it asked for and did not get
 * @returns {EXPECTED_ANY} the host
 */
function createHost(ts, options, files, seen, missing) {
  const host = ts.createCompilerHost(options);
  const exists = host.fileExists.bind(host);

  // Where an import that resolves to nothing is caught: the file the author
  // goes on to write is one of the paths the resolver tried here.
  host.fileExists = (/** @type {string} */ fileName) => {
    const found = exists(fileName);

    if (found) missing.delete(fileName);
    else missing.add(fileName);

    return found;
  };

  return keepSourceFiles(host, files, seen);
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
 * What a mode writes, and what it has to ask the compiler for so that there is
 * something to write. A check reports rather than builds, so nothing is written
 * unless a mode says otherwise.
 * @param {Options} options options
 * @returns {{ compilerOptions: EXPECTED_ANY, keeps: (file: string) => boolean }} what to ask for, and what to let through
 */
function writing(options) {
  const mode = options.mode || (options.build ? "write-dts" : "readonly");

  if (mode === "readonly") {
    // `tsc -b` refuses `noEmit` with TS6310, so a solution that writes nothing
    // is one whose writes are dropped rather than one that never made them.
    return {
      compilerOptions: options.build ? {} : { noEmit: true },
      keeps: () => false,
    };
  }

  const compilerOptions = {
    declaration: true,
    emitDeclarationOnly: mode === "write-dts",
    noEmit: false,
  };

  if (mode === "write-references") {
    return { compilerOptions, keeps: () => true };
  }

  const suffixes =
    mode === "write-dts"
      ? [".tsbuildinfo", ".d.ts", ".d.ts.map"]
      : [".tsbuildinfo"];

  return {
    compilerOptions,
    keeps: (file) => suffixes.some((suffix) => file.endsWith(suffix)),
  };
}

/**
 * Every project a config file references, built the way `tsc -b` does — which
 * is what a reference is for: a project reads the declarations of the one it
 * references rather than its sources.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Options} options options
 * @param {string} configFile the config file describing the solution
 * @param {EXPECTED_ANY} host the host diagnostics are formatted against
 * @param {Diagnostic[]} unrecoverable what reading the config file itself failed with
 * @param {Held} held what the last compilation left behind
 * @returns {Found} what it found, and what it read to find it
 */
function buildSolution(ts, options, configFile, host, unrecoverable, held) {
  /** @type {Diagnostic[]} */
  const diagnostics = [...unrecoverable];
  const files = [configFile];
  /** @type {string[]} */
  const directories = [];
  /** @type {string[]} */
  const writes = [];

  const emit = writing(options);
  const overrides = {
    ...getTypeScriptOptions(options),
    ...options.compilerOptions,
    ...emit.compilerOptions,
  };
  const signature = `build\0${configFile}\0${JSON.stringify(overrides)}`;

  // Nothing the last build was made of survives a change to how it is made.
  if (held.signature !== signature) {
    held.signature = signature;
    held.files = new Map();
    held.programs = new Map();
    held.readAt = 0;
    held.dropped = new Map();
  }

  held.seen.clear();

  /** @type {Set<string>} */
  const inputs = new Set();
  const readAt = Date.now();
  // `tsc -b` asks whether a project is up to date by reading how old its inputs
  // are next to the outputs of the last build. An edit made while that build
  // was running is older than what it went on to write, so it would be read as
  // up to date and reported as clean for as long as nothing else changed. What
  // answers that is the moment the last build started reading, not the moment
  // it finished writing.
  const system = {
    ...ts.sys,
    // What the build writes is what `mode` lets through. The rest is kept
    // where only this build can read it: a project reads the declarations of
    // the one it references, so dropping them outright would leave it
    // reporting that an output it needs was never built.
    writeFile: (
      /** @type {string} */ file,
      /** @type {string} */ text,
      /** @type {boolean=} */ byteOrderMark,
    ) => {
      if (emit.keeps(file)) {
        ts.sys.writeFile(file, text, byteOrderMark);

        return;
      }

      held.dropped.set(file, { text, time: new Date() });
    },
    readFile: (/** @type {string} */ file, /** @type {string=} */ encoding) => {
      const kept = held.dropped.get(file);

      return kept ? kept.text : ts.sys.readFile(file, encoding);
    },
    fileExists: (/** @type {string} */ file) =>
      held.dropped.has(file) || ts.sys.fileExists(file),
    getModifiedTime: (/** @type {string} */ file) => {
      const kept = held.dropped.get(file);

      if (kept) return kept.time;

      const modified = ts.sys.getModifiedTime(file);

      if (
        !held.readAt ||
        !modified ||
        !inputs.has(file) ||
        modified.getTime() < held.readAt
      ) {
        return modified;
      }

      return new Date(readAt);
    },
  };

  const builderHost = ts.createSolutionBuilderHost(
    system,
    // The builder makes a program per project, and a rebuild makes them over
    // again; each is handed the files and the program of the build before it.
    (
      /** @type {string[]} */ rootNames,
      /** @type {EXPECTED_ANY} */ compilerOptions,
      /** @type {EXPECTED_ANY} */ compilerHost,
      /** @type {EXPECTED_ANY} */ oldProgram,
      /** @type {Diagnostic[]} */ configFileParsingDiagnostics,
      /** @type {EXPECTED_ANY} */ projectReferences,
    ) => {
      const project = (rootNames || []).join("\0");
      const program = ts.createSemanticDiagnosticsBuilderProgram(
        rootNames,
        compilerOptions,
        keepSourceFiles(compilerHost, held.files, held.seen),
        held.programs.get(project) || oldProgram,
        configFileParsingDiagnostics,
        projectReferences,
      );

      held.programs.set(project, program);

      return program;
    },
    (/** @type {Diagnostic} */ diagnostic) => diagnostics.push(diagnostic),
    () => {},
    () => {},
  );
  const builder = ts.createSolutionBuilder(
    builderHost,
    [configFile],
    overrides,
  );
  const order = builder.getBuildOrder();

  // Read before the build, so that a project it stops short of is watched too.
  for (const project of Array.isArray(order) ? order : order.buildOrder) {
    const parsed = ts.getParsedCommandLineOfConfigFile(project, overrides, {
      ...ts.sys,
      getCurrentDirectory: () => String(options.context),
      onUnRecoverableConfigFileDiagnostic: (
        /** @type {Diagnostic} */ diagnostic,
      ) => diagnostics.push(diagnostic),
    });

    if (!parsed) continue;

    files.push(project, ...parsed.fileNames);
    directories.push(...Object.keys(parsed.wildcardDirectories || {}));

    for (const file of [project, ...parsed.fileNames]) inputs.add(file);

    for (const written of [
      parsed.options.outDir,
      parsed.options.declarationDir,
      parsed.options.tsBuildInfoFile,
    ]) {
      if (written) writes.push(String(written));
    }
  }

  builder.build();

  held.readAt = readAt;

  // A file no program asked for is one none of them holds.
  for (const file of held.files.keys()) {
    if (!held.seen.has(file)) held.files.delete(file);
  }

  return { diagnostics, host, files, directories, writes };
}

/**
 * The program the config file describes, with emit off: webpack writes the
 * output, so a check that wrote any of its own would fight it.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Options} options options
 * @param {Held} held what the last compilation left behind
 * @returns {Found} what it found, and what it read to find it
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

  // A solution is built rather than read: the projects it references have to
  // publish their declarations before the ones reading them can be checked.
  if (options.build) {
    return buildSolution(ts, options, configFile, host, unrecoverable, held);
  }

  // A check reports and webpack emits, unless `mode` asks for something to be
  // written as well.
  const emit = writing(options);
  const overrides = {
    ...getTypeScriptOptions(options),
    ...options.compilerOptions,
    ...emit.compilerOptions,
  };

  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, overrides, {
    ...ts.sys,
    getCurrentDirectory: () => context,
    onUnRecoverableConfigFileDiagnostic: (
      /** @type {Diagnostic} */ diagnostic,
    ) => unrecoverable.push(diagnostic),
  });

  if (!parsed) {
    return {
      diagnostics: unrecoverable,
      host,
      files: [configFile],
      directories: [],
      writes: [],
    };
  }

  const signature = `program\0${configFile}\0${JSON.stringify(parsed.options)}`;

  // Nothing the last program was built from survives a change to how it is
  // built, so the whole of it is dropped rather than handed over.
  if (held.signature !== signature) {
    held.signature = signature;
    held.files = new Map();
    held.host = createHost(
      ts,
      parsed.options,
      held.files,
      held.seen,
      held.missing,
    );
    held.program = undefined;
    held.programs = new Map();
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

  // What the config file itself is wrong about is reported whatever else is
  // turned off: nothing below it would be answering the right question.
  const kinds = {
    syntactic: true,
    semantic: true,
    declaration: true,
    global: true,
    ...options.diagnosticOptions,
  };
  const diagnostics = [
    ...unrecoverable,
    ...ts.sortAndDeduplicateDiagnostics([
      ...program.getConfigFileParsingDiagnostics(),
      ...program.getOptionsDiagnostics(),
      ...(kinds.syntactic ? held.program.getSyntacticDiagnostics() : []),
      ...(kinds.global ? program.getGlobalDiagnostics() : []),
      ...(kinds.semantic ? held.program.getSemanticDiagnostics() : []),
      ...(kinds.declaration &&
      (parsed.options.declaration || parsed.options.composite)
        ? program.getDeclarationDiagnostics()
        : []),
    ]),
  ];

  /** @type {string[]} */
  const writes = [];

  if (!overrides.noEmit) {
    for (const written of [
      parsed.options.outDir,
      parsed.options.declarationDir,
      parsed.options.tsBuildInfoFile,
    ]) {
      if (written) writes.push(String(written));
    }

    held.program.emit(
      undefined,
      (
        /** @type {string} */ file,
        /** @type {string} */ text,
        /** @type {boolean=} */ byteOrderMark,
      ) => {
        if (emit.keeps(file)) ts.sys.writeFile(file, text, byteOrderMark);
      },
    );
  }

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
    // What `include` covers, which is where a file the program has never held
    // can appear.
    directories: Object.keys(parsed.wildcardDirectories || {}),
    writes,
  };
}
/**
 * What a diagnostic says, as data: a `Diagnostic` holds the source file it was
 * found in, so this is what can be read once it has left the check.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Diagnostic} diagnostic one of what a run found
 * @returns {EXPECTED_ANY} what it says
 */
function describe(ts, diagnostic) {
  return {
    file: diagnostic.file ? diagnostic.file.fileName : undefined,
    // As `tsc` prints it, which is how `ignoreDiagnostics` names one too.
    code: `TS${diagnostic.code}`,
    severity:
      diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    text: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  };
}

export { check, describe, getHeld, getSchemas, getTypeScriptOptions };
