// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { toPosixPath } from "../utils.js";

import { getTypeScriptOptions } from "./typescript-program.js";

/** @typedef {import("../options.js").CheckOptions} Options */
/**
 * What the native compiler says of one problem.
 * @typedef {{ fileName?: string, code: number, category: number, text: string, messageChain?: NativeDiagnostic[] }} NativeDiagnostic
 */
/**
 * What a run answers with, described as a worker describes it.
 * @typedef {{ file?: string, code: string, severity: string, text: string, formatted: string }} Described
 */
/**
 * A client of the native compiler and what it last saw of the project.
 * @typedef {{ loaded: EXPECTED_ANY, api: EXPECTED_ANY, snapshot: EXPECTED_ANY, files: Set<string>, turn: Promise<void> }} Native
 */

const nodeRequire = createRequire(import.meta.url);

/**
 * The API a TypeScript with a native compiler ships in place of a compiler
 * API in JavaScript, or nothing for a TypeScript checked in-process. Told by
 * what the package exports rather than by its version.
 * @param {string} specifier where TypeScript is found
 * @returns {Promise<EXPECTED_ANY>} the native API, if the package ships one
 */
async function loadNative(specifier) {
  let manifest;

  try {
    manifest = nodeRequire.resolve(`${specifier}/package.json`);
  } catch {
    // A path to a module rather than to a package, as a test's stand-in is.
    return undefined;
  }

  const { name, exports } = JSON.parse(readFileSync(manifest, "utf8"));

  if (!exports || !exports["./async"]) return undefined;

  // The package names itself, so its own exports resolve from inside it.
  const api = createRequire(manifest).resolve(`${name}/async`);

  return import(pathToFileURL(api).href);
}

/**
 * What only the JavaScript compiler can do: the native one reads a config file
 * as it is written, and checks without building or writing anything.
 * @param {Options} options the options the check was configured with
 * @returns {string | undefined} what cannot be honoured, if anything
 */
function unsupported(options) {
  if (options.build) return "`build`";

  if (options.mode && options.mode !== "readonly") {
    return `\`mode: "${options.mode}"\``;
  }

  const overrides = {
    ...getTypeScriptOptions(options),
    ...options.compilerOptions,
  };

  if (Object.keys(overrides).length > 0) {
    return `compiler options written in the plugin (${Object.keys(overrides)
      .map((option) => `\`${option}\``)
      .join(", ")})`;
  }

  return undefined;
}

/**
 * The config file a check reads: the one named, or the nearest one above the
 * context, as `tsc` finds it.
 * @param {Options} options the options the check was configured with
 * @returns {string} the config file
 */
function findConfigFile(options) {
  const context = String(options.context);

  if (options.configFile) return resolve(context, String(options.configFile));

  for (let directory = context; ; directory = dirname(directory)) {
    const candidate = join(directory, "tsconfig.json");

    if (existsSync(candidate)) return candidate;

    if (dirname(directory) === directory) {
      throw new Error(
        `no 'tsconfig.json' was found above '${context}', and none was named by 'configFile'.`,
      );
    }
  }
}

/**
 * @param {NativeDiagnostic} diagnostic one of what a run found
 * @returns {string} its message with every message it chains
 */
function flatten(diagnostic) {
  return [
    diagnostic.text,
    ...(diagnostic.messageChain || []).map(flatten),
  ].join(" ");
}

/**
 * A path as the native compiler and webpack can both be matched by: webpack
 * spells one with the platform's separators, the compiler with forward
 * slashes, and Windows tells no case apart.
 * @param {string} file a path
 * @returns {string} what it is known by
 */
function keyOf(file) {
  const posix = toPosixPath(resolve(file));

  return process.platform === "win32" ? posix.toLowerCase() : posix;
}

/**
 * Tells the native compiler what changed since it last looked: webpack knows,
 * so nothing has to be read again to find out.
 * @param {Native} native the client and what it last saw
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @returns {EXPECTED_ANY} the changes, in the shape `fileNotifications` takes
 */
function changesSince(native, compiler) {
  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const created = [];

  for (const file of compiler.modifiedFiles || []) {
    if (native.files.has(keyOf(file))) {
      changed.push(file);
      continue;
    }

    // Gone again, which is what `removedFiles` says, or a folder.
    const stat = statSync(file, { throwIfNoEntry: false });

    if (stat && stat.isFile()) created.push(file);
  }

  return {
    changed,
    created,
    deleted: [...(compiler.removedFiles || [])],
  };
}

/**
 * One run of `checkNative`, with the snapshot to itself.
 * @param {Native} native the client and what it last saw
 * @param {Options} options the options the check was configured with
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @returns {Promise<{ diagnostics: Described[], files: string[], directories: string[] }>} what it found, and what it read to find it
 */
async function checkOnce(native, options, compiler) {
  const cannot = unsupported(options);

  if (cannot) {
    throw new Error(
      `TypeScript 7 checks a project as its config file describes it, so ${cannot} cannot be used with it.`,
    );
  }

  const configFile = findConfigFile(options);
  const previous = native.snapshot;

  native.snapshot = previous
    ? await previous.update({
        openProjects: [configFile],
        fileNotifications: changesSince(native, compiler),
        // Brought up to date now rather than on the first question asked.
        ensurePrograms: true,
      })
    : await native.api.createSnapshot({ openProjects: [configFile] });

  if (previous) await previous.dispose();

  const project = native.snapshot.getConfiguredProject(configFile);
  const { program, parsedCommandLine } = project;
  const kinds = {
    syntactic: true,
    semantic: true,
    declaration: true,
    global: true,
    ...options.diagnosticOptions,
  };
  const compilerOptions = parsedCommandLine.options;
  /** @type {NativeDiagnostic[][]} */
  const found = await Promise.all([
    program.getConfigFileParsingDiagnostics(),
    program.getProgramDiagnostics(),
    kinds.syntactic ? program.getSyntacticDiagnostics() : [],
    kinds.global ? program.getGlobalDiagnostics() : [],
    kinds.declaration &&
    (compilerOptions.declaration || compilerOptions.composite)
      ? program.getDeclarationDiagnostics()
      : [],
    kinds.semantic ? program.getSemanticDiagnostics() : [],
  ]);
  const { DiagnosticCategory, formatDiagnosticsWithColorAndContext } =
    native.loaded;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Described[]} */
  const diagnostics = [];

  for (const diagnostic of found.flat()) {
    // One kind can repeat what another reported, as `tsc` deduplicates.
    const key = JSON.stringify(diagnostic);

    if (seen.has(key)) continue;

    seen.add(key);
    diagnostics.push({
      file: diagnostic.fileName,
      // As `tsc` prints it, which is how `ignoreDiagnostics` names one too.
      code: `TS${diagnostic.code}`,
      // What is not an error is reported as a warning.
      severity:
        diagnostic.category === DiagnosticCategory.Error ? "error" : "warning",
      text: flatten(diagnostic),
      formatted: formatDiagnosticsWithColorAndContext([diagnostic], native.api),
    });
  }

  // The config file and every one it extends, which decide which files the
  // program holds, so that a change to one of them is told as a change too.
  const configs = await program.getConfigFileNames();

  native.files = new Set(
    [...(await program.getSourceFileNames()), ...configs].map(keyOf),
  );

  return {
    diagnostics,
    files: [...configs, ...parsedCommandLine.fileNames],
    // Where a file the program has never held can appear.
    directories: [dirname(configFile)],
  };
}

/**
 * Checks the program the config file describes with the native compiler, which
 * runs in a process of its own: webpack's thread only waits for the answer.
 * @param {Native} native the client and what it last saw
 * @param {Options} options the options the check was configured with
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @returns {Promise<{ diagnostics: Described[], files: string[], directories: string[] }>} what it found, and what it read to find it
 */
function checkNative(native, options, compiler) {
  // Compilers sharing the process take turns: a run replaces the snapshot and
  // disposes of the last, which another run may still be reading.
  const run = native.turn.then(() => checkOnce(native, options, compiler));

  native.turn = run.then(
    () => {},
    () => {},
  );

  return run;
}

/**
 * Starts a client of the native compiler, which spawns a process of its own.
 * @param {EXPECTED_ANY} loaded what `loadNative` loaded
 * @param {Options} options the options the check was configured with
 * @returns {Native} the client, with nothing seen yet
 */
function startNative(loaded, options) {
  return {
    loaded,
    api: new loaded.API({ cwd: String(options.context) }),
    snapshot: undefined,
    files: new Set(),
    turn: Promise.resolve(),
  };
}

/**
 * @param {Native} native the client to stop, and the process it spawned
 * @returns {Promise<void>} once it is closed
 */
async function stopNative(native) {
  // A run still going is let finish rather than left reading a snapshot gone.
  await native.turn;

  if (native.snapshot) await native.snapshot.dispose();

  await native.api.close();
}

export { checkNative, loadNative, startNative, stopNative };
