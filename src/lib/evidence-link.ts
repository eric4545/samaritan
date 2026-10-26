/**
 * Link evidence — a URL (Jenkins build, Grafana dashboard, change ticket)
 * recorded as a clickable `link` item rather than opaque typed text.
 */

export interface EvidenceLink {
  /** The URL to store, with any `user:password@` credentials removed. */
  url: string;
  /** Short human label: host + path, e.g. `jenkins.example.com/job/deploy/123`. */
  label: string;
  /** True when credentials were removed from the input. */
  strippedCredentials: boolean;
}

const MAX_LABEL_LEN = 60;

/**
 * Parse operator input as link evidence. Only a single whitespace-free
 * `http(s)://` URL counts — anything else is plain text evidence. Credentials
 * in the userinfo part are stripped so a token never lands in the report; the
 * query string is kept because dashboard/CI links depend on it.
 */
export function parseEvidenceLink(raw: string): EvidenceLink | undefined {
  const text = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }
  if (!parsed.hostname) return undefined;

  const strippedCredentials = Boolean(parsed.username || parsed.password);
  parsed.username = '';
  parsed.password = '';

  const path = parsed.pathname.replace(/\/+$/, '');
  const fullLabel = `${parsed.host}${path}`;
  const label =
    fullLabel.length > MAX_LABEL_LEN
      ? `${fullLabel.slice(0, MAX_LABEL_LEN - 1)}…`
      : fullLabel;

  // URL normalises a bare host to `https://host/`; keep the operator's form.
  const url = strippedCredentials ? parsed.toString() : text;
  return { url, label, strippedCredentials };
}
