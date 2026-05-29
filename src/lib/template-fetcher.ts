// In-memory cache for remote template content, keyed by resolved URL
const remoteTemplateCache = new Map<string, string>();

/**
 * Returns true if the template path is a remote HTTPS URL or github: shorthand
 */
export function isRemoteTemplate(templatePath: string): boolean {
  return (
    templatePath.startsWith('https://') || templatePath.startsWith('github:')
  );
}

/**
 * Parses a github: shorthand into a raw.githubusercontent.com URL.
 *
 * Format: github:owner/repo//path/to/template.yaml@ref
 * Example: github:myorg/templates//deploy/k8s.yaml@v1.2.0
 *          github:myorg/templates//deploy/k8s.yaml@abc1234
 *          github:myorg/templates//deploy/k8s.yaml@main
 *
 * The // separator is required to distinguish the repo from the path.
 */
export function resolveGithubUrl(shorthand: string): string {
  const withoutScheme = shorthand.slice('github:'.length);

  // Split off @ref suffix
  const atIndex = withoutScheme.lastIndexOf('@');
  let ref = 'main';
  let repoAndPath = withoutScheme;

  if (atIndex !== -1) {
    ref = withoutScheme.slice(atIndex + 1);
    repoAndPath = withoutScheme.slice(0, atIndex);
  }

  // Split owner/repo//path
  const separatorIndex = repoAndPath.indexOf('//');
  if (separatorIndex === -1) {
    throw new Error(
      `Invalid github: shorthand — expected "github:owner/repo//path@ref", got: ${shorthand}`,
    );
  }

  const ownerRepo = repoAndPath.slice(0, separatorIndex);
  const filePath = repoAndPath.slice(separatorIndex + 2);

  if (!ownerRepo || !filePath) {
    throw new Error(
      `Invalid github: shorthand — owner/repo and path are required: ${shorthand}`,
    );
  }

  return `https://raw.githubusercontent.com/${ownerRepo}/${ref}/${filePath}`;
}

/**
 * Fetches a remote template YAML string. Results are cached in-memory for the
 * process lifetime so repeated imports of the same URL don't make extra requests.
 */
export async function fetchRemoteTemplate(url: string): Promise<string> {
  const cached = remoteTemplateCache.get(url);
  if (cached !== undefined) {
    return cached;
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Network error fetching template from ${url}: ${(error as Error).message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch template from ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const content = await response.text();
  remoteTemplateCache.set(url, content);
  return content;
}

/** Exposed for testing — clears the in-memory cache */
export function clearRemoteTemplateCache(): void {
  remoteTemplateCache.clear();
}
