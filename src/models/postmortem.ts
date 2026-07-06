/**
 * Postmortem / Incident Report (RCA) document model.
 *
 * A postmortem is a *backward-looking* incident record — the counterpart to the
 * forward-looking operation runbook. It is authored as a standalone YAML document
 * that references the operation and run it came from (`operation → run →
 * postmortem`), NOT embedded in an operation.
 *
 * One document type serves both a lightweight "incident report" and a full
 * "postmortem": every section except `title`/`summary` is optional, so omitting
 * `root_cause`/`lessons_learned` yields a quick incident report. Blameless by
 * design (Google SRE / Atlassian / PagerDuty) — there are no blame fields.
 */

export type PostmortemSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export type PostmortemStatus = 'draft' | 'in-review' | 'final';

/** How the incident was first surfaced. */
export type DetectionMethod = 'alert' | 'customer' | 'monitoring' | 'manual';

/** Classifies a timeline entry so renderers can badge it. */
export type TimelineKind =
  | 'cause'
  | 'detection'
  | 'action'
  | 'recovery'
  | 'note';

/** Follow-up work type (drives grouping/badges in the Action Items table). */
export type ActionItemType = 'prevent' | 'mitigate' | 'detect' | 'process';

export type ActionItemStatus = 'open' | 'in-progress' | 'done';

/** A single chronological event. Rendered as a Mermaid timeline + a table. */
export interface TimelineEntry {
  /** ISO-8601 timestamp (or free-form clock string) of the event. */
  at: string;
  /** What happened. */
  event: string;
  kind?: TimelineKind;
  /** Who performed/observed it. */
  by?: string;
  /** Cross-reference (ticket, alert id, PR, etc.). */
  ref?: string;
  /** Optional image path (relative to the postmortem file) or URL. */
  image?: string;
}

export interface PostmortemImpact {
  /** Time-to-detect, e.g. "4m" (MTTD). */
  detected_after?: string;
  /** Time-to-resolve, e.g. "76m" (MTTR). */
  resolved_after?: string;
  /** Free-form scope of impact. */
  scope?: string;
  /** Affected services. */
  services?: string[];
  /** Free-form description of who/how many were affected. */
  customers_affected?: string;
  /** Additional impact notes (revenue, SLA, etc.). */
  notes?: string;
}

export interface Detection {
  method?: DetectionMethod;
  /** Alert name, customer report, dashboard, etc. */
  source?: string;
  /** ISO-8601 time the incident was detected. */
  detected_at?: string;
}

export interface RootCause {
  /** The underlying cause (blameless — systems, not people). */
  summary: string;
  /** The change/event that triggered the failure. */
  trigger?: string;
  contributing_factors?: string[];
  /** Optional structured 5-whys chain. */
  five_whys?: string[];
}

export interface ActionItem {
  title: string;
  owner?: string;
  /** Tracking ticket (JIRA-123, PD-456, ...). */
  ticket?: string;
  type?: ActionItemType;
  status?: ActionItemStatus;
  /** Due date (ISO-8601 or free-form). */
  due?: string;
}

export interface LessonsLearned {
  went_well?: string[];
  went_wrong?: string[];
  got_lucky?: string[];
}

/** A supporting artifact — image, external link, log, or file. */
export interface SupportingInfo {
  type: 'image' | 'link' | 'log' | 'file';
  /** Path relative to the postmortem file (read + embedded). */
  file?: string;
  /** External URL (alternative to `file`). */
  url?: string;
  description?: string;
}

export interface Postmortem {
  title: string;
  /** Incident id, e.g. INC-2026-0042. */
  id?: string;
  severity?: PostmortemSeverity;
  status?: PostmortemStatus;
  /** ISO-8601 incident start. */
  occurred_at?: string;
  /** ISO-8601 incident end. */
  resolved_at?: string;
  authors?: string[];
  reviewers?: string[];

  // --- Linkage: point back to what was run (operation → run → postmortem) ---
  /** Path to the operation runbook that was executed. */
  operation?: string;
  /** URL of the generated manual for that operation. */
  manual?: string;
  /** Path to the run record (events.jsonl) this was seeded from. */
  run?: string;
  /** Related QRH procedure ids (reference only — resolvable via `qrh show`). */
  qrh?: string[];
  /** Related tickets. */
  tickets?: string[];

  summary: string;
  impact?: PostmortemImpact;
  detection?: Detection;
  timeline?: TimelineEntry[];
  root_cause?: RootCause;
  resolution?: string;
  action_items?: ActionItem[];
  lessons_learned?: LessonsLearned;
  supporting_information?: SupportingInfo[];
}
