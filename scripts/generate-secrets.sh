#!/bin/bash

# Script to generate cryptographically secure secrets for Lumigift
# Usage: ./scripts/generate-secrets.sh

set -e

echo "🔐 Generating cryptographic secrets for Lumigift..."
echo ""

# Generate NEXTAUTH_SECRET
NEXTAUTH_SECRET=$(openssl rand -base64 32)
echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
echo ""

# Generate CSRF_SECRET
CSRF_SECRET=$(openssl rand -base64 32)
echo "CSRF_SECRET=$CSRF_SECRET"
echo ""

# Generate CRON_SECRET
CRON_SECRET=$(openssl rand -base64 32)
echo "CRON_SECRET=$CRON_SECRET"
echo ""

echo "✅ High-entropy secrets generated successfully!"
echo ""
echo "📝 For local development: copy these to .env.local"
echo "☁️  For AWS Secrets Manager (production):"
echo "   aws secretsmanager put-secret-value --secret-id lumigift/prod/NEXTAUTH_SECRET --secret-string \"$NEXTAUTH_SECRET\""
echo "   aws secretsmanager put-secret-value --secret-id lumigift/prod/CSRF_SECRET --secret-string \"$CSRF_SECRET\""
echo "   aws secretsmanager put-secret-value --secret-id lumigift/prod/CRON_SECRET --secret-string \"$CRON_SECRET\""

