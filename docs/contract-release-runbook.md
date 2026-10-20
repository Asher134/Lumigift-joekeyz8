# Smart Contract Release & Migration Runbook

> Closes #114

This runbook covers building, auditing, deploying, verifying, and rolling back
the Lumigift escrow contract on Stellar Soroban. Follow it for every testnet
and mainnet release.

---

## Table of Contents

1. [Pre-release checklist](#1-pre-release-checklist)
2. [Build and provenance](#2-build-and-provenance)
3. [Testnet deployment](#3-testnet-deployment)
4. [Mainnet deployment](#4-mainnet-deployment)
5. [Post-deployment verification](#5-post-deployment-verification)
6. [Recording IDs and hashes](#6-recording-ids-and-hashes)
7. [In-place upgrade (no state migration)](#7-in-place-upgrade-no-state-migration)
8. [Breaking-change migration](#8-breaking-change-migration)
9. [Rollback](#9-rollback)
10. [Network configuration reference](#10-network-configuration-reference)

---

## 1. Pre-release checklist

Complete every item before proceeding to deployment. A second reviewer must
independently verify items marked **[independent review]**.

- [ ] All Rust tests pass: `npm run contract:test`
- [ ] All proptest fuzz tests pass: `cargo test fuzz_` (in `contracts/`)
- [ ] Resource budget benchmarks are within limits: `cargo bench --bench escrow_bench -- --noplot`
- [ ] **[independent review]** Contract source diff reviewed against previous release tag
- [ ] **[independent review]** No known CVEs in Rust dependencies: `cargo audit`
- [ ] WASM build is deterministic (same hash from clean build twice): see §2
- [ ] Testnet deployment record exists in `.contract-ids.json` (required for mainnet gate)
- [ ] `STELLAR_SERVER_SECRET_KEY` is set in the deployment environment (not committed)
- [ ] Deployment log entry planned in `deployments.log`

---

## 2. Build and provenance

Build the WASM artifact:

```bash
npm run contract:build
# Output: contracts/target/wasm32-unknown-unknown/release/lumigift_escrow.wasm
```

Record the SHA-256 hash of the WASM for provenance:

```bash
sha256sum contracts/target/wasm32-unknown-unknown/release/lumigift_escrow.wasm
```

Save the hash in the deployment record (see §6). Two engineers should build
independently from the same commit and confirm their hashes match before
proceeding to mainnet.

The Rust toolchain version is pinned in `rust-toolchain.toml`. Do not upgrade
the toolchain without a separate PR and review.

---

## 3. Testnet deployment

```bash
STELLAR_NETWORK=testnet npm run contract:deploy
```

The deployment script (`scripts/deploy-contract.ts`):

1. Verifies the WASM file exists.
2. Validates `STELLAR_SERVER_SECRET_KEY` format (56-char base32 starting with `S`).
3. Calls `stellar contract deploy` with the testnet RPC endpoint.
4. Verifies the contract is live by calling `get_state` (expects `EscrowError::NotInitialized`).
5. Writes the contract ID to `.contract-ids.json` under the `testnet` key.
6. Appends a timestamped entry to `deployments.log`.
7. Prints the Stellar Explorer URL.

Expected output (truncated):

```
🚀 Deploying escrow contract to testnet…
✅ Contract deployed: C...
🔍 Verifying deployment via get_state…
✅ Contract is live and responding on-chain.
📄 Contract ID written to .contract-ids.json
📋 Deployment logged to deployments.log
🔗 Stellar Explorer: https://stellar.expert/explorer/testnet/contract/C...
```

Set `STELLAR_ESCROW_CONTRACT_ID` to the returned contract ID in your testnet
environment and smoke-test the full gift creation → claim flow.

---

## 4. Mainnet deployment

> **High-risk operation.** Real funds are at stake. Do not proceed unless
> the testnet smoke test has passed and all pre-release checklist items are
> complete.

Mainnet deployment has three automatic safety gates in the script:

| Gate                               | What it checks                                |
| ---------------------------------- | --------------------------------------------- |
| `--confirm-mainnet` flag           | Explicit opt-in required                      |
| `.contract-ids.json` testnet entry | Testnet must have been deployed first         |
| Interactive `YES` prompt           | Final human confirmation with summary printed |

```bash
STELLAR_NETWORK=mainnet \
STELLAR_SERVER_SECRET_KEY=<admin-secret> \
npm run contract:deploy -- --confirm-mainnet
```

When prompted, type `YES` (exact) to proceed. Any other input cancels the
deployment.

After deployment:

1. Set `STELLAR_ESCROW_CONTRACT_ID=<new-mainnet-contract-id>` in all
   production environments and GitHub secrets.
2. Redeploy the Next.js application so it picks up the new contract ID.
3. Verify a live gift creation end-to-end (small amount, testnet USDC if
   applicable, or a controlled real transaction).

---

## 5. Post-deployment verification

Verify the contract is live and uninitialized:

```bash
stellar contract invoke \
  --network <testnet|mainnet> \
  --source <STELLAR_SERVER_SECRET_KEY> \
  --id <CONTRACT_ID> \
  -- get_state
```

Expected response: `EscrowError::NotInitialized` (error code 4). This confirms
the contract is live but has not been used yet.

Verify the WASM hash matches what you built:

```bash
stellar contract info \
  --network <testnet|mainnet> \
  --id <CONTRACT_ID>
```

Confirm the `wasm_hash` in the output matches the SHA-256 you recorded in §2.

---

## 6. Recording IDs and hashes

After every deployment, update the deployment record:

**`.contract-ids.json`** (updated automatically by the deploy script):

```json
{
  "testnet": {
    "escrow": "C<TESTNET_CONTRACT_ID>",
    "deployedAt": "2026-09-28T15:00:00.000Z"
  },
  "mainnet": {
    "escrow": "C<MAINNET_CONTRACT_ID>",
    "deployedAt": "2026-09-28T16:00:00.000Z"
  }
}
```

**`deployments.log`** (appended automatically by the deploy script):

```
2026-09-28T16:00:00.000Z	network=mainnet	contract=C<MAINNET_CONTRACT_ID>
```

**Manual provenance record** (add to this table for every mainnet release):

| Date       | Network | Contract ID | WASM SHA-256 | Released by | Reviewed by |
| ---------- | ------- | ----------- | ------------ | ----------- | ----------- |
| 2026-09-28 | testnet | `C...`      | `abc123...`  | `@handle`   | `@handle`   |
| 2026-09-28 | mainnet | `C...`      | `abc123...`  | `@handle`   | `@handle`   |

Keep this table updated in `deployments.log` or a dedicated release note.

---

## 7. In-place upgrade (no state migration)

Use this path when the contract logic changes but the storage layout is
unchanged. The contract address and all stored escrow state are preserved.

### Step 1 — Build the new WASM

```bash
npm run contract:build
sha256sum contracts/target/wasm32-unknown-unknown/release/lumigift_escrow.wasm
```

### Step 2 — Upload WASM to the network

```bash
stellar contract upload \
  --network <testnet|mainnet> \
  --source <STELLAR_SERVER_SECRET_KEY> \
  --wasm contracts/target/wasm32-unknown-unknown/release/lumigift_escrow.wasm
# Outputs: <NEW_WASM_HASH>
```

Record `<NEW_WASM_HASH>`.

### Step 3 — Call `upgrade` on the existing contract

```bash
stellar contract invoke \
  --network <testnet|mainnet> \
  --source <STELLAR_SERVER_SECRET_KEY> \
  --id <EXISTING_CONTRACT_ID> \
  -- upgrade \
  --new_wasm_hash <NEW_WASM_HASH>
```

Authorization: only the `admin` address set during `initialize` can call
`upgrade`. Use the same key that was used to initialize the contract.

### Step 4 — Verify

```bash
stellar contract info --network <testnet|mainnet> --id <EXISTING_CONTRACT_ID>
# Confirm wasm_hash == <NEW_WASM_HASH>
```

An `upgraded` event is emitted on-chain:

```
topic:  ("upgraded",)
data:   (old_contract_address, new_wasm_hash)
```

---

## 8. Breaking-change migration

Use this path when a storage layout change requires a new contract address.
This involves deploying a fresh contract and re-initializing active escrows.

> Coordinate with the treasury team before executing — the platform wallet must
> hold sufficient USDC to re-fund all active escrows.

### Step 1 — Snapshot active escrows

```sql
SELECT stellar_contract_id, sender_address, recipient_address,
       amount_stroops, unlock_time
FROM gifts
WHERE claimed = false
  AND stellar_contract_id IS NOT NULL;
```

Export and store this snapshot securely.

### Step 2 — Deploy the new contract

```bash
STELLAR_NETWORK=mainnet npm run contract:deploy -- --confirm-mainnet
# Note the new CONTRACT_ID
```

### Step 3 — Re-initialize active escrows on the new contract

For each row in the snapshot:

1. Call `initialize` on the **new** contract with the original parameters
   (`sender_address`, `recipient_address`, `amount_stroops`, `unlock_time`).
2. Transfer the escrowed USDC from the platform wallet to the new contract.
3. Update `stellar_contract_id` in the database:

```sql
UPDATE gifts
SET stellar_contract_id = '<NEW_CONTRACT_ID>'
WHERE id = '<gift_id>';
```

### Step 4 — Drain the old contract

If the old contract version supports emergency withdrawal, call it to recover
remaining balances. Otherwise, let active escrows run to completion naturally
before decommissioning.

### Step 5 — Update environment variables

```bash
STELLAR_ESCROW_CONTRACT_ID=<NEW_CONTRACT_ID>
```

Update in all environments: `.env.local`, Vercel environment variables, and
GitHub secrets (`STELLAR_ESCROW_CONTRACT_ID`). Redeploy the Next.js application.

---

## 9. Rollback

The `upgrade` function replaces the contract's WASM in-place and is **not
automatically reversible**. To roll back:

1. Locate the previous WASM hash in the provenance record (§6).
2. Confirm the old WASM was uploaded to the network (it must have a valid hash).
3. Call `upgrade` again with the previous WASM hash:

```bash
stellar contract invoke \
  --network <testnet|mainnet> \
  --source <STELLAR_SERVER_SECRET_KEY> \
  --id <CONTRACT_ID> \
  -- upgrade \
  --new_wasm_hash <PREVIOUS_WASM_HASH>
```

**Always record the current WASM hash before upgrading** so rollback is
possible. If the old WASM was never uploaded as a standalone hash, you cannot
roll back without redeploying a new contract and running the breaking-change
migration procedure (§8).

---

## 10. Network configuration reference

| Setting                   | Testnet                                                    | Mainnet                                                |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| RPC URL                   | `https://soroban-testnet.stellar.org`                      | `https://soroban-rpc.stellar.org`                      |
| Network passphrase        | `Test SDF Network ; September 2015`                        | `Public Global Stellar Network ; September 2015`       |
| Horizon URL               | `https://horizon-testnet.stellar.org`                      | `https://horizon.stellar.org`                          |
| Explorer                  | `https://stellar.expert/explorer/testnet/contract/<id>`    | `https://stellar.expert/explorer/public/contract/<id>` |
| USDC issuer               | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | (Circle mainnet issuer)                                |
| `STELLAR_NETWORK` env var | `testnet`                                                  | `mainnet`                                              |

The `STELLAR_NETWORK` environment variable controls which network the deploy
script and application target. Always verify this is set correctly before
running any deployment command.
