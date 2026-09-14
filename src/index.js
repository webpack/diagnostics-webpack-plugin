import { readdirSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";

import picomatch from "picomatch";
import { globSync } from "tinyglobby";

import createCheckRunner from "./check.js";
import { getOptions, reportedAs, validateOptions } from "./options.js";
import {
  arrify,
  parseFiles,
  parseFoldersToGlobs,
  toPosixPath,
  writeOutputFile,
} from "./utils.js";

/** @typedef {import("webpack").Compilation} Compilation */
/** @typedef {import("webpack").Compiler} Compiler */
/** @typedef {import("webpack").Module} Module */
/** @typedef {import("webpack").NormalModule} NormalModule */
/** @typedef {import("./check.js").Dependencies} Dependencies */
/** @typedef {import("./check.js").Runner} Runner */
/** @typedef {import("./checks/index.js").CheckAdapter} CheckAdapter */
/** @typedef {import("./options.js").EnabledCheck} EnabledCheck */
/** @typedef {import("./options.js").CheckOptions} CheckOptions */
/** @typedef {import("./options.js").Options} Options */

/**
 * @typedef {object} ResolvedCheck
 * @property {string} name check name
 * @property {CheckAdapter} adapter the adapter running it
 * @property {CheckOptions} options options resolved for this check
 * @property {string[]} wanted the globs of the files to lint
 * @property {string[]} exclude the globs of the files not to lint
 * @property {"modules" | "glob"} filesSource where the check's files come from
 * @property {(file: string) => boolean} isWanted whether a path is one to lint
 * @property {(file: string) => boolean} isExcluded whether a path is left out
 */

const LINT_PLUGIN = "DiagnosticsWebpackPlugin";

// How many files webpack has to have built before a check is handed any of
// them, rather than all of them once the graph is done.
const EARLY_BATCH = 64;

let compilerId = 0;

/**
 * Walks the file system for the files a check wants, and says which of them
 * webpack has just seen change.
 * @param {Compiler} compiler compiler
 * @param {ResolvedCheck} check the check to collect the files of
 * @returns {{ lint: string[], keep: string[] }} the files to lint, and the ones to report from the last compilation
 */
function collectFromFileSystem(compiler, { adapter, wanted, exclude }) {
  // The walk is what says which files there are: one webpack never built is
  // one it cannot report as added, changed or gone either.
  const found = globSync(wanted, {
    absolute: true,
    dot: true,
    ignore: exclude,
  });
  const { modifiedFiles } = compiler;

  // A check that cannot say which file a result came from has nothing to report
  // a file it was not given from, so it is given all of them every time. One
  // that reads other files to answer for one is given all of them too: what it
  // said of a file it did not look at again was true of the files as they were.
  if (
    !modifiedFiles ||
    !adapter.resultPath ||
    (adapter.readsAcrossFiles && adapter.readsAcrossFiles(compiler))
  ) {
    return { lint: found, keep: [] };
  }

  const changed = new Set([...modifiedFiles].map((file) => toPosixPath(file)));
  /** @type {{ lint: string[], keep: string[] }} */
  const collected = { lint: [], keep: [] };

  for (const file of found) {
    collected[changed.has(toPosixPath(file)) ? "lint" : "keep"].push(file);
  }

  return collected;
}

/**
 * @param {string} directory the directory to answer for
 * @param {string} path the path it may hold
 * @returns {boolean} whether the directory is the path or holds it
 */
function contains(directory, path) {
  if (!path) return false;

  const inside = relative(directory, path);

  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/**
 * The directories a check's globs take their files from, which is where a file
 * it has never been handed appears.
 * @param {ResolvedCheck} check the check to answer for
 * @returns {string[]} the directories its globs are rooted at
 */
function globRoots({ filesSource, wanted }) {
  // A check reading the files webpack built has nothing to say about one
  // webpack does not build.
  if (filesSource !== "glob") return [];

  /** @type {Set<string>} */
  const roots = new Set();

  for (const pattern of wanted) {
    const { base, isGlob } = picomatch.scan(pattern);

    // A pattern naming one file is followed as that file rather than as the
    // folder it sits in.
    if (isGlob && base) roots.add(base);
  }

  return [...roots];
}

/**
 * Webpack rebuilds on a change anywhere under a directory it watches, so one
 * holding what the build writes, or what the check itself leaves out, is not a
 * directory to hand it.
 * @param {string} directory a directory a check reads from
 * @param {Compiler} compiler compiler
 * @param {ResolvedCheck} check the check that reads it
 * @param {string[]} writes the paths the check itself writes
 * @returns {boolean} whether the whole of it can be watched
 */
function canWatch(directory, compiler, check, writes) {
  const written = [compiler.outputPath, ...writes];

  if (written.some((path) => contains(directory, path))) return false;

  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        check.isExcluded(join(directory, entry.name))
      ) {
        return false;
      }
    }
  } catch {
    // A directory that cannot be read is not one to watch either.
    return false;
  }

  return true;
}

/**
 * Whether what a check finds can reach the compilation at all: results it
 * reports as `false` or as a log do not, and neither does a check whose
 * `outputReport` nothing writes.
 * @param {CheckOptions} options options resolved for the check
 * @returns {boolean} whether the build has to wait for it
 */
function isAdvisory(options) {
  if (options.outputReport && options.outputReport.filePath) return false;

  return /** @type {const} */ (["errors", "warnings"]).every((results) => {
    const severity = reportedAs(options.reportAs, results);

    return severity === false || severity === "log";
  });
}

class DiagnosticsWebpackPlugin {
  /**
   * @param {Options} options options
   */
  constructor(options = /** @type {Options} */ ({})) {
    this.key = LINT_PLUGIN;
    this.given = options;
    this.options = getOptions(options);
    this.run = this.run.bind(this);
  }

  /**
   * @param {Compiler} compiler compiler
   * @returns {void}
   */
  apply(compiler) {
    // Generate key for each compilation,
    // this differentiates one from the other when being cached.
    this.key = compiler.name || `${this.key}_${(compilerId += 1)}`;

    // Webpack's own hook, so its `validate: false` turns this off the way it
    // does for webpack's plugins.
    compiler.hooks.validate.tap(this.key, () => {
      validateOptions(compiler, this.given, this.options.checks);
    });

    /** @type {ResolvedCheck[] | undefined} */
    let checks;

    // Resolved on the first build rather than here, so that an option the
    // schema rejects is reported by the hook above and not by this.
    const getChecks = () => {
      if (!checks) {
        const context = this.getContext(compiler);

        checks = this.options.checks.map((check) =>
          this.resolveCheck(compiler, context, check),
        );
      }

      return checks;
    };

    // A build is nothing but a first compilation, so `lintOnStart` cannot
    // silence one without silencing the plugin.
    compiler.hooks.run.tapPromise(this.key, (compiler) =>
      this.run(compiler, getChecks()),
    );

    // A lint integration whose bundler reaches a file only once something
    // requests it defaults this off; webpack's first build walks all of them.
    let skipping = !this.options.lintOnStart;

    compiler.hooks.watchRun.tapPromise(this.key, (compiler) => {
      if (skipping) {
        skipping = false;

        return Promise.resolve();
      }

      return this.run(compiler, getChecks());
    });
  }

  /**
   * @param {Compiler} compiler compiler
   * @param {string} context context
   * @param {EnabledCheck} check the check to resolve the globs of
   * @returns {ResolvedCheck} the check with its globs resolved
   */
  resolveCheck(compiler, context, { name, adapter, options }) {
    const resourceQueries = arrify(options.resourceQueryExclude || []);

    /** @type {CheckOptions} */
    const resolved = {
      ...options,
      context,
      exclude: options.exclude
        ? parseFiles(options.exclude, context)
        : adapter.defaultExclude(compiler),
      extensions: arrify(options.extensions),
      files: parseFiles(options.files || "", context),
      resourceQueryExclude: resourceQueries.map(
        (/** @type {RegExp | string} */ item) =>
          item instanceof RegExp ? item : new RegExp(item),
      ),
    };

    const wanted = parseFoldersToGlobs(
      /** @type {string[]} */ (resolved.files),
      resolved.extensions,
    );
    const exclude = parseFoldersToGlobs(
      /** @type {string[]} */ (resolved.exclude),
    );

    return {
      name,
      adapter,
      options: resolved,
      // A check told which files to check looks at all of them, whether or not
      // webpack built them, whatever the check reads by itself.
      filesSource: options.files ? "glob" : adapter.filesSource,
      wanted,
      exclude,
      // Compiled here rather than per call: the two run on every module of
      // every build, and matching by pattern recompiles them each time.
      isWanted: picomatch(wanted, { dot: true }),
      isExcluded: picomatch(exclude, { dot: true }),
    };
  }

  /**
   * @param {Compiler} compiler compiler
   * @param {ResolvedCheck[]} checks the checks to run
   */
  async run(compiler, checks) {
    // Do not re-hook
    const isCompilerHooked = compiler.hooks.compilation.taps.find(
      ({ name }) => name === this.key,
    );

    if (isCompilerHooked) return;

    // What each check read the last time it reported, so that a rebuild whose
    // results land after it can still hand the watcher the files they cover.
    /** @type {Map<string, Dependencies>} */
    const readLast = new Map();
    // A report of an older compilation describes files that have been checked
    // again since, so it is dropped rather than printed after the newer one.
    let generation = 0;
    /** @type {(() => void)[]} */
    const afterBuild = [];

    // Where a check the build carries nothing of is started: the watcher has
    // its files by here, and nothing else wants the thread.
    compiler.hooks.done.tap(this.key, () => {
      for (const start of afterBuild.splice(0)) start();
    });

    /**
     * Leaves a check to finish after the build it was run for and prints what
     * it found once it does, to the terminal rather than to the stats a build
     * that is over has already had printed.
     * @param {string} name the name of the check
     * @param {Runner} runner the runner to leave running
     * @param {number} mine which compilation it was run for
     */
    const reportLate = (name, runner, mine) => {
      const report = runner.report();

      runner.detach(report);

      report.then(
        ({ errors, warnings, read, missing, directories, writes }) => {
          readLast.set(name, { read, missing, directories, writes });

          if (generation !== mine) return;

          const logger = compiler.getInfrastructureLogger(LINT_PLUGIN);

          if (errors) logger.error(errors.message);
          if (warnings) logger.warn(warnings.message);
        },
        (err) => {
          compiler.getInfrastructureLogger(LINT_PLUGIN).error(err.message);
        },
      );
    };

    compiler.hooks.compilation.tap(this.key, (compilation) => {
      generation += 1;

      const mine = generation;
      // Globbing the file system does not depend on the module graph, so a
      // child compilation would only lint what its parent already did.
      const enabled = compilation.compiler.isChild()
        ? checks.filter((check) => check.filesSource === "modules")
        : checks;

      if (enabled.length === 0) return;

      const runners = enabled.map((check) => {
        const runner = this.createRunner(check, compilation);
        // A check the build carries nothing of is run after it rather than
        // beside it, so that it takes the thread when nothing else wants it.
        // The first compilation is what tells the watcher which files it
        // reads, and a one-shot build has no later moment to report in.
        const late =
          compiler.watchMode &&
          !compilation.compiler.isChild() &&
          isAdvisory(check.options) &&
          readLast.has(check.name);
        /** @type {string[]} */
        const pending = [];
        /** @type {string[]} */
        const kept = [];
        let scheduled = false;

        const handOver = () => {
          scheduled = false;

          if (pending.length > 0) runner.lint(pending.splice(0));
          if (kept.length > 0) runner.keep(kept.splice(0));
        };

        // Linting starts while webpack is still building rather than after
        // it. A batch below the threshold waits for the end of the graph: a
        // check that parallelises its own work, as ESLint does under
        // `concurrency`, has nothing to spread across workers before then.
        const flush = (atEnd = false) => {
          if (late) return;

          if (!atEnd) {
            if (scheduled || pending.length < EARLY_BATCH) return;

            scheduled = true;
            setImmediate(() => flush(true));

            return;
          }

          handOver();
        };

        return {
          ...check,
          /** @type {string[]} */
          files: [],
          pending,
          kept,
          flush,
          handOver,
          late,
          runner,
        };
      });

      const fromModules = runners.filter(
        (check) => check.filesSource === "modules",
      );

      if (fromModules.length > 0) {
        /**
         * @param {Module} module module
         * @param {boolean} rebuilt whether webpack built the module this time
         */
        const addFile = (module, rebuilt) => {
          const { resource } = /** @type {NormalModule} */ (module);

          if (!resource) return;

          const [file, query] = resource.split("?");

          if (!file) return;

          for (const check of fromModules) {
            const { files, options } = check;
            const isFileNotListed = !files.includes(file);
            const isFileWanted =
              check.isWanted(file) && !check.isExcluded(file);
            const isQueryNotExclude = /** @type {RegExp[]} */ (
              options.resourceQueryExclude
            ).every((reg) => !reg.test(query));

            if (isFileNotListed && isFileWanted && isQueryNotExclude) {
              const keepable =
                rebuilt ||
                !check.adapter.readsAcrossFiles ||
                !check.adapter.readsAcrossFiles(compiler);

              files.push(file);
              (rebuilt || !keepable ? check.pending : check.kept).push(file);
              check.flush();
            }
          }
        };

        compilation.hooks.succeedModule.tap(this.key, (module) =>
          addFile(module, true),
        );

        // A module webpack did not rebuild is reported from the last run.
        if (this.options.lintOnStart) {
          compilation.hooks.stillValidModule.tap(this.key, (module) =>
            addFile(module, false),
          );
        }
      }

      // Nothing globbed from the file system waits on the module graph.
      for (const check of runners) {
        if (check.filesSource === "modules") continue;

        const collected = collectFromFileSystem(compiler, check);

        check.pending.push(...collected.lint);
        check.kept.push(...collected.keep);
        check.flush(true);
      }

      compilation.hooks.finishModules.tap(this.key, () => {
        for (const check of fromModules) check.flush(true);
      });

      // await and interpret results
      compilation.hooks.processAssets.tapAsync(
        this.key,
        async (_, callback) => {
          /** @type {Map<string, string[]>} */
          const outputReports = new Map();

          /**
           * Webpack watches what it built; a check reads what it was
           * configured to, which is not always the same set of files.
           * @param {ResolvedCheck} check the check that read them
           * @param {Dependencies} dependencies what a run of it read
           */
          const watch = (check, { read, missing, directories, writes }) => {
            // Each one is spelled the way the platform does: a watcher looks a
            // change up under the path it joined, not the one it was given.
            for (const file of read) {
              compilation.fileDependencies.add(normalize(file));
            }

            // A path an import resolved to nothing through is watched for the
            // file the author goes on to write there.
            for (const file of missing) {
              if (check.isExcluded(file)) continue;

              compilation.missingDependencies.add(normalize(file));
            }

            // A file that does not exist yet is under no watch of its own, so
            // the directory a check would find it in answers for it.
            const roots = [...globRoots(check), ...directories].filter(
              (directory) => canWatch(directory, compiler, check, writes),
            );

            for (const directory of roots) {
              // Watching a directory covers what is under it, so one inside
              // another of them is already answered for.
              if (
                roots.some(
                  (root) => root !== directory && contains(root, directory),
                )
              ) {
                continue;
              }

              compilation.contextDependencies.add(normalize(directory));
            }
          };

          for (const check of runners) {
            const { name, options, runner } = check;

            // What the build does not wait for is left for once it is over,
            // with the files the check read the last time it ran: what it
            // reads this time is not known until it is done, by which point
            // the watcher has been handed its list.
            if (check.late) {
              watch(check, /** @type {Dependencies} */ (readLast.get(name)));

              afterBuild.push(() => {
                check.handOver();
                reportLate(name, runner, mine);
              });

              continue;
            }

            const report = await runner.report();
            const {
              errors,
              warnings,
              outputReport,
              read,
              missing,
              directories,
              writes,
            } = report;

            readLast.set(name, { read, missing, directories, writes });
            watch(check, report);

            // `reportAs` has already dropped whatever it reports as `false`,
            // so what is left only needs putting where it belongs.
            for (const [results, reported] of /** @type {const} */ ([
              ["errors", errors],
              ["warnings", warnings],
            ])) {
              if (!reported) continue;

              const severity = reportedAs(options.reportAs, results);

              // Logged rather than reported: the terminal shows it, the build
              // carries neither an error nor a warning, and a dev server has
              // nothing to overlay.
              if (severity === "log") {
                const logger = compilation.getLogger(LINT_PLUGIN);

                if (results === "errors") logger.error(reported.message);
                else logger.warn(reported.message);

                continue;
              }

              (severity === "error"
                ? compilation.errors
                : compilation.warnings
              ).push(reported);
            }

            if (outputReport) {
              const contents = outputReports.get(outputReport.filePath) || [];

              contents.push(outputReport.content);
              outputReports.set(outputReport.filePath, contents);
            }
          }

          await Promise.all(
            [...outputReports].map(([filePath, contents]) =>
              writeOutputFile(compiler, filePath, contents.join("\n")),
            ),
          );

          callback();
        },
      );
    });
  }

  /**
   * @param {ResolvedCheck} check the check to create a runner for
   * @param {Compilation} compilation compilation
   * @returns {Runner} runner
   */
  createRunner({ name, adapter, options }, compilation) {
    return createCheckRunner(this.key, { name, adapter, options }, compilation);
  }

  /**
   * @param {Compiler} compiler compiler
   * @returns {string} context
   */
  getContext(compiler) {
    const compilerContext = String(compiler.options.context);
    const optionContext = this.options.context;

    if (!optionContext) return compilerContext;

    if (isAbsolute(optionContext)) return optionContext;

    return join(compilerContext, optionContext);
  }
}

export default DiagnosticsWebpackPlugin;
