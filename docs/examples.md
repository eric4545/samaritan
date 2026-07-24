# Examples

Worked operations. Every file under `examples/` is validated in CI, so these are copy-ready starting points.

## Simple Database Backup

```yaml
name: Database Backup
version: 1.0.0
description: Create and verify database backup

environments:
  - name: production
    variables:
      DB_NAME: webapp_prod
      BACKUP_BUCKET: s3://backups-prod

steps:
  - name: Create Backup
    type: manual
    instruction: |
      Create database backup:
      ```bash
      pg_dump ${DB_NAME} | gzip > backup_$(date +%Y%m%d).sql.gz
      ```
      Timeout: 1800s (30 minutes)
    evidence:
      required: true
      types: [screenshot, log]

  - name: Upload to S3
    type: manual
    instruction: |
      Upload backup to S3:
      ```bash
      aws s3 cp backup_*.sql.gz ${BACKUP_BUCKET}/
      ```
    evidence:
      required: true
      types: [screenshot]

  - name: Verify Backup
    type: manual
    instruction: |
      1. Check backup file exists in S3: ${BACKUP_BUCKET}
      2. Verify file size is reasonable (>100MB)
      3. Download and test restore on test database
    evidence:
      required: true
      types: [screenshot, log]
```

## Incident Response

```yaml
name: Service Restart Emergency
version: 1.0.0
description: Emergency service restart procedure
emergency: true
category: incident

environments:
  - name: production
    variables:
      SERVICE_NAME: webapp
      NAMESPACE: production

steps:
  - name: Check Service Status
    type: manual
    phase: preflight
    instruction: |
      Check current pod status:
      ```bash
      kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME}
      ```
      Document current state before proceeding.
    evidence:
      required: true
      types: [screenshot]

  - name: Scale Down Service
    type: manual
    instruction: |
      Scale service to zero replicas:
      ```bash
      kubectl scale deployment ${SERVICE_NAME} --replicas=0 -n ${NAMESPACE}
      ```
      Wait for all pods to terminate.
    evidence:
      required: true
      types: [screenshot]

  - name: Clear Cache
    type: manual
    instruction: |
      Clear Redis cache:
      1. Connect to Redis: redis-cli -h cache.company.com
      2. Run: FLUSHALL
      3. Confirm with: INFO keyspace
    evidence:
      required: true
      types: [screenshot, log]

  - name: Scale Up Service
    type: manual
    instruction: |
      Scale service back to 3 replicas:
      ```bash
      kubectl scale deployment ${SERVICE_NAME} --replicas=3 -n ${NAMESPACE}
      ```

      Verify all pods are running:
      ```bash
      kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME} | grep Running | wc -l
      ```
      Expected output: 3
    evidence:
      required: true
      types: [screenshot]
```
