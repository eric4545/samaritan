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
    return template.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const value = this.vars.get(name);
      if (value === undefined) {
        throw new Error(`Undefined captured variable: ${name}`);
      }
      return value;
    });
  }

  extractCapture(name: string, output: string, rule: CaptureRule): void {
    if (rule.pattern !== undefined) {
      const re = new RegExp(rule.pattern);
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
