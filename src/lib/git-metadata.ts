import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitMetadata {
  sha: string;
  branch: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
  isDirty: boolean;
}

export interface GenerationMetadata {
  source_file: string;
  operation_id: string;
  operation_version: string;
  target_environment?: string;
  generated_at: string;
  git_sha: string;
  git_branch: string;
  git_short_sha: string;
  git_author: string;
  git_date: string;
  git_message: string;
  git_dirty: boolean;
  generator_version: string;
}

/**
 * Extract git metadata from the current repository
 */
export async function getGitMetadata(): Promise<GitMetadata | null> {
  try {
    // Check if we're in a git repository
    await execAsync('git rev-parse --git-dir');

    const [
      { stdout: sha },
      { stdout: branch },
      { stdout: author },
      { stdout: date },
      { stdout: message },
      { stdout: statusOutput }
    ] = await Promise.all([
      execAsync('git rev-parse HEAD'),
      execAsync('git rev-parse --abbrev-ref HEAD'),
      execAsync('git log -1 --format="%an"'),
      execAsync('git log -1 --format="%ai"'),
      execAsync('git log -1 --format="%s"'),
      execAsync('git status --porcelain')
    ]);

    const isDirty = statusOutput.trim().length > 0;
    const shortSha = sha.trim().substring(0, 8);

    return {
      sha: sha.trim(),
      branch: branch.trim(),
      shortSha,
      author: author.trim(),
      date: date.trim(),
      message: message.trim(),
      isDirty
    };
  } catch (error) {
    // Not in a git repository or git not available
    return null;
  }
}

/**
 * Create generation metadata for YAML frontmatter
 */
export async function createGenerationMetadata(
  sourceFile: string,
  operationId: string,
  operationVersion: string,
  targetEnvironment?: string
): Promise<GenerationMetadata> {
  const gitMetadata = await getGitMetadata();
  const generatedAt = new Date().toISOString();

  // Get generator version from package.json
  const generatorVersion = process.env.npm_package_version || '1.0.0';

  return {
    source_file: sourceFile,
    operation_id: operationId,
    operation_version: operationVersion,
    target_environment: targetEnvironment,
    generated_at: generatedAt,
    git_sha: gitMetadata?.sha || 'unknown',
    git_branch: gitMetadata?.branch || 'unknown',
    git_short_sha: gitMetadata?.shortSha || 'unknown',
    git_author: gitMetadata?.author || 'unknown',
    git_date: gitMetadata?.date || 'unknown',
    git_message: gitMetadata?.message || 'unknown',
    git_dirty: gitMetadata?.isDirty || false,
    generator_version: generatorVersion
  };
}

/**
 * Generate YAML frontmatter from metadata
 */
export function generateYamlFrontmatter(metadata: GenerationMetadata): string {
  const frontmatter = `---
source_file: "${metadata.source_file}"
operation_id: "${metadata.operation_id}"
operation_version: "${metadata.operation_version}"${metadata.target_environment ? `
target_environment: "${metadata.target_environment}"` : ''}
generated_at: "${metadata.generated_at}"
git_sha: "${metadata.git_sha}"
git_branch: "${metadata.git_branch}"
git_short_sha: "${metadata.git_short_sha}"
git_author: "${metadata.git_author}"
git_date: "${metadata.git_date}"
git_message: "${metadata.git_message}"
git_dirty: ${metadata.git_dirty}
generator_version: "${metadata.generator_version}"
---

`;

  return frontmatter;
}