#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Generate Software Bill of Materials (SBOM) for Lumigift Docker Image
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_TAG="${1:-lumigift-app:latest}"
OUTPUT_DIR="${2:-./build/sbom}"

echo "======================================================="
echo "   Lumigift SBOM Generation Tool"
echo "======================================================="
echo "Target Image: $IMAGE_TAG"
echo "Output Dir:   $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR"

# Check if Syft is installed
if command -v syft &> /dev/null; then
    echo "🔍 Generating SPDX JSON SBOM via Syft..."
    syft "$IMAGE_TAG" -o spdx-json > "$OUTPUT_DIR/lumigift-sbom.spdx.json"
    
    echo "🔍 Generating CycloneDX JSON SBOM via Syft..."
    syft "$IMAGE_TAG" -o cyclonedx-json > "$OUTPUT_DIR/lumigift-sbom.cdx.json"
    
    echo "🔍 Generating Human-Readable Table SBOM..."
    syft "$IMAGE_TAG" -o table > "$OUTPUT_DIR/lumigift-sbom.txt"

    echo ""
    echo "✅ SBOM generation complete:"
    echo "   - $OUTPUT_DIR/lumigift-sbom.spdx.json (SPDX standard)"
    echo "   - $OUTPUT_DIR/lumigift-sbom.cdx.json (CycloneDX standard)"
    echo "   - $OUTPUT_DIR/lumigift-sbom.txt (Summary table)"
elif command -v docker &> /dev/null && docker sbom --version &> /dev/null; then
    echo "🔍 Generating SPDX SBOM via Docker SBOM CLI plugin..."
    docker sbom "$IMAGE_TAG" --format spdx-json --output "$OUTPUT_DIR/lumigift-sbom.spdx.json"
    docker sbom "$IMAGE_TAG" --format cyclonedx-json --output "$OUTPUT_DIR/lumigift-sbom.cdx.json"
    echo "✅ SBOM generated using Docker SBOM plugin."
else
    echo "⚠️ Neither 'syft' nor 'docker sbom' was found in PATH."
    echo "   Install Syft: https://github.com/anchore/syft#installation"
    echo "   Or run via Docker: docker run --rm -v /var/run/docker.sock:/var/run/docker.sock anchore/syft $IMAGE_TAG -o spdx-json > $OUTPUT_DIR/lumigift-sbom.spdx.json"
    exit 1
fi
