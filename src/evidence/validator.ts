import { 
  EvidenceItem, 
  EvidenceValidationResult, 
  EvidenceValidationRule, 
  EvidenceMetadata 
} from '../models/evidence';
import { EvidenceType } from '../models/operation';
import crypto from 'crypto';

// Default validation rules for each evidence type
const DEFAULT_VALIDATION_RULES: Record<EvidenceType, EvidenceValidationRule> = {
  screenshot: {
    type: 'screenshot',
    max_size: 10 * 1024 * 1024, // 10MB
    allowed_formats: ['image/png', 'image/jpeg', 'image/webp'],
    min_resolution: '800x600'
  },
  log: {
    type: 'log',
    max_size: 50 * 1024 * 1024, // 50MB
    allowed_formats: ['text/plain', 'text/csv', 'application/json'],
    forbidden_content: ['password', 'secret', 'token', 'key=']
  },
  command_output: {
    type: 'command_output',
    max_size: 10 * 1024 * 1024, // 10MB
    allowed_formats: ['text/plain'],
    forbidden_content: ['password', 'secret', 'token']
  },
  file: {
    type: 'file',
    max_size: 100 * 1024 * 1024, // 100MB
    allowed_formats: ['*'] // Allow all formats for generic files
  },
  photo: {
    type: 'photo',
    max_size: 20 * 1024 * 1024, // 20MB
    allowed_formats: ['image/png', 'image/jpeg', 'image/webp', 'image/heic'],
    min_resolution: '640x480'
  },
  video: {
    type: 'video',
    max_size: 500 * 1024 * 1024, // 500MB
    allowed_formats: ['video/mp4', 'video/webm', 'video/quicktime'],
    max_duration: 300 // 5 minutes
  }
};

/**
 * Validates an evidence item against validation rules
 */
export function validateEvidence(
  evidence: EvidenceItem, 
  customRules?: EvidenceValidationRule[]
): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata: Partial<EvidenceMetadata> = {};

  // Get validation rules (custom or default)
  const rules = customRules?.find(r => r.type === evidence.type) || 
                DEFAULT_VALIDATION_RULES[evidence.type];

  // Validate content exists
  if (!evidence.content || evidence.content.length === 0) {
    errors.push('Evidence content is empty');
    return { valid: false, errors, warnings, metadata };
  }

  // Calculate content size
  const contentSize = Buffer.isBuffer(evidence.content) 
    ? evidence.content.length 
    : Buffer.byteLength(evidence.content, 'utf8');

  metadata.size = contentSize;

  // Validate file size
  if (rules.max_size && contentSize > rules.max_size) {
    errors.push(`File size ${formatBytes(contentSize)} exceeds maximum ${formatBytes(rules.max_size)}`);
  }

  // Validate format
  if (rules.allowed_formats && !rules.allowed_formats.includes('*')) {
    const format = evidence.metadata.format;
    if (!format || !rules.allowed_formats.includes(format)) {
      errors.push(`Format '${format}' not allowed. Allowed formats: ${rules.allowed_formats.join(', ')}`);
    }
  }

  // Content-specific validation
  const contentStr = evidence.content.toString();

  // Check for forbidden content
  if (rules.forbidden_content) {
    const foundForbidden = rules.forbidden_content.filter(forbidden => 
      contentStr.toLowerCase().includes(forbidden.toLowerCase())
    );
    if (foundForbidden.length > 0) {
      errors.push(`Content contains forbidden terms: ${foundForbidden.join(', ')}`);
    }
  }

  // Check for required content
  if (rules.required_content) {
    const missingRequired = rules.required_content.filter(required => 
      !contentStr.toLowerCase().includes(required.toLowerCase())
    );
    if (missingRequired.length > 0) {
      warnings.push(`Content missing recommended terms: ${missingRequired.join(', ')}`);
    }
  }

  // Type-specific validation
  if (evidence.type === 'screenshot' || evidence.type === 'photo') {
    validateImageEvidence(evidence, rules, errors, warnings, metadata);
  } else if (evidence.type === 'video') {
    validateVideoEvidence(evidence, rules, errors, warnings, metadata);
  } else if (evidence.type === 'log' || evidence.type === 'command_output') {
    validateTextEvidence(evidence, rules, errors, warnings, metadata);
  }

  // Generate checksum if not provided
  if (!evidence.metadata.checksum) {
    metadata.checksum = generateChecksum(evidence.content);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata
  };
}

/**
 * Validates image evidence (screenshot, photo)
 */
function validateImageEvidence(
  evidence: EvidenceItem,
  rules: EvidenceValidationRule,
  errors: string[],
  warnings: string[],
  metadata: Partial<EvidenceMetadata>
): void {
  // Check if content looks like base64 image data
  const contentStr = evidence.content.toString();
  if (contentStr.startsWith('data:image/')) {
    metadata.format = contentStr.split(';')[0].replace('data:', '');
  }

  // Validate minimum resolution if specified
  if (rules.min_resolution && evidence.metadata.resolution) {
    const [minWidth, minHeight] = rules.min_resolution.split('x').map(Number);
    const [actualWidth, actualHeight] = evidence.metadata.resolution.split('x').map(Number);
    
    if (actualWidth < minWidth || actualHeight < minHeight) {
      warnings.push(`Resolution ${evidence.metadata.resolution} is below minimum ${rules.min_resolution}`);
    }
  }
}

/**
 * Validates video evidence
 */
function validateVideoEvidence(
  evidence: EvidenceItem,
  rules: EvidenceValidationRule,
  errors: string[],
  warnings: string[],
  metadata: Partial<EvidenceMetadata>
): void {
  // Validate duration
  if (rules.max_duration && evidence.metadata.duration) {
    if (evidence.metadata.duration > rules.max_duration) {
      errors.push(`Video duration ${evidence.metadata.duration}s exceeds maximum ${rules.max_duration}s`);
    }
  }
}

/**
 * Validates text evidence (log, command_output)
 */
function validateTextEvidence(
  evidence: EvidenceItem,
  rules: EvidenceValidationRule,
  errors: string[],
  warnings: string[],
  metadata: Partial<EvidenceMetadata>
): void {
  const contentStr = evidence.content.toString();
  
  // Check if content looks like structured logs
  try {
    JSON.parse(contentStr);
    metadata.format = 'application/json';
  } catch {
    // Not JSON, assume plain text
    metadata.format = 'text/plain';
  }

  // Basic text validation
  if (contentStr.trim().length === 0) {
    errors.push('Text content is empty or contains only whitespace');
  }
}

/**
 * Generates SHA-256 checksum for evidence content
 */
function generateChecksum(content: string | Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Formats bytes in human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validates multiple evidence items for a step
 */
export function validateStepEvidence(
  evidence: EvidenceItem[],
  requiredTypes: EvidenceType[],
  validationRules?: EvidenceValidationRule[]
): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata: Partial<EvidenceMetadata> = {};

  // Check if all required types are present
  const providedTypes = evidence.map(e => e.type);
  const missingTypes = requiredTypes.filter(type => !providedTypes.includes(type));
  
  if (missingTypes.length > 0) {
    errors.push(`Missing required evidence types: ${missingTypes.join(', ')}`);
  }

  // Validate each evidence item
  for (const item of evidence) {
    const validation = validateEvidence(item, validationRules);
    if (!validation.valid) {
      errors.push(`Evidence ${item.id}: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      warnings.push(`Evidence ${item.id}: ${validation.warnings.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata
  };
}