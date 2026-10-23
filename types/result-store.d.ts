export type EXPECTED_ANY = any;
/**
 * What a check found in a file, and what it found it under.
 */
export type Entry = {
  /**
   * what the result holds for as long as it is the same
   */
  key: string;
  /**
   * what the check found
   */
  result: EXPECTED_ANY;
};
/**
 * The results a check keeps between builds, written to a file of its own.
 */
export type Store = {
  /**
   * where it is written
   */
  path: string;
  /**
   * what is kept, by the file it was found in
   */
  entries: Map<string, Entry>;
  /**
   * whether it holds what the file does not yet
   */
  dirty: boolean;
};
/**
 * @param {string} path where the store is written
 * @returns {Store} the store, read from there the first time it is asked for
 */
export function openStore(path: string): Store;
/**
 * Writes what the store holds, without the files that have gone since. A store
 * that cannot be written costs the next build its results, not this one.
 * @param {Store} store the store
 */
export function saveStore(store: Store): void;
