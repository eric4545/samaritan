/**
 * Exit with `code` once stdout and stderr have handed everything written so
 * far to the OS.
 *
 * Node writes to a pipe asynchronously, and `process.exit()` does not wait:
 * `console.log(big); process.exit(1)` lost whatever the pipe had not taken
 * yet, so `samaritan lint --format json | jq` read the first 64 KiB only (a
 * file or a terminal got everything). A write's callback runs after every
 * earlier write on that stream, so an empty write marks the end.
 *
 * Returns a promise that never settles: `return exitAfterFlush(code)` stops
 * the caller where `process.exit` would have.
 */
export function exitAfterFlush(code: number): Promise<never> {
  process.exitCode = code;
  return new Promise<never>(() => {
    const streams = [process.stdout, process.stderr];
    let pending = streams.length;
    const done = () => {
      pending -= 1;
      if (pending === 0) process.exit(code);
    };
    for (const stream of streams) {
      // A closed reader (`| head`) fails the write; exit all the same.
      if (stream.destroyed || !stream.writable) done();
      else stream.write('', done);
    }
  });
}
