// eslint-disable-next-line jsdoc/reject-any-type
/** @typedef {any} EXPECTED_ANY */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * What a check found in a file, and what it found it under.
 * @typedef {object} Entry
 * @property {string} key what the result holds for as long as it is the same
 * @property {EXPECTED_ANY} result what the check found
 */

/**
 * The results a check keeps between builds, written to a file of its own.
 * @typedef {object} Store
 * @property {string} path where it is written
 * @property {Map<string, Entry>} entries what is kept, by the file it was found in
 * @property {boolean} dirty whether it holds what the file does not yet
 */

// A store written in another shape is read as empty rather than misread.
const VERSION = 1;

/**
 * One store per file, so that a watch run reads it once and two checks or
 * compilers writing to the same file write what both of them found.
 * @type {Map<string, Store>}
 */
const stores = new Map();

/**
 * @param {string} path where the store is written
 * @returns {Store} the store, read from there the first time it is asked for
 */
function openStore(path) {
  let store = stores.get(path);

  if (!store) {
    /** @type {Map<string, Entry>} */
    let entries = new Map();

    try {
      const written = JSON.parse(readFileSync(path, "utf8"));

      if (written && written.version === VERSION && written.entries) {
        entries = new Map(Object.entries(written.entries));
      }
    } catch {
      // Nothing written yet, or nothing that can be read: start empty.
    }

    store = { path, entries, dirty: false };
    stores.set(path, store);
  }

  return store;
}

/**
 * Writes what the store holds, without the files that have gone since. A store
 * that cannot be written costs the next build its results, not this one.
 * @param {Store} store the store
 */
function saveStore(store) {
  if (!store.dirty) return;

  for (const file of store.entries.keys()) {
    try {
      statSync(file);
    } catch {
      store.entries.delete(file);
    }
  }

  // Written aside and moved into place, so that another build reading it
  // meanwhile reads all of it or none of it.
  const written = `${store.path}.${process.pid}.tmp`;

  try {
    mkdirSync(dirname(store.path), { recursive: true });
    writeFileSync(
      written,
      JSON.stringify({
        version: VERSION,
        entries: Object.fromEntries(store.entries),
      }),
    );
    renameSync(written, store.path);
    store.dirty = false;
  } catch {
    // Read-only, or gone: the results are linted again next time.
    try {
      rmSync(written, { force: true });
    } catch {
      // Nothing was written aside either.
    }
  }
}

export { openStore, saveStore };
