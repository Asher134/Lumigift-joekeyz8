# Timestamp Boundary Semantics

This document defines the exact timestamp boundary semantics for gift unlock and claim validity across the **Soroban Escrow Smart Contract** and the **Next.js Backend**.

---

## 1. Core Rule: Inclusive Boundary (`>=`)

The platform enforces a uniform **inclusive boundary rule** across on-chain contracts and off-chain services:

$$\text{Claimable} \iff \text{current\_timestamp} \ge \text{unlock\_time}$$

```
                current_time < unlock_time          current_time >= unlock_time
                         [LOCKED]                            [UNLOCKED]
────────────┬───────────────────────────────────▲───────────────────────────────────► Time
            │                                   │
     Initialization                        unlock_time
                                       (Claim Valid HERE)
```

| Timestamp Condition | Escrow Status | `claim()` Result | Backend `isGiftUnlocked` |
| --- | --- | --- | --- |
| `time < unlock_time` | `Locked` (0) | ❌ `Err(EscrowError::StillLocked)` | `false` |
| `time == unlock_time` | `Unlocked` (1) | ✅ **`Ok(())` (Claim Succeeds)** | **`true`** |
| `time > unlock_time` | `Unlocked` (1) | ✅ **`Ok(())` (Claim Succeeds)** | **`true`** |

---

## 2. Soroban Smart Contract Implementation

In [`contracts/escrow/src/lib.rs`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/contracts/escrow/src/lib.rs):

### 2.1 `claim()` Invariant

```rust
let unlock_time: u64 = env
    .storage()
    .instance()
    .get(&DataKey::UnlockTime)
    .ok_or(EscrowError::NotInitialized)?;

// Strictly reject only when the ledger timestamp is before unlock_time
if env.ledger().timestamp() < unlock_time {
    return Err(EscrowError::StillLocked);
}
```

### 2.2 `get_status()` Lifecycle Resolution

```rust
if env.ledger().timestamp() < unlock_time {
    Ok(EscrowStatus::Locked)
} else {
    Ok(EscrowStatus::Unlocked)
}
```

### 2.3 `initialize()` Minimum Duration

To prevent zero-length or sub-hour locks, `unlock_time` must be strictly greater than 1 hour (`3600` seconds) past the initialization ledger timestamp:

```rust
if unlock_time <= env.ledger().timestamp().saturating_add(MIN_LOCK_DURATION) {
    return Err(EscrowError::InvalidUnlockTime);
}
```

---

## 3. Stellar Ledger Consensus Behavior

1. **Discrete Ledger Closes**: Stellar ledgers close roughly every 5 seconds. The ledger timestamp `env.ledger().timestamp()` is uniform for all contract invocations within the same ledger.
2. **Deterministic Evaluation**:
   - If ledger $L$ closes at timestamp $T = \text{unlock\_time}$, all transactions in ledger $L$ observe $T \ge \text{unlock\_time}$ and successfully claim.
   - If a claim transaction is submitted in ledger $L-1$ at timestamp $T = \text{unlock\_time} - 1$, the Soroban host evaluates $T < \text{unlock\_time}$ and fails with `EscrowError::StillLocked` (no tokens move).

---

## 4. Backend & Database Parity

The backend mirrors the smart contract's inclusive semantics:

### 4.1 TypeScript Helper (`isGiftUnlocked`)

In [`src/server/services/gift.service.ts`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/src/server/services/gift.service.ts):

```typescript
export function isGiftUnlocked(
  gift: { unlockAt: Date | string | number },
  now: Date | number = new Date()
): boolean {
  const unlockMs = new Date(gift.unlockAt).getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs >= unlockMs;
}
```

### 4.2 Database & Scheduler Queries

In [`src/server/services/scheduler.service.ts`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/src/server/services/scheduler.service.ts):

```sql
-- Unlocks all gifts whose unlock date is in the past or exactly now (inclusive)
SELECT * FROM gifts
WHERE status = 'locked'
  AND unlock_at <= NOW();
```

### 4.3 Cancellation Boundary

In [`src/app/api/v1/gifts/[id]/route.ts`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/src/app/api/v1/gifts/%5Bid%5D/route.ts):

```typescript
// Senders may only cancel while the gift is still locked (before unlockAt)
if (new Date() >= gift.unlockAt) {
  return NextResponse.json({ error: "Gift unlock time has already passed" }, { status: 409 });
}
```

---

## 5. Verification & Test Coverage

| Layer | Test Suite | Boundary Cases Verified |
| --- | --- | --- |
| **Smart Contract (Rust)** | `contracts/escrow/src/lib.rs` | • `test_claim_boundary_exactly_at_unlock_time_succeeds`<br>• `test_claim_boundary_one_second_after_unlock_time_succeeds`<br>• `test_initialize_boundary_min_lock_duration`<br>• `test_ledger_sequence_progression_across_boundary` |
| **Backend (TypeScript)** | `src/server/services/__tests__/timestamp-boundary.test.ts` | • `now == unlockAt` returns `true`<br>• `now == unlockAt - 1ms` returns `false`<br>• `now == unlockAt + 1ms` returns `true`<br>• Scheduler unlock processing at exact boundary |
