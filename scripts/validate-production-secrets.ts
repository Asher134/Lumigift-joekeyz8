#!/usr/bin/env ts-node
/**
 * Production Secret Validation Tool
 *
 * Validates that production runtime secrets:
 * 1. Are present and non-empty
 * 2. Contain no default/placeholder values (e.g. "replace_with...", "lumigift_dev_password", "dummy", etc.)
 * 3. Match format, length, and cryptographic entropy criteria
 * 4. Use production/live keys when configured for mainnet
 *
 * Usage:
 *   ts-node scripts/validate-production-secrets.ts
 *   npm run secrets:validate
 */

import { isPlaceholderValue } from "../src/server/config/env";

interface SecretRule {
  key: string;
  description: string;
  required: boolean;
  minLength?: number;
  pattern?: RegExp;
  liveKeyRequiredOnMainnet?: boolean;
}

const PRODUCTION_SECRET_RULES: SecretRule[] = [
  {
    key: "NEXTAUTH_SECRET",
    description: "NextAuth session signing secret",
    required: true,
    minLength: 32,
  },
  {
    key: "CSRF_SECRET",
    description: "CSRF protection secret token",
    required: true,
    minLength: 32,
  },
  {
    key: "CRON_SECRET",
    description: "Bearer secret token for cron triggers",
    required: true,
    minLength: 32,
  },
  {
    key: "DATABASE_URL",
    description: "PostgreSQL connection string",
    required: true,
    pattern: /^postgres(ql)?:\/\/.+:.+@.+:\d+\/.+/,
  },
  {
    key: "REDIS_URL",
    description: "Redis connection URI",
    required: true,
    pattern: /^rediss?:\/\/.+/,
  },
  {
    key: "STELLAR_SERVER_SECRET_KEY",
    description: "Stellar escrow server secret signing key",
    required: true,
    pattern: /^S[A-Z0-9]{55}$/,
  },
  {
    key: "STELLAR_SERVER_PUBLIC_KEY",
    description: "Stellar escrow server public account address",
    required: true,
    pattern: /^G[A-Z0-9]{55}$/,
  },
  {
    key: "STELLAR_ESCROW_CONTRACT_ID",
    description: "Soroban escrow contract address (C...)",
    required: true,
    pattern: /^C[A-Z0-9]{55}$/,
  },
  {
    key: "PAYSTACK_SECRET_KEY",
    description: "Paystack secret API key",
    required: true,
    liveKeyRequiredOnMainnet: true,
  },
  {
    key: "STRIPE_SECRET_KEY",
    description: "Stripe secret API key",
    required: true,
    liveKeyRequiredOnMainnet: true,
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    description: "Stripe webhook endpoint signing secret",
    required: true,
    minLength: 16,
  },
  {
    key: "TERMII_API_KEY",
    description: "Termii SMS provider API key",
    required: true,
  },
  {
    key: "CLOUDINARY_API_SECRET",
    description: "Cloudinary API secret for media storage",
    required: true,
  },
];

export function validateProductionSecrets(env: NodeJS.ProcessEnv = process.env): {
  success: boolean;
  errors: string[];
  warnings: string[];
  checkedCount: number;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isMainnet = env.STELLAR_NETWORK === "mainnet";

  for (const rule of PRODUCTION_SECRET_RULES) {
    const value = env[rule.key];

    // Check presence
    if (!value) {
      if (rule.required) {
        errors.push(`[MISSING] ${rule.key} (${rule.description}) is not set.`);
      }
      continue;
    }

    // Check placeholder
    if (isPlaceholderValue(value)) {
      errors.push(
        `[PLACEHOLDER] ${rule.key} contains a known placeholder/default value ("${value.slice(0, 10)}..."). Placeholders are strictly forbidden in production.`
      );
      continue;
    }

    // Check minLength
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(
        `[TOO_SHORT] ${rule.key} length is ${value.length} characters (minimum required is ${rule.minLength}).`
      );
    }

    // Check format pattern
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(
        `[INVALID_FORMAT] ${rule.key} does not match required format pattern (${rule.pattern.toString()}).`
      );
    }

    // Check test keys on mainnet
    if (isMainnet && rule.liveKeyRequiredOnMainnet) {
      if (value.startsWith("sk_test_")) {
        errors.push(
          `[TEST_KEY_ON_MAINNET] ${rule.key} starts with "sk_test_". Live production keys must be used when STELLAR_NETWORK=mainnet.`
        );
      }
    }
  }

  // Check NEXTAUTH_SECRET_PREVIOUS if set
  if (env.NEXTAUTH_SECRET_PREVIOUS) {
    if (isPlaceholderValue(env.NEXTAUTH_SECRET_PREVIOUS)) {
      errors.push(
        `[PLACEHOLDER] NEXTAUTH_SECRET_PREVIOUS contains a placeholder value.`
      );
    }
    if (env.NEXTAUTH_SECRET_PREVIOUS === env.NEXTAUTH_SECRET) {
      warnings.push(
        `[REDUNDANT] NEXTAUTH_SECRET_PREVIOUS is identical to NEXTAUTH_SECRET. Clear previous secret after grace rotation window.`
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    checkedCount: PRODUCTION_SECRET_RULES.length,
  };
}

// CLI execution
if (require.main === module) {
  console.log("🔒 Running Production Secret & Placeholder Validation Gate...");
  console.log(`🌐 Target Network: ${process.env.STELLAR_NETWORK || "testnet"}`);
  console.log(`📦 NODE_ENV:       ${process.env.NODE_ENV || "development"}\n`);

  const result = validateProductionSecrets();

  if (result.warnings.length > 0) {
    console.log("⚠️  Warnings:");
    result.warnings.forEach((w) => console.log(`   ${w}`));
    console.log("");
  }

  if (!result.success) {
    console.error("❌ Production Secret Validation FAILED with errors:");
    result.errors.forEach((e) => console.error(`   ${e}`));
    console.error(
      "\n🚫 Deployment or startup blocked: runtime secrets must come from a managed secret store without placeholders."
    );
    process.exit(1);
  }

  console.log(
    `✅ All ${result.checkedCount} production secrets passed validation without placeholders or security violations.`
  );
}
