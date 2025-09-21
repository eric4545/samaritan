// Evidence collection and validation module
export { validateEvidence, validateStepEvidence } from './validator';
export { 
  EvidenceCollector, 
  createEvidenceCollector, 
  createEvidenceRequirements 
} from './collector';

// Re-export evidence models for convenience
export {
  EvidenceItem,
  EvidenceMetadata,
  EvidenceValidationResult,
  EvidenceRequirement,
  EvidenceValidationRule,
  EvidenceCollectionState,
  RetryRecord,
  ApprovalRecord
} from '../models/evidence';

// Re-export evidence types
export { EvidenceType } from '../models/operation';