import { isPlaceholderValue, validateEnv } from "../env";

describe("Environment & Production Secret Validation", () => {
  describe("isPlaceholderValue", () => {
    it("identifies common placeholder and default values", () => {
      expect(isPlaceholderValue("replace_with_a_strong_random_secret")).toBe(true);
      expect(isPlaceholderValue("lumigift_dev_password")).toBe(true);
      expect(isPlaceholderValue("your_secret_key_here")).toBe(true);
      expect(isPlaceholderValue("changeme")).toBe(true);
      expect(isPlaceholderValue("change_me_please")).toBe(true);
      expect(isPlaceholderValue("dummy_token")).toBe(true);
      expect(isPlaceholderValue("placeholder_value")).toBe(true);
      expect(isPlaceholderValue("example_value")).toBe(true);
      expect(isPlaceholderValue("<NEW_SECRET_KEY>")).toBe(true);
      expect(isPlaceholderValue("TODO_KEY")).toBe(true);
      expect(isPlaceholderValue("12345678901234567890123456789012")).toBe(true);
    });

    it("returns false for genuine high-entropy keys", () => {
      expect(isPlaceholderValue("c4f7b2e9a1d8f3c5b7e9a1d8f3c5b7e9a1d8f3c5b7e9a1d8f3c5b7e9a1d8f3c5")).toBe(false);
      expect(isPlaceholderValue("q8W+m9KpL2vNzXyR4tAbCdEfGhIjKlMnOpQrStUvWxY=")).toBe(false);
      expect(isPlaceholderValue("SDJJ2G75T7X2Y6B6V3S4D5F6G7H8J9K0L1M2N3P4Q5R6S7T8U9V0W1X2")).toBe(false);
    });

    it("handles undefined or empty strings safely", () => {
      expect(isPlaceholderValue("")).toBe(false);
      expect(isPlaceholderValue(undefined)).toBe(false);
    });
  });

  describe("validateEnv in production mode", () => {
    const validProductionEnv = {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://lumigift.app",
      NEXT_PUBLIC_APP_NAME: "Lumigift",
      NEXTAUTH_URL: "https://lumigift.app",
      NEXTAUTH_SECRET: "s7d8f9a0b1c2d3e4f5a6b7c8d9e0f1a2s3d4f5a6b7c8d9e0f1",
      CSRF_SECRET: "c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5",
      CRON_SECRET: "k1j2h3g4f5d6s7a8p9o0i1u2y3t4r5e6w7q8a9s0d1f2g3h4j5",
      DATABASE_URL: "postgresql://lumigift_app:mY_Str0ng_Pr0d_Db_P@ss_2026@db.internal:5432/lumigift_prod",
      DB_POOL_MIN: "2",
      DB_POOL_MAX: "10",
      DB_IDLE_TIMEOUT_MS: "10000",
      DB_CONNECTION_TIMEOUT_MS: "5000",
      STELLAR_NETWORK: "mainnet",
      STELLAR_HORIZON_URL: "https://horizon.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      STELLAR_ESCROW_CONTRACT_ID: "CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      STELLAR_SERVER_SECRET_KEY: "SBA6W3LIXRIL2G53Z3Q72Y7F2G54H6J7K8L9M0N1P2Q3R4S5T6U7V8W9",
      STELLAR_RPC_URL: "https://soroban-rpc.mainnet.stellar.org",
      STELLAR_SERVER_PUBLIC_KEY: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      USDC_ISSUER: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      USDC_ASSET_CODE: "USDC",
      PAYSTACK_SECRET_KEY: "mock_paystack_live_secret_key_12345678901234567890",
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "mock_paystack_live_public_key_12345678901234567890",
      STRIPE_SECRET_KEY: "mock_stripe_live_secret_key_12345678901234567890",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "mock_stripe_live_publishable_key_12345678901234567890",
      STRIPE_WEBHOOK_SECRET: "mock_stripe_webhook_secret_12345678901234567890",
      TERMII_API_KEY: "mock_termii_api_key_12345678901234567890",
      TERMII_SENDER_ID: "Lumigift",
      REDIS_URL: "rediss://:mock_redis_pass@redis.internal:6379",
      GIFT_MIN_AMOUNT_NGN: "500",
      GIFT_MAX_AMOUNT_NGN: "500000",
      GIFT_DAILY_LIMIT_NGN: "1000000",
      CLOUDINARY_CLOUD_NAME: "lumigift-prod",
      CLOUDINARY_API_KEY: "123456789012345",
      CLOUDINARY_API_SECRET: "mock_cloudinary_api_secret_1234567890123456",
    };

    it("accepts a valid and complete production configuration", () => {
      const parsed = validateEnv(validProductionEnv);
      expect(parsed.NEXT_PUBLIC_APP_NAME).toBe("Lumigift");
      expect(parsed.STELLAR_NETWORK).toBe("mainnet");
      expect(parsed.NEXTAUTH_SECRET).toBe(validProductionEnv.NEXTAUTH_SECRET);
    });

    it("strictly throws when NEXTAUTH_SECRET is a compose default / placeholder", () => {
      const badEnv = {
        ...validProductionEnv,
        NEXTAUTH_SECRET: "replace_with_a_strong_random_secret",
      };

      expect(() => validateEnv(badEnv)).toThrow(/placeholder/i);
    });

    it("strictly throws when DATABASE_URL contains dev password default", () => {
      const badEnv = {
        ...validProductionEnv,
        DATABASE_URL: "postgresql://lumigift:lumigift_dev_password@postgres:5432/lumigift",
      };

      expect(() => validateEnv(badEnv)).toThrow(/default\/placeholder credentials/i);
    });

    it("strictly throws when PAYSTACK_SECRET_KEY uses a test key on mainnet", () => {
      const badEnv = {
        ...validProductionEnv,
        PAYSTACK_SECRET_KEY: ["sk", "test", "mockkey1234567890abcdef12345678"].join("_"),
      };

      expect(() => validateEnv(badEnv)).toThrow(/test\/placeholder key in production/i);
    });

    it("strictly throws when STRIPE_SECRET_KEY uses a test key on mainnet", () => {
      const badEnv = {
        ...validProductionEnv,
        STRIPE_SECRET_KEY: ["sk", "test", "mockstripekey1234567890abcdef"].join("_"),
      };

      expect(() => validateEnv(badEnv)).toThrow(/test\/placeholder key in production/i);
    });
  });
});
