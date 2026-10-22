/**
 * WebAuthn (passkey) helpers — issue #346
 *
 * Registration happens after a successful OTP login; subsequent logins can use
 * the platform authenticator (fingerprint / Face ID) instead of OTP. Challenges
 * are single-use and stored in Redis with a short TTL.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import pool from "@/lib/db";
import { withRedis } from "@/lib/redis";
import { serverConfig } from "@/server/config";

const CHALLENGE_TTL_SECONDS = 300;

const appUrl = new URL(serverConfig.app.url);
const rpID = appUrl.hostname;
const expectedOrigin = appUrl.origin;

interface StoredCredential {
  id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
}

function challengeKey(purpose: "register" | "login", userId: string): string {
  return `webauthn:challenge:${purpose}:${userId}`;
}

async function storeChallenge(key: string, challenge: string): Promise<void> {
  await withRedis("webauthn:challenge:set", (r) =>
    r.set(key, challenge, { EX: CHALLENGE_TTL_SECONDS })
  );
}

/** Reads and deletes a challenge so it can only be used once. */
async function consumeChallenge(key: string): Promise<string | null> {
  return withRedis("webauthn:challenge:consume", async (r) => {
    const challenge = await r.get(key);
    if (challenge) await r.del(key);
    return challenge;
  });
}

async function getCredentials(userId: string): Promise<StoredCredential[]> {
  const { rows } = await pool.query<StoredCredential>(
    "SELECT id, public_key, counter, transports FROM webauthn_credentials WHERE user_id = $1",
    [userId]
  );
  return rows;
}

export async function createRegistrationOptions(userId: string, phone: string) {
  const existing = await getCredentials(userId);
  const options = await generateRegistrationOptions({
    rpName: serverConfig.app.name,
    rpID,
    userName: phone,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  await storeChallenge(challengeKey("register", userId), options.challenge);
  return options;
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON
): Promise<boolean> {
  const expectedChallenge = await consumeChallenge(challengeKey("register", userId));
  if (!expectedChallenge) return false;

  const { verified, registrationInfo } = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verified || !registrationInfo) return false;

  const { credential } = registrationInfo;
  await pool.query(
    "INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
    [
      credential.id,
      userId,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ?? [],
    ]
  );
  return true;
}

/** Returns authentication options, or `null` when the user has no registered passkey. */
export async function createAuthenticationOptions(userId: string) {
  const credentials = await getCredentials(userId);
  if (credentials.length === 0) return null;

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  });
  await storeChallenge(challengeKey("login", userId), options.challenge);
  return options;
}

export async function verifyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON
): Promise<boolean> {
  const expectedChallenge = await consumeChallenge(challengeKey("login", userId));
  if (!expectedChallenge) return false;

  const stored = (await getCredentials(userId)).find((c) => c.id === response.id);
  if (!stored) return false;

  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(stored.public_key),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });
  if (!verified) return false;

  await pool.query(
    "UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2",
    [authenticationInfo.newCounter, stored.id]
  );
  return true;
}
