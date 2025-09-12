export interface PreflightCheck {
  name: string;
  description?: string;
  command: string;
  expect_empty?: boolean;
}

export interface Step {
  name: string;
  type: 'automatic' | 'manual' | 'approval';
  description?: string;
  command: string;
}

export interface Environment {
  name: string;
  description?: string;
  variables?: Record<string, any>;
  approval_required?: boolean;
  validation_required?: boolean;
  targets?: string[]; // Moved targets here
}

// MatrixConfig removed

export interface Operation {
  name: string;
  version: string;
  description: string;
  environments?: Environment[];
  // targets removed from here
  preflight: PreflightCheck[];
  steps: Step[];
}