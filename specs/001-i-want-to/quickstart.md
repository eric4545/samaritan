# SAMARITAN Quickstart Guide

**Quick Setup**: 5 minutes to first operation execution  
**Prerequisites**: Node.js 22+, Git, optional (Jira, Confluence access)

## Installation

```bash
# Option 1: One-time execution (recommended)
npx @samaritan/cli --version

# Option 2: Global installation
npm install -g @samaritan/cli
samaritan --version
```

## 1. Initialize Project (2 minutes)

```bash
# Create new SAMARITAN project
mkdir my-operations && cd my-operations
npx @samaritan/cli init

# Or add to existing Git repo
cd existing-project
npx @samaritan/cli init --existing
```

**Expected Output**:
```
✅ SAMARITAN initialized successfully!
📁 Created: operations/ directory
📁 Created: qrh/ directory  
📁 Created: templates/ directory
📄 Created: samaritan.config.yaml
🎯 Ready to create your first operation!
```

## 2. Create Your First Operation (2 minutes)

```bash
# Interactive operation creation
npx @samaritan/cli create operation

# Or use template
npx @samaritan/cli create operation --template deploy-service
```

**Example: Simple Deployment Operation**
```yaml
# operations/deploy-webapp.yaml
operation:
  name: deploy-webapp
  version: 1.0.0
  description: Deploy web application to staging and production
  
environments:
  - name: staging
    variables:
      cluster: staging-k8s
      replicas: 2
      domain: staging.example.com
  - name: production  
    variables:
      cluster: prod-k8s
      replicas: 5
      domain: example.com
    approval_required: true

preflight:
  - name: check-git-status
    command: git status --porcelain
    expect_empty: true
    description: Ensure no uncommitted changes

steps:
  - name: build-docker-image
    type: automatic
    command: docker build -t webapp:${VERSION} .
    timeout: 300
    evidence_required: true
    
  - name: verify-image
    type: manual
    instruction: |
      1. Check Docker image size: docker images webapp:${VERSION}
      2. Verify image runs locally: docker run -p 8080:8080 webapp:${VERSION}
      3. Test health endpoint: curl http://localhost:8080/health
    evidence_required: true
    
  - name: deploy-to-cluster
    type: automatic  
    command: kubectl apply -f k8s/ --context ${cluster}
    timeout: 180
    rollback:
      command: kubectl rollout undo deployment/webapp --context ${cluster}
      
  - name: wait-for-rollout
    type: automatic
    command: kubectl rollout status deployment/webapp --context ${cluster} --timeout=300s
    
  - name: smoke-test
    type: manual
    instruction: |
      Verify deployment success:
      1. Check pods: kubectl get pods -l app=webapp --context ${cluster}
      2. Test application: curl https://${domain}/health
      3. Verify logs: kubectl logs -l app=webapp --tail=50 --context ${cluster}
    evidence_required: true
```

## 3. Validate Operation (30 seconds)

```bash
# Check operation syntax and logic
npx @samaritan/cli validate operations/deploy-webapp.yaml

# Strict validation with best practices
npx @samaritan/cli validate operations/deploy-webapp.yaml --strict
```

**Expected Output**:
```
✅ Operation validation passed
📋 2 environments defined
🔄 4 steps configured
⚠️  Recommendations:
   - Add retry configuration for network operations
   - Consider adding manual override for automatic steps
```

## 4. Execute Operation (1 minute)

```bash
# Run operation interactively
npx @samaritan/cli run deploy-webapp --env staging

# Non-interactive with variables
npx @samaritan/cli run deploy-webapp --env staging --var VERSION=1.2.3 --auto-approve

# Resume interrupted operation
npx @samaritan/cli resume <session-id>
```

**Execution Flow**:
```
🚀 Starting operation: deploy-webapp (staging)
📋 Running preflight checks...
   ✅ check-git-status: No uncommitted changes

🔄 Step 1/4: build-docker-image (automatic)
   ⏳ Executing: docker build -t webapp:1.2.3 .
   ✅ Completed in 45s
   📸 Evidence captured: build-log.txt

📝 Step 2/4: verify-image (manual)
   📖 Instructions:
      1. Check Docker image size: docker images webapp:1.2.3
      2. Verify image runs locally: docker run -p 8080:8080 webapp:1.2.3  
      3. Test health endpoint: curl http://localhost:8080/health
   
   📷 Upload evidence (screenshot/file)? [Y/n]: Y
   📁 Drop files here or press Enter to use camera: screenshot.png
   ✅ Evidence uploaded: screenshot.png
   
✅ Mark step complete? [Y/n]: Y

🔄 Step 3/4: deploy-to-cluster (automatic)
   ⏳ Executing: kubectl apply -f k8s/ --context staging-k8s
   ✅ Deployment updated: webapp
   ✅ Service updated: webapp-service
   
🔄 Step 4/4: wait-for-rollout (automatic)
   ⏳ Waiting for rollout completion...
   ✅ deployment "webapp" successfully rolled out

📝 Step 5/5: smoke-test (manual)
   📖 Instructions: [Verify deployment success steps...]
   ✅ Step completed

🎉 Operation completed successfully!
📊 Summary:
   - Duration: 3m 42s
   - Evidence items: 3
   - All steps passed
   
📄 Generate documentation? [Y/n]: Y
📄 Documentation saved: ./docs/deploy-webapp-staging-20250909.md
```

## 5. Generate Documentation (30 seconds)

```bash
# Generate operation manual
npx @samaritan/cli generate docs deploy-webapp --format confluence

# Export evidence report
npx @samaritan/cli export evidence --session <session-id> --format pdf
```

**Generated Documentation**: 
- Operation manual with step-by-step instructions
- Evidence gallery with screenshots and logs
- Environment comparison table
- Execution timeline and metrics
- Approval records and participant history

## Advanced Features (Optional)

### QRH (Quick Reference Handbook)
```bash
# Search emergency procedures
npx @samaritan/cli qrh search "database connection failed"
npx @samaritan/cli qrh search --priority P0

# Execute emergency procedure
npx @samaritan/cli qrh run database-failover
```

### Operation Marketplace
```bash
# Browse community operations
npx @samaritan/cli marketplace search "kubernetes deployment"

# Install operation from marketplace
npx @samaritan/cli marketplace install deploy-k8s-app@1.5.0

# Use marketplace operation
npx @samaritan/cli run deploy-k8s-app --env production
```

### Manual Mode Generation
```bash
# Generate manual playbook from automated operation
npx @samaritan/cli generate manual deploy-webapp

# Switch to manual mode during execution
# (During operation execution, press Ctrl+M to switch modes)
```

## Configuration

### samaritan.config.yaml
```yaml
# Global configuration
version: "1.0"
project:
  name: "My SRE Operations"
  team: "Platform Team"
  
# Integration settings
integrations:
  jira:
    base_url: "https://company.atlassian.net"
    project_key: "SRE"
    
  confluence:
    base_url: "https://company.atlassian.net/wiki"
    space_key: "DOCS"
    
  git:
    operations_repo: "git@github.com:company/sre-operations.git"
    branch: "main"

# Evidence collection
evidence:
  auto_screenshot: true
  capture_logs: true
  max_file_size: "50MB"
  
# Execution settings
execution:
  default_mode: "automatic"
  session_timeout: "4h"
  checkpoint_interval: "5m"
```

### Environment Variables
```bash
# Required for integrations
export JIRA_TOKEN="..." 
export CONFLUENCE_TOKEN="..."

# Optional for Git operations
export GITHUB_TOKEN="ghp_..."
```

## Next Steps

1. **Create more operations**: Use templates or build from scratch
2. **Set up integrations**: Connect Jira, Confluence, and Git repositories  
3. **Build QRH entries**: Document emergency procedures
4. **Train your team**: Share operations and best practices
5. **Explore marketplace**: Find and contribute reusable operations

## Success Indicators

After completing this quickstart, you should have:

- ✅ SAMARITAN CLI installed and working
- ✅ First operation created and validated
- ✅ Successful operation execution with evidence  
- ✅ Generated documentation in your preferred format
- ✅ Basic understanding of manual/automatic modes
- ✅ Configuration file tailored to your environment

**Total Setup Time**: ~5 minutes  
**First Operation Success**: ~10 minutes
**Ready for Production Use**: ~30 minutes (including integrations)

## Troubleshooting

**Common Issues**:
- `Command not found`: Ensure Node.js 22+ is installed
- `Permission denied`: Check Git repository access and tokens
- `Validation failed`: Review operation YAML syntax
- `Evidence upload failed`: Check file size and format limits

**Get Help**:
```bash
npx @samaritan/cli help
npx @samaritan/cli docs
npx @samaritan/cli support
```

Ready to transform your SRE operations? Start with `npx @samaritan/cli init`! 🚀