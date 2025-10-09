import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { load as parseYaml } from 'js-yaml';
import { OperationExecutor } from '../../lib/executor';
import { sessionManager } from '../../lib/session-manager';
import type { Priority, QRHCategory, QRHEntry } from '../../models/qrh';

interface QRHSearchOptions {
  priority?: Priority;
  category?: QRHCategory;
  limit?: number;
  verbose?: boolean;
}

interface QRHRunOptions {
  environment?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

class QRHManager {
  private qrhDirectory: string;

  constructor(qrhDirectory: string = './qrh') {
    this.qrhDirectory = qrhDirectory;
  }

  async loadAllEntries(): Promise<QRHEntry[]> {
    if (!existsSync(this.qrhDirectory)) {
      return [];
    }

    const files = await readdir(this.qrhDirectory);
    const yamlFiles = files.filter(
      (file) => file.endsWith('.yaml') || file.endsWith('.yml'),
    );

    const entries: QRHEntry[] = [];

    for (const file of yamlFiles) {
      try {
        const content = await readFile(join(this.qrhDirectory, file), 'utf8');
        const data = parseYaml(content) as any;

        if (data.qrh) {
          entries.push(data.qrh as QRHEntry);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to load QRH entry from ${file}: ${error}`);
      }
    }

    return entries;
  }

  async searchEntries(
    query: string,
    options: QRHSearchOptions = {},
  ): Promise<QRHEntry[]> {
    const allEntries = await this.loadAllEntries();
    const lowerQuery = query.toLowerCase();

    let results = allEntries.filter((entry) => {
      // Text search
      const matchesText =
        entry.title.toLowerCase().includes(lowerQuery) ||
        entry.keywords.some((keyword) =>
          keyword.toLowerCase().includes(lowerQuery),
        ) ||
        entry.pagerduty_alerts.some((alert) =>
          alert.toLowerCase().includes(lowerQuery),
        ) ||
        entry.description?.toLowerCase().includes(lowerQuery);

      // Priority filter
      const matchesPriority =
        !options.priority || entry.priority === options.priority;

      // Category filter
      const matchesCategory =
        !options.category || entry.category === options.category;

      return matchesText && matchesPriority && matchesCategory;
    });

    // Sort by priority (P0 first) and then by relevance
    results.sort((a, b) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
      const aPriority = priorityOrder[a.priority] || 999;
      const bPriority = priorityOrder[b.priority] || 999;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Secondary sort by title match relevance
      const aRelevance = a.title.toLowerCase().includes(lowerQuery) ? 0 : 1;
      const bRelevance = b.title.toLowerCase().includes(lowerQuery) ? 0 : 1;
      return aRelevance - bRelevance;
    });

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async findEntryById(id: string): Promise<QRHEntry | null> {
    const allEntries = await this.loadAllEntries();
    return allEntries.find((entry) => entry.id === id) || null;
  }

  async listByPriority(priority: Priority): Promise<QRHEntry[]> {
    const allEntries = await this.loadAllEntries();
    return allEntries.filter((entry) => entry.priority === priority);
  }

  async listByCategory(category: QRHCategory): Promise<QRHEntry[]> {
    const allEntries = await this.loadAllEntries();
    return allEntries.filter((entry) => entry.category === category);
  }

  displayEntry(entry: QRHEntry, verbose: boolean = false): void {
    const priorityEmoji = {
      P0: '🚨',
      P1: '⚠️',
      P2: '⚡',
      P3: '📋',
    };

    const categoryEmoji = {
      incident: '🔥',
      alert: '🚨',
      maintenance: '🔧',
      emergency: '🆘',
    };

    console.log(
      `${priorityEmoji[entry.priority]} ${categoryEmoji[entry.category]} ${entry.title}`,
    );
    console.log(`   ID: ${entry.id}`);
    console.log(`   Priority: ${entry.priority} | Category: ${entry.category}`);

    if (entry.estimated_time) {
      console.log(`   Estimated Time: ${entry.estimated_time} minutes`);
    }

    if (verbose) {
      if (entry.description) {
        console.log(`   Description: ${entry.description}`);
      }

      if (entry.keywords.length > 0) {
        console.log(`   Keywords: ${entry.keywords.join(', ')}`);
      }

      if (entry.pagerduty_alerts.length > 0) {
        console.log(
          `   PagerDuty Alerts: ${entry.pagerduty_alerts.join(', ')}`,
        );
      }

      if (entry.prerequisites && entry.prerequisites.length > 0) {
        console.log(`   Prerequisites: ${entry.prerequisites.join(', ')}`);
      }

      console.log(`   Author: ${entry.author}`);
      console.log(`   Last Updated: ${entry.last_updated.toDateString()}`);
    }

    console.log('');
  }

  async executeEntry(entryId: string, options: QRHRunOptions): Promise<void> {
    const entry = await this.findEntryById(entryId);
    if (!entry) {
      throw new Error(`QRH entry not found: ${entryId}`);
    }

    console.log(`🆘 Executing emergency procedure: ${entry.title}`);
    console.log(
      `   Priority: ${entry.priority} | Estimated Time: ${entry.estimated_time || 'Unknown'} minutes\n`,
    );

    if (entry.prerequisites && entry.prerequisites.length > 0) {
      console.log('📋 Prerequisites:');
      for (const prereq of entry.prerequisites) {
        console.log(`   - ${prereq}`);
      }
      console.log('');
    }

    // Convert QRH entry to operation-like format for execution
    const operation = this.qrhToOperation(
      entry,
      options.environment || 'emergency',
    );

    // Create execution context
    const context = {
      operationId: entry.id,
      environment: options.environment || 'emergency',
      variables: {},
      operator: process.env.USER || 'qrh-operator',
      sessionId: `qrh-${entry.id}-${Date.now()}`,
      dryRun: options.dryRun || false,
      autoMode: options.autoApprove || false,
    };

    // Create session
    const session = sessionManager.createSession(
      entry.id,
      context.environment,
      context.operator,
      options.autoApprove ? 'automatic' : 'manual',
    );

    // Execute with executor
    const executor = new OperationExecutor(operation, context);
    sessionManager.associateExecutor(session.id, executor);

    console.log(`🔄 Session started: ${session.id}`);

    if (options.verbose) {
      executor.on('step_started', (event) => {
        console.log(`▶️  Starting: ${event.step.name}`);
      });

      executor.on('step_completed', (event) => {
        console.log(`✅ Completed: ${event.step.name}`);
      });

      executor.on('step_failed', (event) => {
        console.log(`❌ Failed: ${event.step.name} - ${event.error}`);
      });
    }

    try {
      await executor.execute();
      console.log(`\n✅ Emergency procedure completed successfully!`);

      if (entry.troubleshooting_tips && entry.troubleshooting_tips.length > 0) {
        console.log('\n💡 Additional Troubleshooting Tips:');
        for (const tip of entry.troubleshooting_tips) {
          console.log(`   - ${tip}`);
        }
      }
    } catch (error: any) {
      console.error(`\n❌ Emergency procedure failed: ${error.message}`);

      if (entry.troubleshooting_tips && entry.troubleshooting_tips.length > 0) {
        console.log('\n💡 Troubleshooting Tips:');
        for (const tip of entry.troubleshooting_tips) {
          console.log(`   - ${tip}`);
        }
      }

      throw error;
    }
  }

  private qrhToOperation(entry: QRHEntry, environment: string): any {
    return {
      id: entry.id,
      name: entry.title,
      version: '1.0.0',
      description: entry.description || entry.title,
      category: entry.category,
      emergency: true,
      environments: [
        {
          name: environment,
          description: `Emergency environment for ${entry.title}`,
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { [environment]: {} },
      steps: entry.procedure,
      preflight: [],
      metadata: {
        created_at: entry.last_updated,
        updated_at: entry.last_updated,
        source: `qrh/${entry.id}.yaml`,
      },
    };
  }
}

// QRH command with subcommands
const qrhCommand = new Command('qrh').description(
  'Quick Reference Handbook for emergency procedures',
);

qrhCommand
  .command('search <query>')
  .description('Search emergency procedures')
  .option('-p, --priority <priority>', 'Filter by priority (P0, P1, P2, P3)')
  .option(
    '-c, --category <category>',
    'Filter by category (incident, alert, maintenance, emergency)',
  )
  .option('-l, --limit <number>', 'Limit number of results', parseInt)
  .option('-v, --verbose', 'Show detailed information')
  .action(async (query: string, options: QRHSearchOptions) => {
    try {
      const qrh = new QRHManager();
      const results = await qrh.searchEntries(query, options);

      if (results.length === 0) {
        console.log(`❌ No emergency procedures found for: "${query}"`);
        console.log(
          '💡 Try broader search terms or check available procedures with "samaritan qrh list"',
        );
        return;
      }

      console.log(
        `🔍 Found ${results.length} emergency procedure(s) for: "${query}"\n`,
      );

      results.forEach((entry) => {
        qrh.displayEntry(entry, options.verbose);
      });
    } catch (error: any) {
      console.error(`❌ Search failed: ${error.message}`);
      process.exit(1);
    }
  });

qrhCommand
  .command('list')
  .description('List all emergency procedures')
  .option('-p, --priority <priority>', 'Filter by priority (P0, P1, P2, P3)')
  .option(
    '-c, --category <category>',
    'Filter by category (incident, alert, maintenance, emergency)',
  )
  .option('-v, --verbose', 'Show detailed information')
  .action(async (options: QRHSearchOptions) => {
    try {
      const qrh = new QRHManager();
      let results: QRHEntry[];

      if (options.priority) {
        results = await qrh.listByPriority(options.priority);
      } else if (options.category) {
        results = await qrh.listByCategory(options.category);
      } else {
        results = await qrh.loadAllEntries();
      }

      if (results.length === 0) {
        console.log('❌ No emergency procedures found');
        console.log(
          '💡 Create your first QRH entry with "samaritan create qrh"',
        );
        return;
      }

      console.log(`📚 Emergency Procedures (${results.length} total)\n`);

      // Group by priority for better display
      const grouped = results.reduce(
        (acc, entry) => {
          if (!acc[entry.priority]) acc[entry.priority] = [];
          acc[entry.priority].push(entry);
          return acc;
        },
        {} as Record<Priority, QRHEntry[]>,
      );

      ['P0', 'P1', 'P2', 'P3'].forEach((priority) => {
        if (grouped[priority as Priority]) {
          console.log(`🚨 ${priority} Priority:`);
          grouped[priority as Priority].forEach((entry) => {
            qrh.displayEntry(entry, options.verbose);
          });
        }
      });
    } catch (error: any) {
      console.error(`❌ Failed to list procedures: ${error.message}`);
      process.exit(1);
    }
  });

qrhCommand
  .command('run <procedure-id>')
  .description('Execute an emergency procedure')
  .option('-e, --env <environment>', 'Target environment', 'emergency')
  .option('--auto-approve', 'Auto-approve manual steps')
  .option('--dry-run', 'Show what would be executed without running')
  .option('-v, --verbose', 'Verbose output')
  .action(async (procedureId: string, options: QRHRunOptions) => {
    try {
      const qrh = new QRHManager();
      await qrh.executeEntry(procedureId, options);
    } catch (error: any) {
      console.error(`❌ Emergency procedure failed: ${error.message}`);
      process.exit(1);
    }
  });

qrhCommand
  .command('show <procedure-id>')
  .description('Show detailed information about a procedure')
  .action(async (procedureId: string) => {
    try {
      const qrh = new QRHManager();
      const entry = await qrh.findEntryById(procedureId);

      if (!entry) {
        console.error(`❌ Procedure not found: ${procedureId}`);
        process.exit(1);
      }

      qrh.displayEntry(entry, true);

      console.log('📋 Procedure Steps:');
      entry.procedure.forEach((step, index) => {
        console.log(`\n${index + 1}. ${step.name}`);
        console.log(`   Type: ${step.type}`);
        if (step.description)
          console.log(`   Description: ${step.description}`);
        if (step.command) console.log(`   Command: ${step.command}`);
        if (step.instruction)
          console.log(`   Instructions: ${step.instruction}`);
        if (step.evidence_required) console.log(`   Evidence Required: Yes`);
      });

      if (entry.related_operations && entry.related_operations.length > 0) {
        console.log(
          `\n🔗 Related Operations: ${entry.related_operations.join(', ')}`,
        );
      }
    } catch (error: any) {
      console.error(`❌ Failed to show procedure: ${error.message}`);
      process.exit(1);
    }
  });

export { qrhCommand };
