-- Migration: WebAuthn (passkey) credentials for biometric sign-in — issue #346
-- The private key never leaves the user's device; only the credential ID and
-- public key are stored server-side.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id           TEXT PRIMARY KEY,               -- base64url credential ID
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   BYTEA NOT NULL,
  counter      BIGINT NOT NULL DEFAULT 0,
  transports   TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
