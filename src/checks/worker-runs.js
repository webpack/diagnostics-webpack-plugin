/**
 * The value a worker entry built for one run of a check, built on first use.
 * A thread of webpack's shared pool is not started for one check as a
 * jest-worker one is, so it is handed the setup with every call and keeps
 * what it built from it for the run that handed it over: a later run, which
 * may follow a change to the configuration, builds its own and replaces it.
 * One value per setup is kept, so two compilers linting on the same threads
 * at once keep one each, and a run that is over holds nothing.
 * @template T
 * @param {Map<string, { run: number, value: T }>} cache the entry's own cache
 * @param {number} run the run that handed the call over
 * @param {unknown[]} setupArgs what the entry needs to load its tool
 * @param {() => T} create builds the value for this run
 * @returns {T} the value for this run
 */
function forRun(cache, run, setupArgs, create) {
  // Keyed by the setup rather than the run: two copies of the plugin in one
  // process (its ESM and CommonJS builds) number their runs each from one.
  const key = JSON.stringify(setupArgs);
  const kept = cache.get(key);

  if (kept !== undefined && kept.run === run) return kept.value;

  const value = create();

  cache.set(key, { run, value });

  return value;
}

export { forRun };
