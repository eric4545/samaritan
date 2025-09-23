import { Command } from 'commander';
import { mkdir, writeFile, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';


const DEFAULT_CONFIG = `# SAMARITAN Configuration
project:
  name: ${process.cwd().split('/').pop() || 'my-operations'}
  version: 1.0.0
  description: SAMARITAN operations repository

integrations:
  confluence:
    enabled: false
    space: ""
    base_url: ""
  
  jira:
    enabled: false
    project: ""
    base_url: ""
  
  pagerduty:
    enabled: false
    api_key: ""

evidence:
  retention_days: 90
  auto_archive: true
  storage_path: .samaritan/evidence/

templates:
  default_author: ""
  default_category: "maintenance"
`;

const EXAMPLE_OPERATION = `operation:
  name: example-deployment
  version: 1.0.0
  description: Example deployment operation
  author: \${USER}
  category: deployment

environments:
  - name: staging
    description: Staging environment
    variables:
      cluster: staging-k8s
      replicas: 2
      domain: staging.example.com
    restrictions: []
    approval_required: false
    validation_required: false
    
  - name: production
    description: Production environment
    variables:
      cluster: prod-k8s
      replicas: 5
      domain: example.com
    restrictions: ["production-access"]
    approval_required: true
    validation_required: true

preflight:
  - name: check-git-status
    type: command
    command: git status --porcelain
    condition: "output should be empty"
    description: Ensure no uncommitted changes
    timeout: 30

steps:
  - name: build-application
    type: automatic
    description: Build the application artifacts
    command: npm run build
    timeout: 300
    evidence_required: true
    evidence_types: ["command_output"]
    
  - name: verify-build
    type: manual
    description: Verify the build artifacts are correct
    instruction: |
      1. Check that dist/ directory exists
      2. Verify main.js and main.css are present
      3. Test that index.html loads correctly
    estimated_duration: 120
    evidence_required: true
    evidence_types: ["screenshot"]
    
  - name: deploy-to-environment
    type: automatic
    description: Deploy to \${environment} environment
    command: kubectl apply -f k8s/ --context \${cluster}
    timeout: 180
    evidence_required: true
    rollback:
      command: kubectl rollout undo deployment/app --context \${cluster}
      timeout: 120
    
  - name: verify-deployment
    type: manual
    description: Verify deployment is successful
    instruction: |
      1. Check application health at https://\${domain}/health
      2. Verify all \${replicas} pods are running
      3. Test key functionality works correctly
    estimated_duration: 300
    evidence_required: true
    evidence_types: ["screenshot", "log"]

rollback:
  automatic: false
  steps:
    - command: kubectl rollout undo deployment/app --context \${cluster}
    - instruction: Verify rollback completed successfully

metadata:
  created_at: \${DATE}
  updated_at: \${DATE}
`;

const EXAMPLE_QRH = `qrh:
  id: database-connection-failure
  title: Database Connection Failure Response
  category: incident
  priority: P1
  keywords: ["database", "connection", "timeout", "mysql", "postgres"]
  pagerduty_alerts: ["database.*connection.*failed", "mysql.*timeout"]
  estimated_time: 15
  author: sre-team

procedure:
  - name: check-database-status
    type: automatic
    command: kubectl get pods -l app=database -n production
    description: Check if database pods are running
    
  - name: verify-network-connectivity
    type: manual
    instruction: |
      1. Test connection from app pods: kubectl exec -it <app-pod> -- telnet db-service 5432
      2. Check service endpoints: kubectl get endpoints db-service -n production
      3. Verify security groups allow traffic on port 5432
    evidence_required: true
    
  - name: check-database-logs
    type: automatic
    command: kubectl logs -l app=database -n production --tail=100
    description: Review recent database logs for errors
    
  - name: restart-database-if-needed
    type: manual
    instruction: |
      Only if pods are in CrashLoopBackOff or Error state:
      1. Scale down: kubectl scale deployment database --replicas=0 -n production
      2. Wait 30 seconds
      3. Scale up: kubectl scale deployment database --replicas=3 -n production
      4. Monitor: kubectl get pods -l app=database -n production -w

related_operations:
  - database-maintenance
  - full-system-restart

troubleshooting_tips:
  - "Check if connection pool is exhausted"
  - "Verify database credentials haven't expired"
  - "Look for recent schema changes that might have caused issues"
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Available operation templates
const TEMPLATE_DESCRIPTIONS: { [key: string]: string } = {
  'deployment': 'Application deployment with approval gates',
  'backup': 'Database backup with verification',
  'incident-response': 'Emergency incident response procedure',
  'maintenance': 'Routine maintenance operations'
};

async function loadTemplate(templateName: string): Promise<string> {
  try {
    const templatePath = join(__dirname, '../../../templates/operations', `${templateName}.yaml`);
    const template = await readFile(templatePath, 'utf8');
    return template;
  } catch (error) {
    throw new Error(`Template '${templateName}' not found`);
  }
}

async function getAvailableTemplates(): Promise<string[]> {
  try {
    const templatesDir = join(__dirname, '../../../templates/operations');
    const files = await readdir(templatesDir);
    return files.filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''));
  } catch (error) {
    return Object.keys(TEMPLATE_DESCRIPTIONS);
  }
}


async function createDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function initProject(existing: boolean = false): Promise<void> {
  console.log('🚀 Initializing SAMARITAN project...\n');

  if (!existing) {
    // Check if directory is empty
    try {
      const files = await readdir('.');
      const importantFiles = files.filter(f => !f.startsWith('.') && !['node_modules', 'package.json', 'package-lock.json'].includes(f));
      if (importantFiles.length > 0) {
        console.error('❌ Directory is not empty. Use --existing flag to add SAMARITAN to existing project.');
        process.exit(1);
      }
    } catch (error) {
      // Directory doesn't exist or can't be read, that's fine
    }
  }

  // Create directories
  const directories = ['operations', 'qrh', 'templates', '.samaritan/sessions', '.samaritan/evidence'];
  
  for (const dir of directories) {
    await createDirectory(dir);
    console.log(`📁 Created: ${dir}/`);
  }

  // Create config file
  if (!existsSync('samaritan.config.yaml')) {
    await writeFile('samaritan.config.yaml', DEFAULT_CONFIG);
    console.log('📄 Created: samaritan.config.yaml');
  } else {
    console.log('📄 Found existing: samaritan.config.yaml');
  }

  // Create example files
  if (!existsSync('operations/example-deployment.yaml')) {
    await writeFile('operations/example-deployment.yaml', EXAMPLE_OPERATION);
    console.log('📄 Created: operations/example-deployment.yaml');
  }

  if (!existsSync('qrh/database-connection-failure.yaml')) {
    await writeFile('qrh/database-connection-failure.yaml', EXAMPLE_QRH);
    console.log('📄 Created: qrh/database-connection-failure.yaml');
  }

  // Create .gitignore
  const gitignoreContent = `.samaritan/sessions/
.samaritan/evidence/
*.log
.env
.env.local
node_modules/
`;
  
  if (!existsSync('.gitignore')) {
    await writeFile('.gitignore', gitignoreContent);
    console.log('📄 Created: .gitignore');
  } else {
    // Append to existing .gitignore
    const fs = await import('fs');
    const existingContent = await fs.promises.readFile('.gitignore', 'utf8');
    if (!existingContent.includes('.samaritan/')) {
      await fs.promises.appendFile('.gitignore', '\n# SAMARITAN\n' + gitignoreContent);
      console.log('📄 Updated: .gitignore');
    }
  }

  console.log('\n✅ SAMARITAN initialized successfully!');
  console.log('🎯 Ready to create your first operation!');
  console.log('\nNext steps:');
  console.log('  1. samaritan create operation');
  console.log('  2. samaritan validate operations/<your-operation>.yaml');
  console.log('  3. samaritan run <your-operation> --env <environment>');
}

async function createOperation(template?: string): Promise<void> {
  console.log('📝 Creating new operation...\n');

  const availableTemplates = await getAvailableTemplates();
  const templateToUse = template || 'deployment';

  if (template && !availableTemplates.includes(template)) {
    console.error(`❌ Unknown template: ${template}`);
    console.log('Available templates:');
    availableTemplates.forEach(tmpl => {
      const description = TEMPLATE_DESCRIPTIONS[tmpl] || 'Operation template';
      console.log(`  - ${tmpl}: ${description}`);
    });
    process.exit(1);
  }

  try {
    // Load template from file
    const templateContent = await loadTemplate(templateToUse);
    const operationName = templateToUse.replace('-', '_');
    const fileName = `${operationName}_${Date.now()}.yaml`;

    // Create operations directory if it doesn't exist
    if (!existsSync('operations')) {
      await mkdir('operations', { recursive: true });
    }

    const filePath = join('operations', fileName);
    await writeFile(filePath, templateContent);

    console.log(`✅ Created operation: ${filePath}`);
    console.log('\n📋 Template placeholders to customize:');
    console.log('   Replace __PLACEHOLDER__ values with your specific settings');
    console.log('\nNext steps:');
    console.log(`  1. Edit ${filePath} and replace all __PLACEHOLDER__ values`);
    console.log(`  2. npx github:eric4545/samaritan validate ${filePath}`);
    console.log(`  3. npx github:eric4545/samaritan run ${filePath} --env <environment>`);
  } catch (error: any) {
    console.error(`❌ Failed to create operation: ${error.message}`);
    process.exit(1);
  }
}

// Command definitions
const initCommand = new Command('init')
  .description('Initialize a new SAMARITAN project')
  .option('--existing', 'Add SAMARITAN to existing project')
  .action(async (options) => {
    try {
      await initProject(options.existing);
    } catch (error: any) {
      console.error(`❌ Failed to initialize project: ${error.message}`);
      process.exit(1);
    }
  });

const createCommand = new Command('create')
  .description('Create new SAMARITAN resources')
  .command('operation')
  .description('Create a new operation')
  .option('--template <name>', 'Use a template (deployment, backup, incident-response, maintenance)')
  .action(async (options) => {
    try {
      await createOperation(options.template);
    } catch (error: any) {
      console.error(`❌ Failed to create operation: ${error.message}`);
      process.exit(1);
    }
  });

export const projectCommands = {
  init: initCommand,
  create: createCommand
};