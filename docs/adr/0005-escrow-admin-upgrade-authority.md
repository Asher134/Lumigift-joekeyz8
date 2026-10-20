# ADR 0005: Escrow Admin Storage and Upgrade Authority

**Status:** Accepted  
**Date:** 2026-09-28  
**Issue:** [#81 – Review admin storage and upgrade authority](https://github.com/joekeyz8/Lumigift-lumigift/issues/81)

---

## Context

The Lumigift escrow contract (`contracts/escrow/src/lib.rs`) is deployed once per gift on Stellar's Soroban platform. After deployment the contract must be upgradeable to allow security patches and feature additions without requiring a full redeployment and re-transfer of funds.

Soroban provides `env.deployer().update_current_contract_wasm(new_wasm_hash)` for in-place WASM upgrades. Any caller that can invoke this must be strictly controlled — an unauthorized upgrade could replace the escrow logic with a malicious contract and drain all locked funds.

---

## Decision

### Admin Storage

A dedicated `DataKey::Admin` key is stored in **instance storage** during `initialize`. The admin address is the first argument to `initialize` and is set by the platform backend at deployment time (typically a multisig or operations wallet).

```rust
env.storage().instance().set(&DataKey::Admin, &admin);
```

The admin address:
- Is **immutable** after initialization (no `set_admin` method exists).
- Is **separate** from the gift sender, so gift senders cannot perform upgrades.
- Is **distinct** from the recipient, preventing any claim-side manipulation.

### Upgrade Authority

The `upgrade(env, new_wasm_hash)` function:
1. Reads the stored admin address.
2. Calls `admin.require_auth()` — the Soroban auth framework enforces this at the transaction level.
3. Calls `env.deployer().update_current_contract_wasm(new_wasm_hash)`.
4. Emits an `upgraded` event with the old contract address and new WASM hash for audit trails.

If the contract is not yet initialized (`DataKey::Admin` absent), `upgrade` returns `EscrowError::NotInitialized` rather than panicking.

### Authorization Model

| Role       | Can Initialize | Can Claim | Can Cancel | Can Upgrade |
|------------|:--------------:|:---------:|:----------:|:-----------:|
| Admin      | ✅              | ❌         | ❌          | ✅           |
| Sender     | ✅ (auth check) | ❌         | ✅          | ❌           |
| Recipient  | ❌              | ✅         | ❌          | ❌           |
| Anyone     | ❌              | ❌         | ❌          | ❌           |

> `initialize` requires `sender.require_auth()` to prevent front-running attacks, not `admin.require_auth()`, because the admin is set by the platform deployer.

---

## Consequences

### Positive
- Upgrade permissions are narrowly scoped to a single admin address.
- Unauthorized upgrade attempts fail with a Soroban auth error (no funds at risk).
- The `upgraded` event provides an immutable on-chain audit trail.
- Admin is stored in durable instance storage — survives contract upgrades.

### Negative / Risks
- If the admin key is lost or compromised the contract cannot be patched (no recovery path).
- Admin is immutable — if the operations team needs to rotate the admin key they must cancel and recreate the escrow.

### Mitigations
- The platform backend uses a multisig wallet as admin to reduce key-loss risk.
- All production admin key operations are logged in `docs/ops/key-rotation-log.md`.
- The `upgraded` event allows off-chain monitoring systems to alert on unexpected upgrades.

---

## Test Coverage

Upgrade authority is verified by two test modules:

1. **`mod upgrade_tests`** (existing):
   - `test_upgrade_restricted_to_admin` — admin can upgrade
   - `test_non_admin_cannot_upgrade` — arbitrary address is rejected

2. **`mod admin_authority_tests`** (added by this PR):
   - `test_sender_cannot_upgrade` — gift sender is not admin
   - `test_recipient_cannot_upgrade` — recipient is not admin
   - `test_upgrade_not_initialized_returns_error` — upgrade before init fails gracefully
   - `test_upgrade_emits_event` — event is published on successful upgrade

---

## References

- [Soroban Upgrading Contracts](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/upgradeable-contract)
- [Soroban Authorization Framework](https://developers.stellar.org/docs/build/guides/authorization)
- `docs/ops/contract-migration.md`
