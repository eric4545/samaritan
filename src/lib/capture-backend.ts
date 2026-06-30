/**
 * CaptureBackend — minimal interface for reading pane output.
 *
 * Both TmuxSession (spawn-own) and TmuxPaneCapture (attach-to-existing) implement
 * this interface, letting the sidecar run loop stay backend-agnostic.
 * Automatic `send`/`waitForPrompt` are intentionally kept tmux-specific — sidecar
 * never sends commands automatically. The optional `pasteCommand` below is the one
 * exception: it is operator-triggered (the `[p]` action) and never presses Enter,
 * so the operator still reviews and runs the command themselves.
 */
export interface CaptureBackend {
  /** Returns true when this backend has a capture target for the given session name. */
  hasTarget(sessionName: string): boolean;
  /** Returns the current byte offset of the pipe file for the given session. */
  currentOffset(sessionName: string): number;
  /** Reads output from the pipe file starting at fromOffset for the given session. */
  readOutput(sessionName: string, fromOffset: number): string;
  /** Human-readable description of the capture target (e.g. "tmux pane %12"). */
  describeTarget(sessionName: string): string;
  /**
   * Optional: paste a command into the pane WITHOUT executing it (no Enter).
   * Only backends bound to a writable tmux pane implement this; sidecar send is
   * operator-triggered (the `[p]` action), never automatic.
   */
  pasteCommand?(sessionName: string, command: string): void;
  /**
   * Tear down this backend (close pipe, unlink temp files, etc.).
   * MUST NOT kill-session when the pane belongs to the operator (TmuxPaneCapture).
   */
  teardown(): void;
}
