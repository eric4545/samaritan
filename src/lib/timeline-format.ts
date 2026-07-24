import type { TimelineConfig } from '../models/operation';

/**
 * Format a step timeline (string or structured TimelineConfig) for display.
 *
 * Shared by all manual render paths (Markdown multi-env, single-env, ADF,
 * Confluence) so a structured timeline never falls back to the default
 * `[object Object]` string interpolation.
 */
export function formatTimelineForDisplay(
  timeline: string | TimelineConfig,
): string {
  if (typeof timeline === 'string') {
    return timeline;
  }

  // Structured format - convert to natural, readable format
  const parts: string[] = [];

  // Start time or dependency
  if (timeline.start) {
    parts.push(timeline.start);
  } else if (timeline.after) {
    parts.push(`(after ${timeline.after})`);
  }

  // Duration with "for" prefix if we have a start time
  if (timeline.duration) {
    if (timeline.start) {
      parts.push(`for ${timeline.duration}`);
    } else {
      parts.push(timeline.duration);
    }
  }

  return parts.join(' ');
}
