import { Command } from 'commander';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

interface ProjectTemplate {
  name: string;
  description: string;
  files: { [path: string]: string };
}

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

const OPERATION_TEMPLATES: { [key: string]: ProjectTemplate } = {
  'deploy-service': {
    name: 'Service Deployment',
    description: 'Deploy a microservice to Kubernetes',
    files: {
      'operations/deploy-service.yaml': EXAMPLE_OPERATION.replace('example-deployment', 'deploy-service')
    }
  },
  'database-backup': {
    name: 'Database Backup',
    description: 'Backup database with verification',
    files: {
      'operations/database-backup.yaml': `operation:
  name: database-backup
  version: 1.0.0
  description: Backup database with verification
  category: backup

environments:
  - name: production
    variables:
      db_host: prod-db.example.com
      backup_bucket: s3://prod-backups
      retention_days: 30

steps:
  - name: create-backup
    type: automatic
    command: pg_dump -h \${db_host} -U backup_user database_name | gzip > backup_\${DATE}.sql.gz
    timeout: 1800
    evidence_required: true
    
  - name: upload-backup
    type: automatic  
    command: aws s3 cp backup_\${DATE}.sql.gz \${backup_bucket}/\${DATE}/
    timeout: 600
    
  - name: verify-backup
    type: manual
    instruction: |
      1. Check backup file size is reasonable
      2. Verify backup can be read: gunzip -t backup_\${DATE}.sql.gz
      3. Confirm S3 upload completed successfully
`
    }
  }
};

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

  if (template && !OPERATION_TEMPLATES[template]) {
    console.error(`❌ Unknown template: ${template}`);
    console.log('Available templates:');
    Object.entries(OPERATION_TEMPLATES).forEach(([key, tmpl]) => {
      console.log(`  - ${key}: ${tmpl.description}`);
    });
    process.exit(1);
  }

  // Simple implementation - just copy template or example
  const templateData = template ? OPERATION_TEMPLATES[template] : OPERATION_TEMPLATES['deploy-service'];
  const operationName = template ? template.replace('-', '_') : 'new_operation';
  const fileName = `operations/${operationName}_${Date.now()}.yaml`;

  await writeFile(fileName, Object.values(templateData.files)[0]);
  console.log(`✅ Created operation: ${fileName}`);
  console.log('\nNext steps:');
  console.log(`  1. Edit ${fileName} with your specific requirements`);
  console.log(`  2. samaritan validate ${fileName}`);
  console.log(`  3. samaritan run ${operationName} --env <environment>`);
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
  .option('--template <name>', 'Use a template (deploy-service, database-backup)')
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