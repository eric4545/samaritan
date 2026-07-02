#!/bin/bash
set -e

echo "Running base deploy script..."
kubectl apply -f k8s/base-deployment.yaml
echo "Base deploy complete."
