#!/bin/bash
set -e

echo "Deploying web server..."
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/web-server --timeout=120s
echo "Deployment complete."
