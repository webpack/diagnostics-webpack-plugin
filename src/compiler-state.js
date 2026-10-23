// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

/**
 * What lives as long as a compiler does rather than as long as one of its
 * builds — a check's results, the program it keeps, the graph it reads — and
 * the workers and processes compilers share, in one place, so that every check
 * keeps and lets go of them the same way.
 */

/** @type {WeakMap<EXPECTED_ANY, Map<string, EXPECTED_ANY>>} */
const keptByCompiler = new WeakMap();

/**
 * What a compiler keeps under a key, made the first time it is asked for. It
 * goes when the compiler does.
 * @template T
 * @param {EXPECTED_ANY} compiler the compiler it lives as long as
 * @param {string} key what tells it from the compiler's other state
 * @param {() => T} create makes it the first time
 * @returns {T} what the compiler keeps under the key
 */
function keptFor(compiler, key, create) {
  let kept = keptByCompiler.get(compiler);

  if (!kept) {
    kept = new Map();
    keptByCompiler.set(compiler, kept);
  }

  if (!kept.has(key)) kept.set(key, create());

  return kept.get(key);
}

/**
 * @typedef {object} Shared
 * @property {EXPECTED_ANY} value what was started
 * @property {(value: EXPECTED_ANY) => Promise<void> | void} stop stops it
 * @property {Set<EXPECTED_ANY>} users the compilers using it
 */

/** @type {Map<string, Shared>} */
const shared = new Map();

/** @type {WeakMap<EXPECTED_ANY, Set<string>>} */
const heldByCompiler = new WeakMap();

/**
 * Lets go of what a compiler acquired under a key, and stops it once no
 * compiler uses it any more.
 * @param {EXPECTED_ANY} compiler the compiler letting go
 * @param {string} key what it was acquired under
 * @returns {Promise<void>} once it is stopped, if it was the last user
 */
async function release(compiler, key) {
  const held = heldByCompiler.get(compiler);

  if (held) held.delete(key);

  const one = shared.get(key);

  if (!one || !one.users.delete(compiler) || one.users.size > 0) return;

  shared.delete(key);

  await one.stop(one.value);
}

/**
 * A worker or a process started once for every compiler asking under the same
 * key — the compilers of a `MultiCompiler` checking the same project share it
 * — and stopped when the last of them shuts down or closes its watch: in a
 * watch it lives as long as the compiler rather than as long as a build, and a
 * thread or a process left running would hold webpack's open.
 * @template T
 * @param {EXPECTED_ANY} compiler the compiler using it
 * @param {string} key what tells it from what other checks start
 * @param {() => T | null} start starts it, or answers nothing when it cannot be
 * @param {(value: T) => Promise<void> | void} stop stops it
 * @returns {T | null} what was started, or nothing
 */
function acquire(compiler, key, start, stop) {
  let one = shared.get(key);

  if (!one) {
    const value = start();

    if (value === null) return null;

    one = { value, stop, users: new Set() };
    shared.set(key, one);
  }

  one.users.add(compiler);

  let held = heldByCompiler.get(compiler);

  if (!held) {
    held = new Set();
    heldByCompiler.set(compiler, held);

    const releaseAll = () =>
      Promise.all(
        [.../** @type {Set<string>} */ (held)].map((key) =>
          release(compiler, key),
        ),
      ).then(() => {});

    compiler.hooks.shutdown.tapPromise("DiagnosticsPlugin", releaseAll);
    compiler.hooks.watchClose.tap("DiagnosticsPlugin", () => {
      releaseAll();
    });
  }

  held.add(key);

  return one.value;
}

export { acquire, keptFor, release };
