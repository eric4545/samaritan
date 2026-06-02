#!/bin/bash
set -e

echo "🚀 Starting deployment of web-server..."

# Apply Kubernetes manifests
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Wait for rollout to complete
kubectl rollout status deployment/web-server --timeout=300s

echo "✅ Deployment complete."
