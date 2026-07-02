import { resolve } from 'node:path';
import { Command } from 'commander';
import { startServer } from '../../lib/web/server';
import { parseOperation } from '../../operations/parser';

interface ServeCommandOptions {
  port?: string;
  host?: string;
  env?: string;
}

/**
 * `samaritan serve <operation.yaml>` — EXPERIMENTAL interactive web UI.
 *
 * Parses+validates the operation once, then starts a local `node:http`
 * server rendering it as a single-page app: environment tabs, an all-steps
 * sidecar checklist, evidence upload, and a history view over
 * `~/.samaritan/sessions`. Commands are DISPLAY-ONLY — mirrors the terminal
 * sidecar rule (`src/lib/web/server.ts` never shells out to run a step).
 */
const serveCommand = new Command('serve')
  .description(
    '[EXPERIMENTAL] Start a local web UI for an operation (display-only; never executes commands)',
  )
  .argument('<file>', 'Path to operation YAML file')
  .option('--port <n>', 'Port to listen on', '4600')
  .option('--host <host>', 'Host to bind to', '127.0.0.1')
  .option('-e, --env <name>', 'Initial environment tab to select in the UI')
  .option(
    '--no-open',
    'No-op: samaritan never auto-opens a browser (dependency-free); the URL is always printed',
  )
  .action(async (file: string, options: ServeCommandOptions) => {
    let operation: Awaited<ReturnType<typeof parseOperation>>;
    try {
      operation = await parseOperation(file);
    } catch (error: any) {
      console.error(`❌ Failed to parse operation: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (
      options.env &&
      !operation.environments.some((e) => e.name === options.env)
    ) {
      console.error(
        `❌ Environment '${options.env}' not found. Available: ${operation.environments.map((e) => e.name).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }

    // `--port`/`--host` always carry commander's registered defaults, so no
    // extra `??` fallback is needed here (the sole defensive default lives in
    // `startServer` for non-CLI callers).
    const operationFile = resolve(file);
    const port = Number.parseInt(options.port as string, 10);
    const host = options.host as string;

    try {
      const { url, close } = await startServer(operation, operationFile, {
        host,
        port,
        initialEnv: options.env,
      });

      console.log(`🌐 SAMARITAN serve: ${url}`);
      console.log(
        '⚠️  EXPERIMENTAL: local operator tool only, bound to localhost by default.',
      );
      console.log(
        '⚠️  Commands are DISPLAY-ONLY — samaritan never executes/spawns/sends them; run them yourself.',
      );

      const shutdown = () => {
        close().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error: any) {
      console.error(`❌ Failed to start server: ${error.message}`);
      process.exitCode = 1;
    }
  });

export { serveCommand };
