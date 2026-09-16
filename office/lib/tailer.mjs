/* The read discipline for append-only NDJSON files.

   Two files are tailed (the spool and the session transcripts) and both can be
   missing, partial, rotated, or rewritten under us. `read()` is deliberately
   synchronous and side-effect free apart from its own offset: the caller decides
   how often to poll, which makes the whole thing testable without timers.

   The invariant that matters: a line is emitted exactly once, and only once it
   is complete. A trailing fragment with no newline is held back until the next
   read appends the rest. */

import fs from 'node:fs';

export function createTailer(file, { maxLine = 1 << 20 } = {}) {
  let offset = 0;
  let partial = '';
  let exists = false;

  function readSlice(from, to) {
    const fd = fs.openSync(file, 'r');
    try {
      const length = to - from;
      if (length <= 0) return '';
      const buf = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buf, 0, length, from);
      return buf.toString('utf8', 0, read);
    } finally {
      fs.closeSync(fd);
    }
  }

  function read() {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      exists = false;
      offset = 0;
      partial = '';
      return [];
    }

    exists = true;

    /* A file smaller than our offset was rotated or rewritten. Restarting from
       zero is the only safe reading: re-emitting old lines is recoverable —
       the server keys every spool record by session, timestamp, tool_use id and
       event name, and ignores the ones it has already seen — whereas silently
       skipping new content is not. */
    if (size < offset) {
      offset = 0;
      partial = '';
    }

    if (size === offset) return [];

    let chunk;
    try {
      chunk = readSlice(offset, size);
    } catch {
      return [];
    }
    offset = size;

    const text = partial + chunk;
    const lines = text.split('\n');
    partial = lines.pop() ?? '';

    /* Bound a runaway line so a corrupt file cannot exhaust memory. */
    if (partial.length > maxLine) partial = '';

    return lines.filter((line) => line.length > 0);
  }

  return {
    read,
    reset() {
      offset = 0;
      partial = '';
    },
    /* Jump to the current end without emitting anything. Used after the spool is
       rotated: the kept lines are already in the ring, so re-reading them would
       duplicate every event. */
    skipToEnd() {
      partial = '';
      try {
        offset = fs.statSync(file).size;
      } catch {
        offset = 0;
      }
    },
    get offset() {
      return offset;
    },
    get exists() {
      return exists;
    },
  };
}

/* Parse NDJSON defensively: a transcript is appended by the host process and a
   torn line at the tail is expected, not exceptional. Unparseable lines are
   counted and skipped rather than thrown. */
export function parseJsonLines(lines, onObject) {
  let bad = 0;
  for (const line of lines) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    onObject(value);
  }
  return bad;
}
