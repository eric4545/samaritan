#!/bin/bash
set -e

echo "Running child deploy script..."
kubectl apply -f k8s/child-deployment.yaml
echo "Child deploy complete."
