export type EXPECTED_ANY = any;
export type Shared = {
  /**
   * what was started
   */
  value: EXPECTED_ANY;
  /**
   * stops it
   */
  stop: (value: EXPECTED_ANY) => Promise<void> | void;
  /**
   * the compilers using it
   */
  users: Set<EXPECTED_ANY>;
};
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
export function acquire<T>(
  compiler: EXPECTED_ANY,
  key: string,
  start: () => T | null,
  stop: (value: T) => Promise<void> | void,
): T | null;
/**
 * What a compiler keeps under a key, made the first time it is asked for. It
 * goes when the compiler does.
 * @template T
 * @param {EXPECTED_ANY} compiler the compiler it lives as long as
 * @param {string} key what tells it from the compiler's other state
 * @param {() => T} create makes it the first time
 * @returns {T} what the compiler keeps under the key
 */
export function keptFor<T>(
  compiler: EXPECTED_ANY,
  key: string,
  create: () => T,
): T;
/**
 * Lets go of what a compiler acquired under a key, and stops it once no
 * compiler uses it any more.
 * @param {EXPECTED_ANY} compiler the compiler letting go
 * @param {string} key what it was acquired under
 * @returns {Promise<void>} once it is stopped, if it was the last user
 */
export function release(compiler: EXPECTED_ANY, key: string): Promise<void>;
