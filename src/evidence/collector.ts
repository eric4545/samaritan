import { randomUUID } from 'node:crypto';
import type {
  EvidenceCollectionState,
  EvidenceItem,
  EvidenceMetadata,
  EvidenceRequirement,
} from '../models/evidence';
import type { EvidenceType } from '../models/operation';
import { validateEvidence, validateStepEvidence } from './validator';

/**
 * Evidence collector manages the collection and validation of evidence for a step
 */
export class EvidenceCollector {
  private state: EvidenceCollectionState;

  constructor(stepId: string, requirements: EvidenceRequirement) {
    this.state = {
      step_id: stepId,
      requirements,
      collected: [],
      missing: [...requirements.types],
      validation_errors: [],
      completed: false,
    };
  }

  /**
   * Get current collection state
   */
  getState(): EvidenceCollectionState {
    return { ...this.state };
  }

  /**
   * Add evidence item to collection
   */
  addEvidence(
    type: EvidenceType,
    content: string | Buffer,
    operator: string,
    options: {
      filename?: string;
      description?: string;
      automatic?: boolean;
      metadata?: Partial<EvidenceMetadata>;
    } = {},
  ): { success: boolean; evidence?: EvidenceItem; errors: string[] } {
    const errors: string[] = [];

    // Create evidence item
    const evidence: EvidenceItem = {
      id: randomUUID(),
      step_id: this.state.step_id,
      type,
      content,
      filename: options.filename,
      timestamp: new Date(),
      operator,
      automatic: options.automatic || false,
      validated: false,
      description: options.description,
      metadata: {
        size: Buffer.isBuffer(content)
          ? content.length
          : Buffer.byteLength(content, 'utf8'),
        format: this.detectFormat(type, content, options.filename),
        source: options.automatic ? 'automatic' : 'manual',
        ...options.metadata,
      },
    };

    // Validate evidence
    const validationRules = this.state.requirements.validation_rules;
    const validation = validateEvidence(evidence, validationRules);

    if (!validation.valid) {
      errors.push(...validation.errors);
      return { success: false, errors };
    }

    // Update evidence with validation metadata
    evidence.metadata = { ...evidence.metadata, ...validation.metadata };
    evidence.validated = true;

    // Add to collection
    this.state.collected.push(evidence);

    // Update missing types
    this.updateMissingTypes();

    // Update completion status
    this.updateCompletionStatus();

    return { success: true, evidence, errors: validation.warnings };
  }

  /**
   * Remove evidence item from collection
   */
  removeEvidence(evidenceId: string): boolean {
    const index = this.state.collected.findIndex((e) => e.id === evidenceId);
    if (index === -1) return false;

    this.state.collected.splice(index, 1);
    this.updateMissingTypes();
    this.updateCompletionStatus();
    return true;
  }

  /**
   * Validate all collected evidence
   */
  validateCollection(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const validation = validateStepEvidence(
      this.state.collected,
      this.state.requirements.types,
      this.state.requirements.validation_rules,
    );

    this.state.validation_errors = validation.errors;
    this.updateCompletionStatus();

    return validation;
  }

  /**
   * Check if collection meets minimum requirements
   */
  isComplete(): boolean {
    const hasAllRequiredTypes = this.state.missing.length === 0;
    const meetsMinimumCount =
      !this.state.requirements.minimum_count ||
      this.state.collected.length >= this.state.requirements.minimum_count;
    const hasNoValidationErrors = this.state.validation_errors.length === 0;

    return hasAllRequiredTypes && meetsMinimumCount && hasNoValidationErrors;
  }

  /**
   * Get evidence items by type
   */
  getEvidenceByType(type: EvidenceType): EvidenceItem[] {
    return this.state.collected.filter((e) => e.type === type);
  }

  /**
   * Get collection summary
   */
  getSummary(): {
    total: number;
    byType: Record<EvidenceType, number>;
    missing: EvidenceType[];
    completed: boolean;
    validationErrors: string[];
  } {
    const byType: Record<EvidenceType, number> = {} as any;

    // Initialize counts
    for (const type of this.state.requirements.types) {
      byType[type] = 0;
    }

    // Count collected evidence
    for (const evidence of this.state.collected) {
      byType[evidence.type] = (byType[evidence.type] || 0) + 1;
    }

    return {
      total: this.state.collected.length,
      byType,
      missing: this.state.missing,
      completed: this.state.completed,
      validationErrors: this.state.validation_errors,
    };
  }

  /**
   * Export collected evidence for persistence
   */
  export(): {
    stepId: string;
    collected: EvidenceItem[];
    summary: any;
    timestamp: Date;
  } {
    return {
      stepId: this.state.step_id,
      collected: this.state.collected,
      summary: this.getSummary(),
      timestamp: new Date(),
    };
  }

  /**
   * Update missing types based on collected evidence
   */
  private updateMissingTypes(): void {
    const collectedTypes = new Set(this.state.collected.map((e) => e.type));
    this.state.missing = this.state.requirements.types.filter(
      (type) => !collectedTypes.has(type),
    );
  }

  /**
   * Update completion status
   */
  private updateCompletionStatus(): void {
    this.state.completed = this.isComplete();
  }

  /**
   * Detect content format based on type and content
   */
  private detectFormat(
    type: EvidenceType,
    content: string | Buffer,
    filename?: string,
  ): string {
    // Try to detect from filename extension
    if (filename) {
      const ext = filename.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'png':
          return 'image/png';
        case 'jpg':
        case 'jpeg':
          return 'image/jpeg';
        case 'webp':
          return 'image/webp';
        case 'mp4':
          return 'video/mp4';
        case 'webm':
          return 'video/webm';
        case 'json':
          return 'application/json';
        case 'csv':
          return 'text/csv';
        default:
          break;
      }
    }

    // Try to detect from content
    const contentStr = content.toString();

    // Check for base64 image data
    if (contentStr.startsWith('data:')) {
      return contentStr.split(';')[0].replace('data:', '');
    }

    // Check for JSON
    if (type === 'log' || type === 'command_output') {
      try {
        JSON.parse(contentStr);
        return 'application/json';
      } catch {
        return 'text/plain';
      }
    }

    // Default formats by type
    switch (type as string) {
      case 'screenshot':
      case 'photo':
        return 'image/png';
      case 'video':
        return 'video/mp4';
      case 'log':
      case 'command_output':
        return 'text/plain';
      case 'file':
        return 'application/octet-stream';
      default:
        return 'application/octet-stream';
    }
  }
}

/**
 * Create evidence collector for a step
 */
export function createEvidenceCollector(
  stepId: string,
  requirements: EvidenceRequirement,
): EvidenceCollector {
  return new EvidenceCollector(stepId, requirements);
}

/**
 * Helper function to create evidence requirements from step configuration
 */
export function createEvidenceRequirements(
  evidenceRequired: boolean,
  evidenceTypes?: EvidenceType[],
  options: {
    minimumCount?: number;
    description?: string;
    autoCollect?: boolean;
  } = {},
): EvidenceRequirement | null {
  if (!evidenceRequired) return null;

  return {
    types: evidenceTypes || ['screenshot'],
    minimum_count: options.minimumCount || 1,
    description: options.description || 'Evidence required for step completion',
    auto_collect: options.autoCollect || false,
  };
}
