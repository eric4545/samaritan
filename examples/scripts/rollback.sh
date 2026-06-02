#!/bin/bash
set -e

echo "🔄 Rolling back web-server..."

# Undo the last deployment rollout
kubectl rollout undo deployment/web-server

# Wait for rollback to complete
kubectl rollout status deployment/web-server --timeout=300s

echo "✅ Rollback complete."
