const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // Exclude e2e (Playwright) and DB integration tests from Jest runs
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/e2e/",
    "<rootDir>/src/app/api/v1/payments/__tests__/webhook.integration.test.ts",
  ],
  // Route handler tests and node-specific tests need the node environment
  testEnvironmentOptions: {},
  // Per-file environment overrides via docblock: @jest-environment node
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],

  // ─── Per-package coverage thresholds ──────────────────────────────────────
  // Security-critical and money-moving modules are held to a higher standard.
  // Untested critical paths will fail CI so gaps surface immediately.
  //
  // Threshold keys match Jest's `coverageThreshold` glob syntax:
  //   "global"   — aggregate across all collected files
  //   "./src/..." — per-directory or per-file
  //
  // Run with:  npx jest --coverage
  coverageThreshold: {
    // ── Global baseline ──────────────────────────────────────────────────────
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },

    // ── Security: auth, OTP, CSRF, session ───────────────────────────────────
    // These modules protect user accounts and must have very high coverage.
    "./src/lib/auth.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./src/lib/otp.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./src/lib/csrf.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./src/lib/jwt-rotation.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },

    // ── Money movement: payments, Stellar, escrow client ─────────────────────
    // Bugs here result in real financial loss; thresholds are strict.
    "./src/lib/paystack.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./src/lib/stellar.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    "./src/lib/contracts/escrow-client.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },

    // ── Core services ─────────────────────────────────────────────────────────
    "./src/server/services/gift.service.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    "./src/server/services/claim.service.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    "./src/server/services/audit.service.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    "./src/server/services/payment-reconciliation.service.ts": {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },

    // ── Server middleware ──────────────────────────────────────────────────────
    "./src/server/middleware/index.ts": {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};

module.exports = createJestConfig(customConfig);
