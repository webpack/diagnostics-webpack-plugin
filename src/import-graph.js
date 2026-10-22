// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { toPosixPath } from "./utils.js";

/** @typedef {EXPECTED_ANY} TypeScript */

/**
 * What one file imports, as TypeScript resolves it.
 * @typedef {object} Imports
 * @property {string[]} resolved the files its imports resolve to
 * @property {boolean} unresolved whether a relative import resolved to nothing
 * @property {boolean} global whether it declares something every file can see
 */

/**
 * What is kept between rebuilds: each file's imports, read again only once
 * the file changes, and the compiler options of each config file.
 * @typedef {object} Graph
 * @property {TypeScript} ts the TypeScript the imports are resolved with
 * @property {Map<string, Imports>} files the imports of each file, by its path
 * @property {Map<string, string | undefined>} configs the config file nearest to each directory
 * @property {Map<string, EXPECTED_ANY>} options the compiler options of each config file
 */

// What the options of a directory no config file covers are taken as: what a
// bundler resolves, JavaScript included.
const FALLBACK_OPTIONS = { allowJs: true, moduleResolution: 100 };

/**
 * @param {TypeScript} ts the TypeScript the imports are resolved with
 * @returns {Graph} an empty graph
 */
function createGraph(ts) {
  return { ts, files: new Map(), configs: new Map(), options: new Map() };
}

/**
 * The compiler options a file is resolved under: those of the config file
 * nearest to it, which is the project typed linting reads it through.
 * @param {Graph} graph the graph
 * @param {string} file the file to resolve the imports of
 * @returns {EXPECTED_ANY} its compiler options
 */
function optionsFor(graph, file) {
  const { ts } = graph;
  const directory = dirname(file);

  if (!graph.configs.has(directory)) {
    graph.configs.set(
      directory,
      ts.findConfigFile(directory, ts.sys.fileExists) || undefined,
    );
  }

  const config = graph.configs.get(directory);

  if (!config) return FALLBACK_OPTIONS;

  if (!graph.options.has(config)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );

    graph.options.set(config, parsed ? parsed.options : FALLBACK_OPTIONS);
  }

  return graph.options.get(config);
}

/**
 * @param {Graph} graph the graph
 * @param {string} file the file to read the imports of
 * @returns {Imports | undefined} what it imports, or nothing when it is gone
 */
function readImports(graph, file) {
  const { ts } = graph;
  const text = ts.sys.readFile(file);

  if (text === undefined) return undefined;

  // Type-only imports included: they are what carries a type between files,
  // and what a bundler drops before webpack ever sees them.
  const info = ts.preProcessFile(text, true, true);
  const options = optionsFor(graph, file);
  /** @type {string[]} */
  const resolved = [];
  let unresolved = false;

  for (const { fileName } of info.importedFiles) {
    const found = ts.resolveModuleName(
      fileName,
      file,
      options,
      ts.sys,
    ).resolvedModule;

    if (found) resolved.push(toPosixPath(resolve(found.resolvedFileName)));
    else if (fileName.startsWith(".")) unresolved = true;
  }

  for (const { fileName } of info.referencedFiles) {
    resolved.push(toPosixPath(resolve(dirname(file), fileName)));
  }

  return {
    resolved,
    unresolved,
    // `declare global` and `declare module` reach files that never import the
    // one declaring them.
    global:
      info.ambientExternalModules !== undefined ||
      /\bdeclare\s+global\b/u.test(text),
  };
}

/**
 * Which files a change can have changed what typed linting says of: the ones
 * that changed, and every file importing one of them, however indirectly. A
 * typed rule reads a type only through the files TypeScript resolves, so the
 * files nothing changed is reachable from are answered for by their last run.
 * @param {Graph} graph what is known of the files from the last rebuild
 * @param {string[]} files every file the check covers
 * @param {string[]} changed the files that changed or went
 * @returns {Set<string> | undefined} the files to lint again, as posix paths, or nothing when every file has to be
 */
function affectedFiles(graph, files, changed) {
  const covered = new Set(files.map((file) => toPosixPath(resolve(file))));
  const touched = changed.map((file) => toPosixPath(resolve(file)));

  // A config file decides how every import resolves.
  if (touched.some((file) => graph.options.has(file))) {
    graph.files.clear();
    graph.configs.clear();
    graph.options.clear();

    return undefined;
  }

  for (const file of touched) {
    const before = graph.files.get(file);

    // What a file declared for every other one is gone once it changes, as
    // much as what it declares now is new.
    if (before && (before.global || before.unresolved)) return undefined;

    graph.files.delete(file);
  }

  /** @type {Map<string, string[]>} */
  const importers = new Map();

  for (const file of covered) {
    let imports = graph.files.get(file);

    if (!imports) {
      imports = readImports(graph, file);

      if (!imports) continue;

      graph.files.set(file, imports);
    }

    // A file whose own import resolves to nothing cannot be said to be
    // unreachable from what changed.
    if (imports.global || imports.unresolved) return undefined;

    for (const target of imports.resolved) {
      const list = importers.get(target);

      if (list) list.push(file);
      else importers.set(target, [file]);
    }
  }

  for (const file of touched) {
    // A file nothing here imports, and that is not one of these, reaches them
    // some other way: a declaration file every file sees, say.
    if (!covered.has(file) && !importers.has(file)) return undefined;
  }

  /** @type {Set<string>} */
  const reached = new Set();
  const queue = [...touched];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reached.has(file)) continue;

    reached.add(file);
    queue.push(...(importers.get(file) || []));
  }

  return new Set([...reached].filter((file) => covered.has(file)));
}

/**
 * The graphs a compiler keeps, one per check. A graph is changed by every
 * question asked of it — what changed is dropped from it, and a changed config
 * empties it — so two checks sharing one would each see the other's answer.
 * @type {WeakMap<EXPECTED_ANY, Map<string, Promise<Graph | undefined>>>}
 */
const graphsByCompiler = new WeakMap();

/**
 * The graph a compiler keeps for one check, read with the TypeScript the
 * check's project installs — the one its own tooling resolves imports with.
 * @param {EXPECTED_ANY} compiler the compiler the graph lives as long as
 * @param {string} context where the project's TypeScript is looked up from
 * @param {string} owner what tells the check from the compiler's others
 * @returns {Promise<Graph | undefined>} the graph, or nothing without a TypeScript to read it with
 */
function getGraph(compiler, context, owner) {
  let graphs = graphsByCompiler.get(compiler);

  if (!graphs) {
    graphs = new Map();
    graphsByCompiler.set(compiler, graphs);
  }

  const key = `${owner}\0${context}`;
  let graph = graphs.get(key);

  if (!graph) {
    graph = (async () => {
      try {
        const loaded = await import(
          pathToFileURL(
            createRequire(join(context, "package.json")).resolve("typescript"),
          ).href
        );

        return createGraph(loaded.default || loaded);
      } catch {
        // Without a TypeScript of the project's own there is nothing to say
        // which file reads which, and every file is linted again instead.
        return undefined;
      }
    })();

    graphs.set(key, graph);
  }

  return graph;
}

export { affectedFiles, createGraph, getGraph };
