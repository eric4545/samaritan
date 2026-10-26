/** The samaritan capture recorded as owning a pane's single `pipe-pane`. */
export interface PaneOwner {
  /** Capture id — the run's session id (plus `-<step>` for a `[t]` attach). */
  captureId: string;
  pid: number;
  since: string;
}

/** Result of `CaptureBackend.ensureCapture()`. */
export type CaptureCheck =
  | { status: 'ok' }
  /** The pipe was closed or taken over and has been re-attached. */
  | { status: 'reattached'; takenBy?: PaneOwner }
  /** tmux or the pane is gone — nothing to capture from. */
  | { status: 'unavailable' };

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
   * Optional: capture the pane's rendered screen as clean text (no escape
   * sequences). Used for the auto-captured verify evidence so the report shows
   * readable output rather than the raw pipe-pane byte stream. Returns undefined
   * when the backend cannot produce a screen (e.g. tmux unavailable).
   */
  captureScreen?(sessionName: string): string | undefined;
  /**
   * Optional: the pane's current cursor line — the shell prompt once a command
   * has finished. Used to strip the trailing prompt from a capture before
   * line-based `expect` checks. Undefined when unavailable.
   */
  promptLine?(sessionName: string): string | undefined;
  /**
   * Optional: verify the capture still receives the pane's output and repair
   * it if not (tmux allows one `pipe-pane` per pane — another run attached to
   * the same pane replaces ours). Called at step start and before each read.
   */
  ensureCapture?(sessionName: string): CaptureCheck;
  /**
   * Optional: the pane's scrollback + screen as clean text — the fallback for
   * a verify whose pipe slice was lost while the capture was detached.
   */
  captureHistory?(sessionName: string): string | undefined;
  /**
   * Tear down this backend (close pipe, unlink temp files, etc.).
   * MUST NOT kill-session when the pane belongs to the operator (TmuxPaneCapture).
   */
  teardown(): void;
}
