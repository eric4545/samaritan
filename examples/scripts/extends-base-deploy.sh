#!/bin/bash
set -e

echo "🚀 Running shared base deployment script..."
kubectl apply -f k8s/base-deployment.yaml
kubectl rollout status deployment/web-server --timeout=300s
echo "✅ Base deployment complete."
