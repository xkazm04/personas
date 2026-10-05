// Append-only daily JSONL writer for toolchain records.
//
// One write stream per UTC day (`<prefix>.YYYY-MM-DD.jsonl`), opened lazily and
// rotated when the date changes. Logging must never take the dev server down:
// the first failure prints ONE warning to stderr and the writer goes inert.

import fs from "node:fs";
import path from "node:path";
import { toLine } from "./envelope.mjs";
import { utcDate } from "./paths.mjs";

export class JsonlWriter {
  constructor(dir, { prefix = "toolchain", clock = () => Date.now(), warn = defaultWarn } = {}) {
    this.dir = dir;
    this.prefix = prefix;
    this.clock = clock;
    this.warn = warn;
    this.stream = null;
    this.date = null;
    this.failed = false;
    this.written = 0;
  }

  /** Path of the file a record written now lands in. */
  currentPath() {
    return path.join(this.dir, `${this.prefix}.${utcDate(this.clock())}.jsonl`);
  }

  write(record) {
    if (this.failed) return false;
    try {
      const date = utcDate(this.clock());
      if (!this.stream || date !== this.date) {
        if (this.stream) this.stream.end();
        fs.mkdirSync(this.dir, { recursive: true });
        this.stream = fs.createWriteStream(this.currentPath(), { flags: "a" });
        this.stream.on("error", (err) => this.fail(err));
        this.date = date;
      }
      this.stream.write(toLine(record));
      this.written += 1;
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  fail(err) {
    if (this.failed) return;
    this.failed = true;
    this.warn(`[devlog] toolchain log disabled for this session: ${err?.message ?? err}`);
    try {
      this.stream?.destroy();
    } catch {
      /* already gone */
    }
    this.stream = null;
  }

  /** Flush and close; resolves even when the stream already failed. */
  close() {
    return new Promise((resolve) => {
      if (!this.stream) return resolve();
      const s = this.stream;
      this.stream = null;
      s.end(() => resolve());
      s.on("error", () => resolve());
    });
  }
}

function defaultWarn(message) {
  try {
    process.stderr.write(message + "\n");
  } catch {
    /* stderr closed: nothing left to tell */
  }
}

/** Keep the `keep` newest `<prefix>.YYYY-MM-DD.jsonl` files; best effort. */
export function pruneDaily(dir, prefix, keep = 7) {
  try {
    const re = new RegExp(`^${prefix}\\.\\d{4}-\\d{2}-\\d{2}\\.jsonl$`);
    const files = fs.readdirSync(dir).filter((n) => re.test(n)).sort().reverse();
    for (const name of files.slice(keep)) fs.rmSync(path.join(dir, name), { force: true });
  } catch {
    /* a missing dir or a locked file is not worth a warning */
  }
}
