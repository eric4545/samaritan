import type { Priority, QRHCategory, Step } from './operation';

// Re-export types used by QRH
export type { Priority, QRHCategory };

export interface QRHEntry {
  id: string;
  title: string;
  category: QRHCategory;
  keywords: string[];
  priority: Priority;
  procedure: Step[];
  related_operations: string[];
  last_updated: Date;
  author: string;
  pagerduty_alerts: string[];
  description?: string;
  estimated_time?: number; // Minutes to complete
  prerequisites?: string[];
  troubleshooting_tips?: string[];
}

export interface OperationExample {
  name: string;
  description: string;
  yaml_content: string;
  use_case: string;
  complexity: 'simple' | 'intermediate' | 'advanced';
}

export interface MarketplaceOperation {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  repository_url: string;
  documentation_url: string;
  compatible_versions: string[];
  dependencies: string[];
  examples: OperationExample[];
  license?: string;
  created_at: Date;
  updated_at: Date;
}
