// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { toPosixPath } from "../utils.js";

import { getTypeScriptOptions } from "./typescript-program.js";

/** @typedef {import("../options.js").CheckOptions} Options */
/**
 * What the native compiler says of one problem.
 * @typedef {{ fileName?: string, pos: number, end: number, code: number, category: number, text: string, messageChain?: NativeDiagnostic[] }} NativeDiagnostic
 */
/**
 * What a run answers with, described as a worker describes it.
 * @typedef {{ file?: string, code: string, severity: string, text: string, formatted: string }} Described
 */
/**
 * A client of the native compiler and what it last saw of the project.
 * @typedef {{ api: EXPECTED_ANY, error: number, snapshot: EXPECTED_ANY, files: Set<string>, turn: Promise<void> }} Native
 */

const nodeRequire = createRequire(import.meta.url);

/**
 * The API TypeScript 7 offers in place of the compiler it no longer exposes to
 * JavaScript, or nothing for an older TypeScript, which is checked in-process.
 * @param {string} specifier where TypeScript is found
 * @returns {Promise<EXPECTED_ANY>} the native API, if this is TypeScript 7 or later
 */
async function loadNative(specifier) {
  let manifest;

  try {
    manifest = nodeRequire.resolve(`${specifier}/package.json`);
  } catch {
    // A path to a module rather than to a package, as a test's stand-in is.
    return undefined;
  }

  const { version } = JSON.parse(readFileSync(manifest, "utf8"));

  if (Number(String(version).split(".")[0]) < 7) return undefined;

  // The package names itself, so its own exports resolve from inside it.
  const api = createRequire(manifest).resolve("typescript/unstable/async");

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
 * @returns {string} its message with every message it chains, as `tsc` joins them
 */
function flatten(diagnostic) {
  return [
    diagnostic.text,
    ...(diagnostic.messageChain || []).map(flatten),
  ].join(" ");
}

/**
 * Printed the way `tsc --pretty` prints one: where it is, what it is, and the
 * line it is on with the span underlined.
 * @param {NativeDiagnostic} diagnostic one of what a run found
 * @param {number} error what the native compiler numbers an error
 * @param {string} context what the file is named relative to
 * @param {Map<string, string>} texts the text each file was checked as
 * @returns {string} the diagnostic, formatted
 */
function format(diagnostic, error, context, texts) {
  const [color, category] =
    diagnostic.category === error ? [91, "error"] : [93, "warning"];
  const head = `\u001B[${color}m${category}\u001B[0m\u001B[90m TS${diagnostic.code}: \u001B[0m${flatten(diagnostic)}`;

  if (!diagnostic.fileName) return `${head}\n`;

  const text = texts.get(diagnostic.fileName) || "";

  const before = text.slice(0, diagnostic.pos).split(/\r?\n/u);
  const line = before.length;
  const column = before[before.length - 1].length + 1;
  const source = text.split(/\r?\n/u)[line - 1] || "";
  const width = Math.max(
    1,
    Math.min(diagnostic.end - diagnostic.pos, source.length - column + 1),
  );
  const gutter = String(line);

  return (
    `\u001B[96m${relative(context, diagnostic.fileName)}\u001B[0m:\u001B[93m${line}\u001B[0m:\u001B[93m${column}\u001B[0m - ${head}\n\n` +
    `\u001B[7m${gutter}\u001B[0m ${source}\n` +
    `\u001B[7m${" ".repeat(gutter.length)}\u001B[0m \u001B[91m${" ".repeat(column - 1)}${"~".repeat(width)}\u001B[0m\n`
  );
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
 * @returns {EXPECTED_ANY} the changes, in the shape `updateSnapshot` takes
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

  const context = String(options.context);
  const configFile = findConfigFile(options);
  const previous = native.snapshot;

  native.snapshot = await native.api.updateSnapshot(
    previous
      ? {
          openProjects: [configFile],
          fileChanges: changesSince(native, compiler),
        }
      : { openProjects: [configFile] },
  );

  if (previous) await previous.dispose();

  const project = native.snapshot.getProject(configFile);
  const { program } = project;
  const kinds = {
    syntactic: true,
    semantic: true,
    declaration: true,
    global: true,
    ...options.diagnosticOptions,
  };
  const { compilerOptions } = project;
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
  // The text each file was checked as, which is what the line under a
  // diagnostic is printed from, rather than what is on disk by now.
  const named = new Set(
    found
      .flat()
      .flatMap((diagnostic) =>
        diagnostic.fileName ? [diagnostic.fileName] : [],
      ),
  );
  /** @type {Map<string, string>} */
  const texts = new Map(
    await Promise.all(
      [...named].map(
        async (fileName) =>
          /** @type {[string, string]} */ ([
            fileName,
            ((await program.getSourceFile(fileName)) || { text: "" }).text,
          ]),
      ),
    ),
  );
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Described[]} */
  const diagnostics = [];

  for (const diagnostic of found.flat()) {
    // One kind can repeat what another reported, as `tsc` deduplicates.
    const key = `${diagnostic.fileName}\0${diagnostic.pos}\0${diagnostic.code}\0${diagnostic.text}`;

    if (seen.has(key)) continue;

    seen.add(key);
    diagnostics.push({
      file: diagnostic.fileName,
      // As `tsc` prints it, which is how `ignoreDiagnostics` names one too.
      code: `TS${diagnostic.code}`,
      // What is not an error is reported as a warning.
      severity: diagnostic.category === native.error ? "error" : "warning",
      text: flatten(diagnostic),
      formatted: format(diagnostic, native.error, context, texts),
    });
  }

  native.files = new Set((await program.getSourceFileNames()).map(keyOf));

  return {
    diagnostics,
    // The config file decides which files the program holds, so reading it
    // again is what a change to it takes.
    files: [configFile, ...project.rootFiles],
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
    api: new loaded.API({ cwd: String(options.context) }),
    error: loaded.DiagnosticCategory.Error,
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
  if (native.snapshot) await native.snapshot.dispose();

  await native.api.close();
}

export { checkNative, loadNative, startNative, stopNative };
