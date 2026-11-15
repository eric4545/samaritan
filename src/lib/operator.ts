import { userInfo } from 'node:os';

/**
 * Who is driving this run, for the audit trail. `$USER` is unset in some
 * shells (containers, `sudo -i`, CI), which used to record every action as
 * `unknown`; fall back to `$LOGNAME`, then the OS account.
 */
export function currentOperator(
  env: NodeJS.ProcessEnv = process.env,
  osUser: () => string | undefined = () => userInfo().username,
): string {
  const fromEnv = env.USER?.trim() || env.LOGNAME?.trim();
  if (fromEnv) return fromEnv;
  try {
    return osUser()?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
