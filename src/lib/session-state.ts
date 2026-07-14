import type { CaptureRule } from '../models/operation';

export class SessionState {
  private vars: Map<string, string> = new Map();

  capture(name: string, value: string): void {
    this.vars.set(name, value);
  }

  get(name: string): string | undefined {
    return this.vars.get(name);
  }

  interpolate(template: string): string {
    // ${VAR} (plain identifier name) → strict: throw if not captured.
    // Shell parameter expansions (${X:?}, ${X:-default}, …) never match and
    // are left for the shell to evaluate.
    const step1 = template.replace(/\$\{(\w+)\}/g, (_match, name) => {
      const value = this.vars.get(name);
      if (value === undefined) {
        throw new Error(`Undefined captured variable: ${name}`);
      }
      return value;
    });
    // $VAR → lenient: resolve if captured, otherwise leave for shell expansion
    return step1.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
      const value = this.vars.get(name);
      return value ?? match;
    });
  }

  extractCapture(name: string, output: string, rule: CaptureRule): void {
    if (rule.pattern !== undefined) {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern);
      } catch {
        // Invalid user-supplied pattern — skip the capture rather than
        // crashing mid-run; the variable simply stays unset.
        console.warn(
          `⚠️  Invalid capture pattern for "${name}": ${rule.pattern}`,
        );
        return;
      }
      const match = re.exec(output);
      const groupIndex = rule.group ?? 1;
      const value = match?.[groupIndex];
      if (value !== undefined) {
        this.vars.set(name, value);
      }
      return;
    }

    const lines = output.split('\n').filter((l) => l.trim() !== '');
    if (rule.line === 'last') {
      const last = lines[lines.length - 1];
      if (last !== undefined) this.vars.set(name, last);
    } else if (rule.line === 'first') {
      const first = lines[0];
      if (first !== undefined) this.vars.set(name, first);
    }
  }
}
