import { isAbsolute, join, normalize } from "node:path";

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
  // a file it was not given from, so it is given all of them every time.
  if (!modifiedFiles || !adapter.resultPath) return { lint: found, keep: [] };

  const changed = new Set([...modifiedFiles].map((file) => toPosixPath(file)));
  /** @type {{ lint: string[], keep: string[] }} */
  const collected = { lint: [], keep: [] };

  for (const file of found) {
    collected[changed.has(toPosixPath(file)) ? "lint" : "keep"].push(file);
  }

  return collected;
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

    const validateGiven = () => {
      validateOptions(compiler, this.given, this.options.checks);
    };

    // The hook, and webpack's `validate: false` with it, arrived in 5.106.
    if (compiler.hooks.validate) {
      compiler.hooks.validate.tap(this.key, validateGiven);
    } else {
      validateGiven();
    }

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

    compiler.hooks.compilation.tap(this.key, (compilation) => {
      // Globbing the file system does not depend on the module graph, so a
      // child compilation would only lint what its parent already did.
      const enabled = compilation.compiler.isChild()
        ? checks.filter(({ adapter }) => adapter.filesSource === "modules")
        : checks;

      if (enabled.length === 0) return;

      const runners = enabled.map((check) => {
        const runner = this.createRunner(check, compilation);
        /** @type {string[]} */
        const pending = [];
        /** @type {string[]} */
        const kept = [];
        let scheduled = false;

        // Linting starts while webpack is still building rather than after
        // it. A batch below the threshold waits for the end of the graph: a
        // check that parallelises its own work, as ESLint does under
        // `concurrency`, has nothing to spread across workers before then.
        const flush = (atEnd = false) => {
          if (!atEnd) {
            if (scheduled || pending.length < EARLY_BATCH) return;

            scheduled = true;
            setImmediate(() => flush(true));

            return;
          }

          scheduled = false;

          if (pending.length > 0) runner.lint(pending.splice(0));
          if (kept.length > 0) runner.keep(kept.splice(0));
        };

        return {
          ...check,
          /** @type {string[]} */
          files: [],
          pending,
          kept,
          flush,
          runner,
        };
      });

      const fromModules = runners.filter(
        ({ adapter }) => adapter.filesSource === "modules",
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
              files.push(file);
              (rebuilt ? check.pending : check.kept).push(file);
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
        if (check.adapter.filesSource === "modules") continue;

        const collected = collectFromFileSystem(compiler, check);

        if (collected.lint.length > 0) check.runner.lint(collected.lint);
        if (collected.keep.length > 0) check.runner.keep(collected.keep);
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

          for (const { options, runner } of runners) {
            const { errors, warnings, outputReport, read } =
              await runner.report();

            // Webpack watches what it built; a check reads what it was
            // configured to, which is not always the same set of files. Each
            // one is spelled the way the platform does: a watcher looks a
            // change up under the path it joined, not the one it was given.
            for (const file of read) {
              compilation.fileDependencies.add(normalize(file));
            }

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
