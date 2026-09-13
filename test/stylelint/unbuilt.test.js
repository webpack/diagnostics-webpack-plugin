import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import pack from "./utils/pack.js";

const fixture = join(import.meta.dirname, "fixtures", "unbuilt");
const orphan = join(fixture, "orphan.scss");
// Something webpack does build, so that a rebuild can be asked for without
// touching the file under test.
const trigger = join(fixture, "trigger.js");

// Webpack starts a rebuild of its own for a file these tests wrote just before
// the watch began, so each one waits for the state it is after rather than
// counting the passes up to it. A state that never arrives ends as a timeout.
describe("unbuilt", () => {
  let watch;

  afterEach(() => {
    if (watch) {
      watch.close();
    }
    rmSync(orphan, { force: true });
    rmSync(trigger, { force: true });
  });

  it("should rebuild when a file webpack never built changes", (t, done) => {
    writeFileSync(trigger, "const trigger = 1;\n");
    writeFileSync(orphan, "#orphan { color: black; }\n");

    const compiler = pack("unbuilt");
    let fixing = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (fixing) {
        const [{ message }] = stats.compilation.errors;

        assert.match(message, /orphan\.scss/u);

        fixing = false;
        writeFileSync(orphan, "#orphan { color: #000000; }\n");

        return;
      }

      if (stats.hasErrors()) return;

      done();
    });
  });

  it("should find a file that appears after the watch started", (t, done) => {
    writeFileSync(trigger, "const trigger = 1;\n");

    const compiler = pack("unbuilt");
    let creating = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (creating) {
        assert.strictEqual(stats.hasErrors(), false);

        creating = false;
        writeFileSync(orphan, "#orphan { color: black; }\n");
        writeFileSync(trigger, "const trigger = 2;\n");

        return;
      }

      if (!stats.hasErrors()) return;

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /orphan\.scss/u);
      done();
    });
  });

  it("should find a file that appears with nothing else changing", (t, done) => {
    writeFileSync(trigger, "const trigger = 1;\n");

    const compiler = pack("unbuilt");
    let creating = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (creating) {
        assert.strictEqual(stats.hasErrors(), false);

        creating = false;
        // Nothing webpack built is touched: the rebuild is the watcher
        // answering for the folder the check reads.
        writeFileSync(orphan, "#orphan { color: black; }\n");

        return;
      }

      if (!stats.hasErrors()) return;

      const [{ message }] = stats.compilation.errors;

      assert.match(message, /orphan\.scss/u);
      done();
    });
  });

  it("should stop reporting a file that is gone", (t, done) => {
    writeFileSync(trigger, "const trigger = 1;\n");
    writeFileSync(orphan, "#orphan { color: black; }\n");

    const compiler = pack("unbuilt");
    let removing = true;

    watch = compiler.watch({}, (err, stats) => {
      assert.strictEqual(err, null);

      if (removing) {
        const [{ message }] = stats.compilation.errors;

        assert.match(message, /orphan\.scss/u);

        removing = false;
        rmSync(orphan, { force: true });
        writeFileSync(trigger, "const trigger = 2;\n");

        return;
      }

      if (stats.hasErrors()) return;

      done();
    });
  });
});
