export type EXPECTED_ANY = any;
export type Options = import("../options.js").CheckOptions;
export type TypeScript = EXPECTED_ANY;
export type Diagnostic = EXPECTED_ANY;
/**
 * What one compilation leaves for the next: the files it parsed, the host that
 * hands them back, and the program that type checked them.
 * What a run of the check answers with: what it found, and what a watcher has
 * to follow for it to answer the same way again.
 */
export type Found = {
  diagnostics: Diagnostic[];
  host: EXPECTED_ANY;
  files: string[];
  directories: string[];
  writes: string[];
};
export type Held = {
  signature: string;
  files: Map<string, EXPECTED_ANY>;
  seen: Set<string>;
  missing: Set<string>;
  host: EXPECTED_ANY;
  program: EXPECTED_ANY;
  programs: Map<string, EXPECTED_ANY>;
  readAt: number;
  dropped: Map<
    string,
    {
      text: string;
      time: Date;
    }
  >;
};
/**
 * The program the config file describes, with emit off: webpack writes the
 * output, so a check that wrote any of its own would fight it.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Options} options options
 * @param {Held} held what the last compilation left behind
 * @returns {Found} what it found, and what it read to find it
 */
export function check(ts: TypeScript, options: Options, held: Held): Found;
/**
 * What a diagnostic says, as data: a `Diagnostic` holds the source file it was
 * found in, so this is what can be read once it has left the check.
 * @param {TypeScript} ts the loaded TypeScript
 * @param {Diagnostic} diagnostic one of what a run found
 * @returns {EXPECTED_ANY} what it says
 */
export function describe(ts: TypeScript, diagnostic: Diagnostic): EXPECTED_ANY;
/**
 * A program is kept for the compiler that built it, so that a rebuild type
 * checks what changed rather than the project over again.
 * @param {EXPECTED_ANY} compiler the compiler the check runs for
 * @param {string} id a key unique to the check within that compiler
 * @returns {Held} what the last compilation left behind
 */
export function getHeld(compiler: EXPECTED_ANY, id: string): Held;
/**
 * Read on demand so that requiring the plugin does not read three files.
 * @returns {{ plugin: EXPECTED_ANY, shared: EXPECTED_ANY, own: EXPECTED_ANY }} the schemas
 */
export function getSchemas(): {
  plugin: EXPECTED_ANY;
  shared: EXPECTED_ANY;
  own: EXPECTED_ANY;
};
/**
 * @param {Options} options plugin options
 * @returns {EXPECTED_ANY} the options TypeScript itself understands
 */
export function getTypeScriptOptions(options: Options): EXPECTED_ANY;
