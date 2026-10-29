export type TypeScript = EXPECTED_ANY;
/**
 * What one file imports, as TypeScript resolves it.
 */
export type Imports = {
  /**
   * the files its imports resolve to
   */
  resolved: string[];
  /**
   * whether a relative import resolved to nothing
   */
  unresolved: boolean;
  /**
   * whether it declares something every file can see
   */
  global: boolean;
  /**
   * the relative imports that resolve to nothing, as written, assets included
   */
  missing: string[];
};
/**
 * A file as it was last read, kept while its size and time are the same.
 */
export type Read = {
  /**
   * when it was last written
   */
  mtimeMs: number;
  /**
   * how long it is
   */
  size: number;
  /**
   * what it holds, hashed
   */
  hash: string;
  /**
   * what it imports
   */
  imports: Imports;
};
/**
 * What is kept between rebuilds: each file's imports, read again only once
 * the file changes, and the compiler options of each config file.
 */
export type Graph = {
  /**
   * the TypeScript the imports are resolved with
   */
  ts: TypeScript;
  /**
   * the imports of each file, by its path
   */
  files: Map<string, Imports>;
  /**
   * the config file nearest to each directory
   */
  configs: Map<string, string | undefined>;
  /**
   * the compiler options of each config file
   */
  options: Map<string, EXPECTED_ANY>;
  /**
   * every file read for a signature, as it was read
   */
  reads: Map<string, Read>;
  /**
   * each config file and what it extends, hashed, as the signatures were last read under
   */
  configHashes: Map<string, string>;
  /**
   * what each set of compiler options resolved this pass, so that every file in a folder does not look its imports up again
   */
  resolutions: Map<EXPECTED_ANY, EXPECTED_ANY>;
  /**
   * what each file that changed showed the files importing it, as the last change left it, hashed
   */
  faces: Map<string, string>;
  /**
   * what a file TypeScript reads ends in, read from it once
   */
  scripts: Set<string> | undefined;
  /**
   * the options of a directory no config file covers
   */
  fallback: EXPECTED_ANY;
};
export type EXPECTED_ANY = any;
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
export function affectedFiles(
  graph: Graph,
  files: string[],
  changed: string[],
): Set<string> | undefined;
/**
 * @param {TypeScript} ts the TypeScript the imports are resolved with
 * @returns {Graph} an empty graph
 */
export function createGraph(ts: TypeScript): Graph;
/**
 * The graph a compiler keeps for one check, read with the TypeScript the
 * check's project installs — the one its own tooling resolves imports with.
 * @param {EXPECTED_ANY} compiler the compiler the graph lives as long as
 * @param {string} context where the project's TypeScript is looked up from
 * @param {string} owner what tells the check from the compiler's others
 * @returns {Promise<Graph | undefined>} the graph, or nothing without a TypeScript to read it with
 */
export function getGraph(
  compiler: EXPECTED_ANY,
  context: string,
  owner: string,
): Promise<Graph | undefined>;
/**
 * @param {string} text what to hash
 * @returns {string} its hash
 */
export function hashOf(text: string): string;
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
export function signatures(graph: Graph, files: string[]): Map<string, string>;
