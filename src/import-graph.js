// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { keptFor } from "./compiler-state.js";
import { toPosixPath } from "./utils.js";

/** @typedef {EXPECTED_ANY} TypeScript */

/**
 * What one file imports, as TypeScript resolves it.
 * @typedef {object} Imports
 * @property {string[]} resolved the files its imports resolve to
 * @property {boolean} unresolved whether a relative import resolved to nothing
 * @property {boolean} global whether it declares something every file can see
 * @property {string[]} missing the relative imports that resolve to nothing, as written, assets included
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
 * @property {Map<EXPECTED_ANY, EXPECTED_ANY>} resolutions what each set of compiler options resolved this pass, so that every file in a folder does not look its imports up again
 * @property {Map<string, string>} faces what each file that changed showed the files importing it, as the last change left it, hashed
 * @property {Map<string, string>} texts what each file held when the watch started, kept until it first changes so that its first change is told from it
 * @property {Promise<void> | undefined} keeping the reading of what the files held when the watch started, which a rebuild waits for
 * @property {Set<string> | undefined} scripts what a file TypeScript reads ends in, read from it once
 * @property {string[] | undefined} typed what a TypeScript file, as against a JavaScript one, ends in, read from it once
 * @property {EXPECTED_ANY} fallback the options of a directory no config file covers
 */

/**
 * What the options of a directory no config file covers are taken as: what a
 * bundler resolves, JavaScript included. One object, which is what the
 * resolutions of a pass are kept against.
 * @param {Graph} graph the graph
 * @returns {EXPECTED_ANY} the options
 */
function fallbackOptions(graph) {
  if (!graph.fallback) {
    graph.fallback = {
      allowJs: true,
      moduleResolution: graph.ts.ModuleResolutionKind.Bundler,
    };
  }

  return graph.fallback;
}

/**
 * Whether an import names a file TypeScript has no types for — a stylesheet,
 * an image — which webpack bundles and no file written later turns into a
 * type. What counts as a script is TypeScript's to say, so a kind of asset
 * no one listed is still one.
 * @param {Graph} graph the graph
 * @param {string} fileName what the import names
 * @returns {boolean} whether it names an asset
 */
function isAsset(graph, fileName) {
  const extension = extname(fileName.split("?")[0]).toLowerCase();

  if (extension === "") return false;

  if (!graph.scripts) {
    graph.scripts = new Set([
      ...graph.ts.getSupportedExtensions({ allowJs: true }).flat(),
      graph.ts.Extension.Json,
    ]);
  }

  return !graph.scripts.has(extension);
}

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
    resolutions: new Map(),
    faces: new Map(),
    texts: new Map(),
    keeping: undefined,
    scripts: undefined,
    typed: undefined,
    fallback: undefined,
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

  if (!config) return fallbackOptions(graph);

  if (!graph.options.has(config)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );

    graph.options.set(config, parsed ? parsed.options : fallbackOptions(graph));
  }

  return graph.options.get(config);
}

/**
 * What the files of one set of compiler options resolved this pass. Kept for
 * no longer than a pass: a file written since can make an import that resolved
 * to nothing resolve, which an answer kept from before would hide.
 * @param {Graph} graph the graph
 * @param {EXPECTED_ANY} options the compiler options the imports are resolved under
 * @returns {EXPECTED_ANY} the cache TypeScript resolves them through
 */
function resolutionsFor(graph, options) {
  let cache = graph.resolutions.get(options);

  if (!cache) {
    const { ts } = graph;

    cache = ts.createModuleResolutionCache(
      ts.sys.getCurrentDirectory(),
      (/** @type {string} */ name) =>
        ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase(),
      options,
    );
    graph.resolutions.set(options, cache);
  }

  return cache;
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

  /** @type {string[]} */
  const assets = [];

  for (const { fileName } of info.importedFiles) {
    const found = ts.resolveModuleName(
      fileName,
      file,
      options,
      ts.sys,
      resolutionsFor(graph, options),
    ).resolvedModule;

    if (found) {
      resolved.push(toPosixPath(resolve(found.resolvedFileName)));
    } else if (!fileName.startsWith(".")) {
      continue;
    } else if (isAsset(graph, fileName) && !options.allowArbitraryExtensions) {
      // A stylesheet or an image is a module to webpack and nothing to
      // TypeScript, which no file written later turns into a type — unless
      // `allowArbitraryExtensions` reads one through a `.d.css.ts` beside it.
      assets.push(fileName);
    } else {
      missing.push(fileName);
    }
  }

  for (const { fileName } of info.referencedFiles) {
    resolved.push(toPosixPath(resolve(dirname(file), fileName)));
  }

  return {
    resolved,
    unresolved: missing.length > 0,
    // Still part of what a signature is read from, and of nothing else.
    missing: [...missing, ...assets],
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

  // A declaration file has nothing to emit, and TypeScript refuses to.
  if (
    typeof ts.transpileDeclaration !== "function" ||
    /\.d\.[^/]*ts$/u.test(file)
  ) {
    return undefined;
  }

  if (!graph.typed) graph.typed = ts.getSupportedExtensions({}).flat();

  // Only TypeScript says when it cannot write a type without a checker: the
  // exports of a JavaScript file are written `any` without a word, and no
  // change to them would show.
  if (
    !(/** @type {string[]} */ (graph.typed).some((one) => file.endsWith(one)))
  ) {
    return undefined;
  }

  const emitted = ts.transpileDeclaration(text, {
    fileName: file,
    reportDiagnostics: true,
    // Not the project's own options: the old text of a file and the new are
    // read alike either way, and some of them — `allowJs`, a `rootDir` the
    // file is outside of — make TypeScript refuse to read one at all.
    compilerOptions: {
      declaration: true,
      // What an importer's rules read and a project's own emit may drop: a
      // `@deprecated` in a comment, an `@internal` export.
      removeComments: false,
      stripInternal: false,
    },
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
  graph.resolutions.clear();

  const covered = new Set(files.map((file) => toPosixPath(resolve(file))));
  const touched = changed.map((file) => toPosixPath(resolve(file)));

  // A config file decides how every import resolves.
  if (touched.some((file) => graph.options.has(file))) {
    graph.files.clear();
    graph.configs.clear();
    graph.options.clear();
    graph.faces.clear();
    // What the files that changed held is not what was linted last any more.
    for (const file of touched) graph.texts.delete(file);

    return undefined;
  }

  // The files whose change shows the files importing them nothing new: an
  // edit to the body of a function, a comment. Linted again themselves, but
  // what imports them is not, for what this edit did.
  /** @type {Set<string>} */
  const quiet = new Set();

  for (const file of touched) {
    // What a file held before its first change, kept from when the watch
    // started, stands in for the face no change has left yet.
    const kept = graph.texts.get(file);
    const before =
      graph.files.get(file) ||
      (kept === undefined ? undefined : importsOf(graph, file, kept));

    // What a file declared for every other one is gone once it changes, as
    // much as what it declares now is new.
    if (before && (before.global || before.unresolved)) {
      // Every file is linted again, against what each one that changed holds
      // now: what any of them held or showed before says nothing any more.
      for (const other of touched) {
        graph.files.delete(other);
        graph.faces.delete(other);
        graph.texts.delete(other);
      }

      return undefined;
    }

    graph.files.delete(file);

    const text = graph.ts.sys.readFile(file);

    if (text === undefined) {
      graph.faces.delete(file);
      graph.texts.delete(file);
      continue;
    }

    const imports = importsOf(graph, file, text);
    let was = graph.faces.get(file);

    if (was === undefined && kept !== undefined && before) {
      was = faceOf(graph, file, kept, before);
    }

    graph.texts.delete(file);

    // Only a file that changed is read for it: one whose text was not kept
    // when the watch started is taken to reach everything importing it on its
    // first edit, and the next ones are told from what it showed after that.
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
 * Keeps what each file holds as a watch starts, so that its first change can
 * be told from what it showed before it as well as every later one is. A file
 * changed since webpack started reading the file system for the build is left
 * out: what it holds now may be the change rather than what came before it,
 * and its first change reaches everything importing it, as without this.
 * @param {Graph} graph the graph
 * @param {string[]} files every file the check covers
 * @param {number} since when webpack started reading the file system for the build
 * @returns {Promise<void>} once every file is kept or left out
 */
async function keepTexts(graph, files, since) {
  for (const file of files) {
    const known = toPosixPath(resolve(file));

    if (graph.texts.has(known) || graph.faces.has(known)) continue;

    try {
      const { mtimeMs } = await stat(known);

      if (mtimeMs >= since) continue;

      const text = await readFile(known, "utf8");

      // Written while it was read.
      if ((await stat(known)).mtimeMs !== mtimeMs) continue;

      graph.texts.set(known, text);
    } catch {
      // Gone, which its next change says.
    }
  }
}

/**
 * The graph a compiler keeps for one check, read with the TypeScript the
 * check's project installs — the one its own tooling resolves imports with.
 * @param {EXPECTED_ANY} compiler the compiler the graph lives as long as
 * @param {string} context where the project's TypeScript is looked up from
 * @param {string} owner what tells the check from the compiler's others
 * @returns {Promise<Graph | undefined>} the graph, or nothing without a TypeScript to read it with
 */
function getGraph(compiler, context, owner) {
  return keptFor(compiler, `graph\0${owner}\0${context}`, async () => {
    try {
      const loaded = await import(
        pathToFileURL(
          createRequire(join(context, "package.json")).resolve("typescript"),
        ).href
      );

      const ts = loaded.default || loaded;

      // TypeScript 7 is a native compiler whose package exports no such
      // API: what a file imports cannot be read through it.
      if (
        typeof ts.preProcessFile !== "function" ||
        typeof ts.resolveModuleName !== "function" ||
        !ts.sys
      ) {
        return undefined;
      }

      return createGraph(ts);
    } catch {
      // Without a TypeScript of the project's own there is nothing to say
      // which file reads which, and every file is linted again instead.
      return undefined;
    }
  });
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
 * @param {Map<string, { hash: string, sources: string[] }>} configs the config files as they are now
 * @param {(file: string) => Read | undefined} read reads a file as it is now
 * @returns {string} what they hold, hashed
 */
function projectSignature(configs, read) {
  /** @type {string[]} */
  const parts = [];

  for (const [config, { hash, sources }] of configs) {
    parts.push(`config ${config} ${hash}`);

    for (const source of sources) {
      const file = toPosixPath(resolve(source));

      if (isPackage(file)) continue;

      const known = read(file);

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
 * holds. One signer answers for one build, which hands it its files in batches:
 * what it read for one batch is not read again for the next.
 * @param {Graph} graph the graph
 * @returns {(files: string[]) => Map<string, string>} the signature of each of the files given that can be read, by its posix path
 */
function createSigner(graph) {
  graph.resolutions.clear();

  /**
   * The files read in this build, whether or not they were there.
   * @type {Set<string>}
   */
  const checked = new Set();
  /** @type {Map<string, { hash: string, sources: string[] }>} */
  const configsRead = new Map();
  /** @type {{ configs: Map<string, { hash: string, sources: string[] }>, signature: string } | undefined} */
  let project;

  /**
   * @param {string} file the file, as a posix path
   * @returns {Read | undefined} it as it is in this build
   */
  const read = (file) => {
    if (checked.has(file)) return graph.reads.get(file);

    checked.add(file);

    return readNow(graph, file);
  };

  /**
   * @returns {Map<string, { hash: string, sources: string[] }>} every config file read so far, as it is in this build
   */
  const readConfigs = () => {
    /** @type {Map<string, { hash: string, sources: string[] }>} */
    const configs = new Map();

    for (const config of graph.options.keys()) {
      let now = configsRead.get(config);

      if (!now) {
        now = readConfig(graph, config);
        configsRead.set(config, now);
      }

      configs.set(config, now);
    }

    return configs;
  };
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
      const now = read(file);

      described = now
        ? {
            parts: [
              `${file} ${now.hash}`,
              ...now.imports.missing.map(
                (specifier) => `${file} misses ${specifier}`,
              ),
            ],
            imports: now.imports.resolved,
          }
        : { parts: [`${file} gone`], imports: [] };
    }

    known.set(file, described);

    return described;
  };
  // Every file reaching another is signed by what that one is signed by, so a
  // change anywhere below a file changes it, and each file is read once rather
  // than once per file importing it. The files of an import cycle reach the
  // same files, and are signed together, as strongly connected components.
  /** @type {Map<string, string>} */
  const signed = new Map();
  /** @type {Map<string, number>} */
  const order = new Map();
  /** @type {Map<string, number>} */
  const lowest = new Map();
  /** @type {string[]} */
  const open = [];
  /** @type {Set<string>} */
  const onOpen = new Set();

  /**
   * @param {string} file the file, as a posix path
   */
  const enter = (file) => {
    order.set(file, order.size);
    lowest.set(file, order.size - 1);
    open.push(file);
    onOpen.add(file);
  };

  /**
   * Signs the cycle `file` opened, now that everything it imports is signed.
   * @param {string} file the first file of the cycle reached
   */
  const close = (file) => {
    /** @type {Set<string>} */
    const members = new Set();

    for (let member = open.pop(); ; member = open.pop()) {
      const known = /** @type {string} */ (member);

      onOpen.delete(known);
      members.add(known);

      if (known === file) break;
    }

    /** @type {string[]} */
    const parts = [];
    /** @type {Set<string>} */
    const below = new Set();

    for (const member of members) {
      const described = describe(member);

      parts.push(...described.parts);

      for (const target of described.imports) {
        if (!members.has(target)) {
          below.add(/** @type {string} */ (signed.get(target)));
        }
      }
    }

    const signature = hashOf(
      `${parts.toSorted().join("\n")}\n\n${[...below].toSorted().join("\n")}`,
    );

    for (const member of members) signed.set(member, signature);
  };

  return (files) => {
    const wanted = files.map((file) => toPosixPath(resolve(file)));

    // Read first, so that the config files they resolve through are known.
    for (const file of wanted) read(file);

    let configs = readConfigs();

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
      checked.clear();
      configsRead.clear();
      known.clear();
      signed.clear();
      order.clear();
      lowest.clear();
      project = undefined;

      for (const file of wanted) read(file);

      configs = readConfigs();
    }

    graph.configHashes.clear();

    for (const [config, { hash }] of configs) {
      graph.configHashes.set(config, hash);
    }

    const kept = project;
    const current =
      !kept ||
      kept.configs.size !== configs.size ||
      [...configs].some(([config, now]) => kept.configs.get(config) !== now)
        ? { configs, signature: projectSignature(configs, read) }
        : kept;

    project = current;

    const projectSigned = current.signature;

    for (const root of wanted) {
      if (!graph.reads.has(root) || order.has(root)) continue;

      enter(root);

      /** @type {[string, number][]} */
      const stack = [[root, 0]];

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const [file, next] = frame;
        const { imports } = describe(file);

        if (next < imports.length) {
          const target = imports[next];

          frame[1] = next + 1;

          if (!order.has(target)) {
            enter(target);
            stack.push([target, 0]);
          } else if (onOpen.has(target)) {
            lowest.set(
              file,
              Math.min(
                /** @type {number} */ (lowest.get(file)),
                /** @type {number} */ (order.get(target)),
              ),
            );
          }

          continue;
        }

        stack.pop();

        if (stack.length > 0) {
          const [parent] = stack[stack.length - 1];

          lowest.set(
            parent,
            Math.min(
              /** @type {number} */ (lowest.get(parent)),
              /** @type {number} */ (lowest.get(file)),
            ),
          );
        }

        if (lowest.get(file) === order.get(file)) close(file);
      }
    }

    /** @type {Map<string, string>} */
    const found = new Map();

    for (const file of wanted) {
      const signature = signed.get(file);

      if (signature !== undefined) {
        found.set(file, hashOf(`${projectSigned}\n${signature}`));
      }
    }

    return found;
  };
}

/**
 * The signatures of files signed on their own, as one batch of a build.
 * @param {Graph} graph the graph
 * @param {string[]} files the files to answer for
 * @returns {Map<string, string>} the signature of each of them that can be read, by its posix path
 */
function signatures(graph, files) {
  return createSigner(graph)(files);
}

export {
  affectedFiles,
  createGraph,
  createSigner,
  getGraph,
  hashOf,
  keepTexts,
  signatures,
};
