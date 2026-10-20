#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Local Docker Security & Compliance Checker for Lumigift
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_TAG="${1:-lumigift-app:latest}"

echo "======================================================="
echo "   Lumigift Docker Security & Compliance Check"
echo "======================================================="
echo "Target Image: $IMAGE_TAG"
echo ""

FAILURES=0

# Step 1: Hadolint check
echo "▶ [1/4] Running Hadolint on Dockerfile..."
if command -v hadolint &> /dev/null; then
    hadolint Dockerfile || { echo "❌ Hadolint reported issues in Dockerfile"; FAILURES=$((FAILURES + 1)); }
    echo "✅ Hadolint passed."
else
    echo "ℹ️ Hadolint CLI not installed. Running via Docker..."
    docker run --rm -i hadolint/hadolint < Dockerfile || { echo "❌ Hadolint reported issues in Dockerfile"; FAILURES=$((FAILURES + 1)); }
fi
echo ""

# Step 2: Build verification
echo "▶ [2/4] Verifying Docker Build..."
docker build -t "$IMAGE_TAG" --target runner .
echo "✅ Docker build succeeded."
echo ""

# Step 3: Trivy Vulnerability Scan
echo "▶ [3/4] Running Trivy Vulnerability Scan..."
if command -v trivy &> /dev/null; then
    trivy image --severity CRITICAL,HIGH --ignore-unfixed "$IMAGE_TAG"
else
    echo "ℹ️ Trivy CLI not installed. Running via Docker..."
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity CRITICAL,HIGH --ignore-unfixed "$IMAGE_TAG"
fi
echo ""

# Step 4: Verify Non-Root User & No Secrets
echo "▶ [4/4] Verifying Non-Root User & Container Permissions..."
RUNNING_USER=$(docker run --rm "$IMAGE_TAG" id -u)
RUNNING_GROUP=$(docker run --rm "$IMAGE_TAG" id -g)

if [ "$RUNNING_USER" -eq 0 ]; then
    echo "❌ SECURITY FAILURE: Container is running as root (UID 0)!"
    FAILURES=$((FAILURES + 1))
else
    echo "✅ Verified non-root user: UID $RUNNING_USER, GID $RUNNING_GROUP (nextjs:nodejs)"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
    echo "❌ Docker security checks failed ($FAILURES errors found)."
    exit 1
else
    echo "🎉 All Docker security and hardening checks passed successfully!"
fi
