import type { Operation } from '../models/operation';
import { listUnresolvedTmuxSessionVars } from './tmux-session';

export interface RunConfigFindings {
  errors: string[];
  warnings: string[];
}

/**
 * `validate` checks for the `run:` block.
 *
 * `run.default_session` must name a declared `sessions:` key (a typo would
 * silently route sessionless steps nowhere). `run.tmux_session` `${VAR}`s
 * that an environment doesn't define are warnings, not errors — `--var` can
 * still supply them — but `run`/`resume` refuse to start without them.
 */
export function lintRunConfig(operation: Operation): RunConfigFindings {
  const findings: RunConfigFindings = { errors: [], warnings: [] };
  const run = operation.run;
  if (!run) return findings;
  const declared = Object.keys(operation.sessions ?? {});

  if (run.default_session && !declared.includes(run.default_session)) {
    findings.errors.push(
      `run.default_session "${run.default_session}" is not declared in sessions:` +
        (declared.length > 0
          ? ` (declared: ${declared.join(', ')})`
          : ' (no sessions: defined)'),
    );
  }

  if (run.tmux_session === undefined) return findings;
  if (declared.length === 0) {
    findings.warnings.push(
      'run.tmux_session has no effect without sessions: (it names the tmux session holding their windows)',
    );
    return findings;
  }
  for (const env of operation.environments) {
    const missing = listUnresolvedTmuxSessionVars(run.tmux_session, {
      ...(operation.common_variables ?? {}),
      ...(operation.variables[env.name] ?? {}),
    });
    if (missing.length > 0) {
      findings.warnings.push(
        `run.tmux_session "${run.tmux_session}" uses ${missing.map((m) => `\${${m}}`).join(', ')} not defined for environment '${env.name}' — define it or pass --var at run time`,
      );
    }
  }
  return findings;
}
