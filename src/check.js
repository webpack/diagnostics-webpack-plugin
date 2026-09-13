// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import { isAbsolute, join } from "node:path";

import DiagnosticError from "./DiagnosticError.js";
import { reportedAs } from "./options.js";
import { toPosixPath } from "./utils.js";

/** @typedef {import("webpack").Compilation} Compilation */
/** @typedef {import("./checks/index.js").CheckResult} CheckResult */
/** @typedef {import("./checks/index.js").CheckInstance} CheckInstance */
/** @typedef {import("./options.js").EnabledCheck} EnabledCheck */
/** @typedef {{ filePath: string, content: string }} OutputReportContent */
/** @typedef {{ read: string[], directories: string[], missing: string[], writes: string[] }} Dependencies */
/** @typedef {Dependencies & { results: CheckResult[] }} Run */
/** @typedef {Dependencies & { errors?: DiagnosticError, warnings?: DiagnosticError, outputReport?: OutputReportContent }} Report */
/** @typedef {{ lint: (files: string[]) => void, keep: (files: string[]) => void, report: () => Promise<Report>, detach: (report: Promise<Report>) => void }} Runner */
/** @typedef {Map<string, CheckResult | undefined>} ResultStore */

/** @type {WeakMap<Compilation["compiler"], Map<string, ResultStore>>} */
const resultStores = new WeakMap();

/** @type {WeakMap<Compilation["compiler"], Map<string, Promise<void>>>} */
const detachedReports = new WeakMap();

// A run of a check that is still going, so that two compilers over the same
// files drive the tool once. It is kept only while it runs: what comes after
// belongs to the store of the compiler that made it.
/** @type {Map<string, Promise<Run>>} */
const sharedRuns = new Map();

// What only decides which files are checked, or how what is found is reported.
// The files are part of the key already, and the rest is not the tool's.
const NOT_SHARED = new Set([
  "exclude",
  "extensions",
  "files",
  "formatter",
  "outputReport",
  "reportAs",
  "resourceQueryExclude",
]);

/**
 * What tells one check's run of a tool from another's, so that only two runs
 * that would do the same work are shared.
 * @param {string} name the name of the check
 * @param {EnabledCheck["options"]} options the options it runs under
 * @returns {string | undefined} the key, or nothing when they cannot be compared
 */
function sharingKey(name, options) {
  /** @type {{ [option: string]: EXPECTED_ANY }} */
  const kept = {};

  for (const [option, value] of Object.entries(options)) {
    if (!NOT_SHARED.has(option)) kept[option] = value;
  }

  try {
    return `${name}\0${JSON.stringify(kept, (_, value) =>
      typeof value === "function" || value instanceof RegExp
        ? String(value)
        : value,
    )}`;
  } catch {
    // Options that cannot be written down are not options two runs can be
    // told apart by.
    return undefined;
  }
}

/**
 * The results of the last compilation, so a rebuild lints what webpack rebuilt
 * and reports the rest from here.
 * @param {Compilation} compilation compilation
 * @param {string} check a key unique to the check within the compiler
 * @returns {ResultStore} what the check last found in every file it covered
 */
function getResultStore(compilation, check) {
  const { compiler } = compilation;
  let stores = resultStores.get(compiler);

  if (!stores) {
    stores = new Map();
    resultStores.set(compiler, stores);
  }

  let store = stores.get(check);

  if (!store) {
    store = new Map();
    stores.set(check, store);
  }

  return store;
}

/**
 * The report of a run left to finish on its own, taken so that the next run of
 * the same check waits for it rather than driving a second tool beside it.
 * @param {Compilation} compilation compilation
 * @param {string} check a key unique to the check within the compiler
 * @returns {Promise<void> | undefined} the report still to land, if there is one
 */
function takeDetachedReport(compilation, check) {
  const reports = detachedReports.get(compilation.compiler);

  if (!reports) return undefined;

  const report = reports.get(check);

  reports.delete(check);

  return report;
}

/**
 * @param {Promise<CheckResult[]>[]} results results
 * @returns {Promise<CheckResult[]>} flattened results
 */
async function flatten(results) {
  /**
   * @param {CheckResult[]} acc acc
   * @param {CheckResult[]} list list
   * @returns {CheckResult[]} result
   */
  const flat = (acc, list) => [...acc, ...list];
  return (await Promise.all(results)).reduce(flat, []);
}

/**
 * Creates the runner synchronously so that the compilation hooks are tapped
 * before webpack starts building modules, whatever the tool takes to load. A
 * run the last compilation left to finish on its own is waited for first, so
 * that a check never has two of its tools running side by side.
 * @param {string} key a key unique to the compiler the check runs for
 * @param {EnabledCheck} check the check to run
 * @param {Compilation} compilation compilation
 * @returns {Runner} the runner collecting and reporting the results
 */
function createCheckRunner(key, { name, adapter, options }, compilation) {
  const checkKey = `${key}:${name}`;
  // A run of this check the last compilation left to finish on its own, which
  // is holding whatever the tool keeps between runs.
  const previous = takeDetachedReport(compilation, checkKey);
  // Left to run on its own rather than reported to the compilation, from where
  // a failure can no longer reach anyone.
  let detached = false;

  /**
   * @param {Error} err what the check failed with
   */
  function reportFailure(err) {
    if (detached) {
      compilation.compiler.getInfrastructureLogger(key).error(err.message);
      return;
    }

    compilation.errors.push(new DiagnosticError(name, err.message));
  }

  /** @type {Promise<CheckInstance | null>} */
  const pending = (previous || Promise.resolve())
    .then(() => adapter.create({ key, options, compilation }))
    .catch((err) => {
      reportFailure(err);
      return null;
    });

  /** @type {Promise<CheckResult[]>[]} */
  const rawResults = [];
  // Every path the store is keyed by goes through `toPosixPath`: webpack hands
  // over a module's resource with the separators the platform uses, and a
  // check answers with whatever its own tool wrote.
  const store = getResultStore(compilation, checkKey);
  // A check that cannot say which file a result came from is linted whole.
  const { resultPath } = adapter;
  /** @type {Set<string>} */
  const covered = new Set();
  // Kept as the check was given them rather than as the store keys them: these
  // are handed back to webpack, which compares paths the way the platform does.
  /** @type {Set<string>} */
  const read = new Set();
  /** @type {Set<string>} */
  const directories = new Set();
  /** @type {Set<string>} */
  const missing = new Set();
  /** @type {Set<string>} */
  const writes = new Set();
  const sharing = sharingKey(name, options);
  /** @type {Set<string>} */
  const linted = new Set();
  // A check that cannot lint fails the same way for every batch it is given.
  let failed = false;

  /**
   * What the check answers with, and what it says it read to answer — taken
   * together because a run another compiler joins is the only place the second
   * one can learn either.
   * @param {CheckInstance} instance the check to run
   * @param {string[]} files the files to lint
   * @returns {Promise<Run>} what that run of it found
   */
  function run(instance, files) {
    const key = sharing && `${sharing}\0${files.toSorted().join("\0")}`;
    const running = key ? sharedRuns.get(key) : undefined;

    if (running) return running;

    const started = instance.lintFiles(files).then((results) => ({
      results,
      read: instance.readFiles ? instance.readFiles() : [],
      directories: instance.readDirectories ? instance.readDirectories() : [],
      missing: instance.missingFiles ? instance.missingFiles() : [],
      writes: instance.writesTo ? instance.writesTo() : [],
    }));

    if (key) {
      const forget = () => sharedRuns.delete(key);

      sharedRuns.set(key, started);
      started.then(forget, forget);
    }

    return started;
  }

  /**
   * @param {string[]} files files
   */
  function lint(files) {
    for (const file of files) {
      const known = toPosixPath(file);

      read.add(file);
      covered.add(known);
      linted.add(known);
    }

    rawResults.push(
      pending
        .then(async (instance) => {
          if (!instance) return [];

          const outcome = await run(instance, files);

          for (const file of outcome.read) read.add(file);
          for (const directory of outcome.directories) {
            directories.add(directory);
          }
          for (const file of outcome.missing) missing.add(file);
          for (const path of outcome.writes) writes.add(path);

          return outcome.results;
        })
        .catch((err) => {
          if (!failed) {
            failed = true;
            reportFailure(err);
          }

          return [];
        }),
    );
  }

  /**
   * Reports a file from the last compilation rather than linting it again.
   * A file the store does not hold is linted: webpack restores a module from
   * its own cache without building it, and the first run of a compiler that
   * does so has nothing to report it from.
   * @param {string[]} files the files webpack did not rebuild
   */
  function keep(files) {
    if (!resultPath) {
      lint(files);
      return;
    }

    /** @type {string[]} */
    const unknown = [];

    for (const file of files) {
      const known = toPosixPath(file);

      read.add(file);

      if (store.has(known)) covered.add(known);
      else unknown.push(file);
    }

    if (unknown.length > 0) lint(unknown);
  }

  /**
   * Puts what was just linted into the store, drops what webpack no longer
   * builds, and answers with the results for every file this compilation
   * covers — the fresh ones and the ones kept from the last.
   * @param {CheckResult[]} results what the check produced this time
   * @returns {CheckResult[]} the results to report
   */
  function remember(results) {
    if (!resultPath) return results;

    // A check reports nothing for a file it found nothing in, so what was
    // linted is forgotten first and only what came back is put back.
    for (const file of linted) store.delete(file);

    // A result the check cannot put a file to is reported as it is: it is
    // this compilation's, and there is nothing to remember it under.
    /** @type {CheckResult[]} */
    const loose = [];

    for (const result of results) {
      const file = resultPath(result);

      if (file) store.set(toPosixPath(file), result);
      else loose.push(result);
    }

    // A file a check found nothing in is remembered as nothing found, which is
    // what tells a rebuild it has been linted at all.
    for (const file of linted) {
      if (!store.has(file)) store.set(file, undefined);
    }

    for (const file of store.keys()) {
      if (!covered.has(file)) store.delete(file);
    }

    return [...store.values(), ...loose].filter(Boolean);
  }

  /**
   * @returns {Promise<Report>} report
   */
  async function report() {
    const instance = await pending;

    /**
     * What a watcher has to follow for the check to answer the same way again.
     * @returns {Dependencies} the files, directories and absent files it read
     */
    const dependencies = () => ({
      read: [...read],
      directories: [...directories],
      missing: [...missing],
      writes: [...writes],
    });

    if (!instance) return dependencies();

    // Get the current results, resetting the raw results to empty.
    const raw = await flatten(rawResults.splice(0));

    // A check reading more than it was handed — a config file, a project the
    // graph does not describe — says so before anything is released. A run
    // this one joined has already said it for both of them.
    if (instance.readFiles) {
      for (const file of instance.readFiles()) read.add(file);
    }

    if (instance.readDirectories) {
      for (const directory of instance.readDirectories()) {
        directories.add(directory);
      }
    }

    if (instance.missingFiles) {
      for (const file of instance.missingFiles()) missing.add(file);
    }

    if (instance.writesTo) {
      for (const path of instance.writesTo()) writes.add(path);
    }

    await instance.cleanup();

    const results = remember(await instance.getResults(raw));

    // Do not analyze when the check reported nothing.
    if (!results || results.length === 0) {
      return dependencies();
    }

    const format = await instance.getFormatter(options.formatter);
    const { errors, warnings } = instance.splitResults(results);

    /** @type {Report} */
    const report = dependencies();

    // What `reportAs` drops is not formatted at all, but an `outputReport` is
    // still written from all of the results below.
    if (warnings.length > 0 && reportedAs(options.reportAs, "warnings")) {
      report.warnings = new DiagnosticError(name, await format(warnings));
    }

    if (errors.length > 0 && reportedAs(options.reportAs, "errors")) {
      report.errors = new DiagnosticError(name, await format(errors));
    }

    const { outputReport } = options;

    if (outputReport && outputReport.filePath) {
      const content = await (outputReport.formatter
        ? (await instance.getFormatter(outputReport.formatter))(results)
        : format(results));

      report.outputReport = {
        filePath: isAbsolute(outputReport.filePath)
          ? outputReport.filePath
          : join(compilation.compiler.outputPath, outputReport.filePath),
        content,
      };
    }

    return report;
  }

  /**
   * Says the report will not be awaited: a failure goes to the terminal rather
   * than to a compilation that can no longer carry it.
   * @param {Promise<Report>} report the report left to land on its own
   */
  function detach(report) {
    detached = true;

    let reports = detachedReports.get(compilation.compiler);

    if (!reports) {
      reports = new Map();
      detachedReports.set(compilation.compiler, reports);
    }

    reports.set(
      checkKey,
      report.then(
        () => {},
        () => {},
      ),
    );
  }

  return { detach, keep, lint, report };
}

export default createCheckRunner;
