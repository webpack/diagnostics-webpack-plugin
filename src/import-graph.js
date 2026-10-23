// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
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
 * @property {string[]} missing the relative imports that resolve to nothing, as written
 */

/**
 * A file as it was last read, kept while its size and time are the same.
 * @typedef {object} Read
 * @property {number} mtimeMs when it was last written
 * @property {number} size how long it is
 * @property {string} hash what it holds, hashed
 * @property {Imports} imports what it imports
 */

/**
 * What is kept between rebuilds: each file's imports, read again only once
 * the file changes, and the compiler options of each config file.
 * @typedef {object} Graph
 * @property {TypeScript} ts the TypeScript the imports are resolved with
 * @property {Map<string, Imports>} files the imports of each file, by its path
 * @property {Map<string, string | undefined>} configs the config file nearest to each directory
 * @property {Map<string, EXPECTED_ANY>} options the compiler options of each config file
 * @property {Map<string, Read>} reads every file read for a signature, as it was read
 * @property {Map<string, string>} configHashes each config file and what it extends, hashed, as the signatures were last read under
 * @property {Map<string, string>} faces what each file that changed showed the files importing it, as the last change left it, hashed
 */

// What the options of a directory no config file covers are taken as: what a
// bundler resolves, JavaScript included.
const FALLBACK_OPTIONS = { allowJs: true, moduleResolution: 100 };

/**
 * @param {TypeScript} ts the TypeScript the imports are resolved with
 * @returns {Graph} an empty graph
 */
function createGraph(ts) {
  return {
    ts,
    files: new Map(),
    configs: new Map(),
    options: new Map(),
    reads: new Map(),
    configHashes: new Map(),
    faces: new Map(),
  };
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
 * @param {string} file the file the text is of
 * @param {string} text what it holds
 * @returns {Imports} what it imports
 */
function importsOf(graph, file, text) {
  const { ts } = graph;

  // Type-only imports included: they are what carries a type between files,
  // and what a bundler drops before webpack ever sees them.
  const info = ts.preProcessFile(text, true, true);
  const options = optionsFor(graph, file);
  /** @type {string[]} */
  const resolved = [];
  /** @type {string[]} */
  const missing = [];

  for (const { fileName } of info.importedFiles) {
    const found = ts.resolveModuleName(
      fileName,
      file,
      options,
      ts.sys,
    ).resolvedModule;

    if (found) resolved.push(toPosixPath(resolve(found.resolvedFileName)));
    else if (fileName.startsWith(".")) missing.push(fileName);
  }

  for (const { fileName } of info.referencedFiles) {
    resolved.push(toPosixPath(resolve(dirname(file), fileName)));
  }

  return {
    resolved,
    unresolved: missing.length > 0,
    missing,
    // `declare global` and `declare module` reach files that never import the
    // one declaring them.
    global:
      info.ambientExternalModules !== undefined ||
      /\bdeclare\s+global\b/u.test(text),
  };
}

/**
 * @param {Graph} graph the graph
 * @param {string} file the file to read the imports of
 * @returns {Imports | undefined} what it imports, or nothing when it is gone
 */
function readImports(graph, file) {
  const text = graph.ts.sys.readFile(file);

  return text === undefined ? undefined : importsOf(graph, file, text);
}

/**
 * @param {string} text what to hash
 * @returns {string} its hash
 */
function hashOf(text) {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * What a file shows the files importing it: the declarations it emits, and
 * what it imports, which a rule following imports across files reads. Read
 * with `transpileDeclaration`, which needs no type checker and so answers only
 * for a file whose exports say their own types; for any other file, for a
 * TypeScript older than 5.5, and for what does not parse as TypeScript at all,
 * there is no answer.
 * @param {Graph} graph the graph
 * @param {string} file the file, as a posix path
 * @param {string} text what it holds
 * @param {Imports} imports what it imports
 * @returns {string | undefined} it, hashed, or nothing where it cannot be said
 */
function faceOf(graph, file, text, imports) {
  const { ts } = graph;

  if (typeof ts.transpileDeclaration !== "function") return undefined;

  try {
    const emitted = ts.transpileDeclaration(text, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { ...optionsFor(graph, file), declaration: true },
    });

    if (emitted.diagnostics && emitted.diagnostics.length > 0) {
      return undefined;
    }

    return hashOf(
      [
        emitted.outputText,
        ...imports.resolved.toSorted(),
        ...imports.missing.toSorted(),
      ].join("\0"),
    );
  } catch {
    return undefined;
  }
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
    graph.faces.clear();

    return undefined;
  }

  // The files whose change shows the files importing them nothing new: an
  // edit to the body of a function, a comment. Linted again themselves, but
  // what imports them is not, for what this edit did.
  /** @type {Set<string>} */
  const quiet = new Set();

  for (const file of touched) {
    const before = graph.files.get(file);

    // What a file declared for every other one is gone once it changes, as
    // much as what it declares now is new.
    if (before && (before.global || before.unresolved)) return undefined;

    graph.files.delete(file);

    const text = graph.ts.sys.readFile(file);

    if (text === undefined) {
      graph.faces.delete(file);
      continue;
    }

    const imports = importsOf(graph, file, text);
    const was = graph.faces.get(file);
    // Only a file that changed is read for it: the first edit of a file is
    // taken to reach everything importing it, and the next ones are told from
    // what it showed after that one.
    const face = faceOf(graph, file, text, imports);

    graph.files.set(file, imports);

    if (face === undefined) graph.faces.delete(file);
    else graph.faces.set(file, face);

    if (was !== undefined && was === face) quiet.add(file);
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
  /** @type {Set<string>} */
  const spread = new Set();
  // Each file with whether what it shows can have changed. A quiet file
  // reached through something it imports is not quiet any more: it can show
  // a changed type through an `export *` or a type it names.
  /** @type {[string, boolean][]} */
  const queue = touched.map((file) => [file, !quiet.has(file)]);

  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const [file, loud] = next;

    reached.add(file);

    if (!loud || spread.has(file)) continue;

    spread.add(file);

    for (const importer of importers.get(file) || []) {
      queue.push([importer, true]);
    }
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

/**
 * @param {string} file a resolved file
 * @returns {boolean} whether a package rather than the project holds it
 */
function isPackage(file) {
  return file.includes("/node_modules/");
}

/**
 * A file as it is now, read again only when its size or time has changed —
 * or when an import of it resolved to nothing, which a file written since can
 * answer.
 * @param {Graph} graph the graph
 * @param {string} file the file, as a posix path
 * @returns {Read | undefined} it, or nothing when it is not there
 */
function readNow(graph, file) {
  let stat;

  try {
    stat = statSync(file);
  } catch {
    graph.reads.delete(file);

    return undefined;
  }

  const known = graph.reads.get(file);

  if (
    known &&
    known.mtimeMs === stat.mtimeMs &&
    known.size === stat.size &&
    !known.imports.unresolved
  ) {
    return known;
  }

  const text = graph.ts.sys.readFile(file);

  if (text === undefined) return undefined;

  /** @type {Read} */
  const read = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashOf(text),
    imports: importsOf(graph, file, text),
  };

  graph.reads.set(file, read);

  return read;
}

/**
 * A config file as it is now: what it and the files it extends hold, hashed,
 * and the files the program it describes holds — read again every time, since
 * a file appearing under its `include` changes the second without the first.
 * @param {Graph} graph the graph
 * @param {string} config the config file
 * @returns {{ hash: string, sources: string[] }} it now
 */
function readConfig(graph, config) {
  const { ts } = graph;
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  const extended =
    (parsed &&
      parsed.options.configFile &&
      parsed.options.configFile.extendedSourceFiles) ||
    [];
  const text = [config, ...extended]
    .map((file) => `${file} ${ts.sys.readFile(file) ?? "gone"}`)
    .join("\n");

  return { hash: hashOf(text), sources: parsed ? parsed.fileNames : [] };
}

/**
 * What every file of a project answers to besides what it imports: the config
 * files its imports resolve through, and the declaration files and global
 * declarations of the programs they describe, which a file sees without
 * importing them.
 * @param {Graph} graph the graph
 * @param {Map<string, { hash: string, sources: string[] }>} configs the config files as they are now
 * @returns {string} what they hold, hashed
 */
function projectSignature(graph, configs) {
  /** @type {string[]} */
  const parts = [];

  for (const [config, { hash, sources }] of configs) {
    parts.push(`config ${config} ${hash}`);

    for (const source of sources) {
      const file = toPosixPath(resolve(source));

      if (isPackage(file)) continue;

      const known = readNow(graph, file);

      if (!known) continue;

      if (
        file.endsWith(".json") ||
        /\.d\.[cm]?ts$/u.test(file) ||
        known.imports.global
      ) {
        parts.push(`global ${file} ${known.hash}`);
      }
    }
  }

  return hashOf(parts.toSorted().join("\n"));
}

/**
 * What decides what a typed rule says of each file: the file, every file it
 * imports however indirectly, and what the whole project sees — so that a
 * result kept for a file is good for as long as this is the same, and no
 * longer. A package is read for when it was installed rather than for what it
 * holds.
 * @param {Graph} graph the graph
 * @param {string[]} files the files to answer for
 * @returns {Map<string, string>} the signature of each of them that can be read, by its posix path
 */
function signatures(graph, files) {
  const wanted = files.map((file) => toPosixPath(resolve(file)));

  // Read first, so that the config files they resolve through are known.
  for (const file of wanted) readNow(graph, file);

  /** @type {Map<string, { hash: string, sources: string[] }>} */
  let configs = new Map();

  for (const config of graph.options.keys()) {
    configs.set(config, readConfig(graph, config));
  }

  // A config file that changed decides how every import resolves, so what was
  // read under it is read again, under it as it is now.
  if (
    [...configs].some(
      ([config, { hash }]) => graph.configHashes.get(config) !== hash,
    ) &&
    graph.configHashes.size > 0
  ) {
    graph.reads.clear();
    graph.options.clear();
    graph.configs.clear();

    for (const file of wanted) readNow(graph, file);

    configs = new Map();

    for (const config of graph.options.keys()) {
      configs.set(config, readConfig(graph, config));
    }
  }

  graph.configHashes.clear();

  for (const [config, { hash }] of configs) {
    graph.configHashes.set(config, hash);
  }

  const project = projectSignature(graph, configs);
  /**
   * What each file says of itself, and what it imports, read once however
   * many of the closures reach it.
   * @type {Map<string, { parts: string[], imports: string[] }>}
   */
  const known = new Map();
  /**
   * @param {string} file the file, as a posix path
   * @returns {{ parts: string[], imports: string[] }} what it says of itself, and what it imports
   */
  const describe = (file) => {
    let described = known.get(file);

    if (described) return described;

    if (isPackage(file)) {
      let stat;

      try {
        stat = statSync(file);
      } catch {
        // Gone, which is what is said of it.
      }

      described = {
        parts: [`${file} ${stat ? `${stat.mtimeMs} ${stat.size}` : "gone"}`],
        imports: [],
      };
    } else {
      const read = readNow(graph, file);

      described = read
        ? {
            parts: [
              `${file} ${read.hash}`,
              ...read.imports.missing.map(
                (specifier) => `${file} misses ${specifier}`,
              ),
            ],
            imports: read.imports.resolved,
          }
        : { parts: [`${file} gone`], imports: [] };
    }

    known.set(file, described);

    return described;
  };
  /** @type {Map<string, string>} */
  const found = new Map();

  for (const file of wanted) {
    if (!graph.reads.has(file)) continue;

    /** @type {string[]} */
    const parts = [];
    const seen = new Set([file]);
    const queue = [file];

    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      const described = describe(next);

      parts.push(...described.parts);

      for (const target of described.imports) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }

    found.set(file, hashOf(`${project}\n${parts.toSorted().join("\n")}`));
  }

  return found;
}

export { affectedFiles, createGraph, getGraph, hashOf, signatures };
