import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { detectMimeType } from '../../evidence/collector';
import type { EvidenceItem } from '../../models/evidence';
import type { EvidenceType, Operation } from '../../models/operation';
import type { StepEvidenceRef, StepRecord } from '../../models/step-record';
import { SessionManager } from '../session-manager';
import {
  getSessionEvidenceDir,
  listSavedSessions,
  loadSession,
  saveSession,
} from '../session-persistence';
import { renderAppHtml } from './app-html';
import { buildOperationView, type OperationView } from './view-model';

// Reject request bodies larger than this to avoid unbounded memory growth
// from a runaway upload (base64-encoded evidence files included).
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const VALID_STEP_STATUSES = new Set([
  'pending',
  'completed',
  'failed',
  'skipped',
]);

export interface ServeOptions {
  host?: string;
  port?: number;
  /** Environment tab pre-selected on first page load (cosmetic only). */
  initialEnv?: string;
}

export interface ServeHandle {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface HistorySummary {
  id: string;
  operation_id: string;
  environment: string;
  status: string;
  completion_percentage: number;
  started_at: Date;
  updated_at: Date;
}

interface ServerContext {
  operation: Operation;
  operationFile: string;
  view: OperationView;
  sessionManager: SessionManager;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  html: string,
): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/** Read the full request body, rejecting once it exceeds `maxBytes`. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const buf = await readBody(req, MAX_BODY_BYTES);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function buildHistorySummaries(): HistorySummary[] {
  return listSavedSessions()
    .map((s) => ({
      id: s.id,
      operation_id: s.operation_id,
      environment: s.environment,
      status: s.status,
      completion_percentage: s.completion_percentage ?? 0,
      started_at: s.started_at,
      updated_at: s.updated_at,
    }))
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
}

function findOrCreateStepRecord(
  ctx: ServerContext,
  session: { step_log?: StepRecord[] },
  index: number,
): StepRecord {
  session.step_log = session.step_log ?? [];
  let record = session.step_log.find((r) => r.index === index);
  if (!record) {
    const flat = ctx.view.steps[index];
    record = {
      index,
      name: flat?.name ?? `Step ${index + 1}`,
      phase: flat?.phase,
      pic: flat?.pic,
      reviewer: flat?.reviewer,
      status: 'pending',
      commands: [],
      notes: [],
      evidence: [],
    };
    session.step_log.push(record);
  }
  return record;
}

function recomputeCompletion(
  ctx: ServerContext,
  session: { step_log?: StepRecord[]; completion_percentage?: number },
): void {
  const total = ctx.view.steps.length;
  const completed = (session.step_log ?? []).filter(
    (r) => r.status === 'completed',
  ).length;
  session.completion_percentage =
    total > 0 ? Math.round((completed / total) * 100) : 0;
}

function requireStepIndex(ctx: ServerContext, raw: string): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= ctx.view.steps.length) {
    throw new HttpError(400, `Step index out of range: ${raw}`);
  }
  return index;
}

function requireSession(ctx: ServerContext, sessionId: string) {
  const session = ctx.sessionManager.getSession(sessionId);
  if (!session) throw new HttpError(404, `Session not found: ${sessionId}`);
  return session;
}

async function handleCreateRun(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  const body = await readJsonBody(req);
  const environment = body?.environment;
  if (typeof environment !== 'string' || !environment) {
    throw new HttpError(400, "'environment' is required");
  }
  if (!ctx.view.environments.includes(environment)) {
    throw new HttpError(
      400,
      `Unknown environment '${environment}'. Available: ${ctx.view.environments.join(', ')}`,
    );
  }
  const operator =
    typeof body?.operator === 'string' && body.operator ? body.operator : 'web';

  const session = ctx.sessionManager.createSession(
    ctx.operation.id,
    environment,
    operator,
    'sidecar',
    undefined,
    ctx.operationFile,
  );
  sendJson(res, 201, session);
}

async function handleStepUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  sessionId: string,
  indexRaw: string,
): Promise<void> {
  const index = requireStepIndex(ctx, indexRaw);
  const session = requireSession(ctx, sessionId);
  const body = await readJsonBody(req);

  const record = findOrCreateStepRecord(ctx, session, index);

  if (body?.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !VALID_STEP_STATUSES.has(body.status)
    ) {
      throw new HttpError(400, `Invalid status: ${body.status}`);
    }
    record.status = body.status;
    if (body.status !== 'pending') {
      record.ended_at = new Date().toISOString();
    }
  }

  if (typeof body?.note === 'string' && body.note.trim().length > 0) {
    record.notes.push(body.note);
  }

  session.updated_at = new Date();
  recomputeCompletion(ctx, session);
  saveSession(session);
  sendJson(res, 200, session);
}

async function handleStepEvidence(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  sessionId: string,
  indexRaw: string,
): Promise<void> {
  const index = requireStepIndex(ctx, indexRaw);
  const session = requireSession(ctx, sessionId);
  const body = await readJsonBody(req);

  const type = body?.type;
  if (typeof type !== 'string' || !type) {
    throw new HttpError(400, "'type' is required");
  }
  const description =
    typeof body?.description === 'string' && body.description
      ? body.description
      : undefined;

  let content: string | Buffer;
  let filename: string | undefined;
  let storedPath: string | undefined;
  // `mimeSource`/`size` are derived from the actual bytes (the upload buffer
  // for a file, the pasted string otherwise) — NOT from `content`, which for
  // a file upload becomes the on-disk path string once written below. Using
  // `content` for either would report the path's byte length as the evidence
  // size and misdetect its MIME type from the path string instead of the file.
  let mimeSource: string | Buffer;
  let size: number;

  if (
    typeof body?.dataBase64 === 'string' &&
    typeof body?.filename === 'string'
  ) {
    let buf: Buffer;
    try {
      buf = Buffer.from(body.dataBase64, 'base64');
    } catch {
      throw new HttpError(400, 'Invalid base64 data');
    }
    filename = path.basename(body.filename);
    const evidenceDir = getSessionEvidenceDir(session.id);
    storedPath = path.join(evidenceDir, `${randomUUID()}-${filename}`);
    fs.writeFileSync(storedPath, buf);
    content = storedPath;
    mimeSource = buf;
    size = buf.length;
  } else if (typeof body?.content === 'string') {
    content = body.content;
    mimeSource = body.content;
    size = Buffer.byteLength(body.content, 'utf-8');
  } else {
    throw new HttpError(
      400,
      "Either 'content' (pasted text) or 'filename' + 'dataBase64' (file upload) is required",
    );
  }

  const item: EvidenceItem = {
    id: randomUUID(),
    step_id: String(index),
    type: type as EvidenceType,
    content,
    filename,
    timestamp: new Date(),
    operator: session.operator ?? 'web',
    automatic: false,
    validated: false,
    metadata: {
      size,
      format: detectMimeType(type as EvidenceType, mimeSource, filename),
      source: 'web',
      ...(storedPath ? { original_path: storedPath } : {}),
    },
    description,
  };
  session.evidence.push(item);

  const record = findOrCreateStepRecord(ctx, session, index);
  const ref: StepEvidenceRef = {
    id: item.id,
    type: item.type,
    description,
    content: storedPath ? undefined : (content as string),
    filename,
    path: storedPath,
  };
  record.evidence.push(ref);

  session.updated_at = new Date();
  saveSession(session);
  sendJson(res, 201, session);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
  bootstrap: { name?: string; version?: string; initialEnv?: string },
): Promise<void> {
  const method = req.method ?? 'GET';
  const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = parsedUrl.pathname;

  try {
    if (method === 'GET' && pathname === '/api/operation') {
      return sendJson(res, 200, ctx.view);
    }

    if (method === 'GET' && pathname === '/api/history') {
      return sendJson(res, 200, buildHistorySummaries());
    }

    const historyMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
    if (method === 'GET' && historyMatch) {
      const session = loadSession(historyMatch[1]);
      if (!session) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, { session, step_log: session.step_log ?? [] });
    }

    if (method === 'POST' && pathname === '/api/runs') {
      return await handleCreateRun(req, res, ctx);
    }

    const evidenceMatch = pathname.match(
      /^\/api\/runs\/([^/]+)\/steps\/(\d+)\/evidence$/,
    );
    if (method === 'POST' && evidenceMatch) {
      return await handleStepEvidence(
        req,
        res,
        ctx,
        evidenceMatch[1],
        evidenceMatch[2],
      );
    }

    const stepMatch = pathname.match(/^\/api\/runs\/([^/]+)\/steps\/(\d+)$/);
    if (method === 'POST' && stepMatch) {
      return await handleStepUpdate(req, res, ctx, stepMatch[1], stepMatch[2]);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `Not found: ${pathname}` });
    }

    // Any non-API path (including `/`) serves the self-contained SPA. There
    // is no on-disk static file serving keyed off the URL, so there is no
    // path-traversal surface here.
    if (method === 'GET') {
      return sendHtml(res, 200, renderAppHtml(bootstrap));
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { error: err.message });
    }
    return sendJson(res, 500, {
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

/**
 * Start the `samaritan serve` HTTP server. Commands are DISPLAY-ONLY: this
 * module never spawns a process or shells out to run a step's command —
 * it only serves a resolved view model and persists session/evidence JSON,
 * mirroring the terminal sidecar mode's "display, don't execute" contract.
 */
export function startServer(
  operation: Operation,
  operationFile: string,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4600;
  const operationDir = path.dirname(operationFile);
  const view = buildOperationView(operation, operationDir);
  const sessionManager = new SessionManager();

  const ctx: ServerContext = { operation, operationFile, view, sessionManager };
  const bootstrap = {
    name: operation.name,
    version: operation.version,
    initialEnv: options.initialEnv,
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, ctx, bootstrap).catch((err) => {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address() as AddressInfo;
      const url = `http://${host}:${addr.port}`;
      resolve({
        server,
        url,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
