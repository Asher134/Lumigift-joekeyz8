# Smart Contract Dependency Pinning and `Cargo.lock` Policy

This document defines the dependency management, version pinning, security auditing, and exception policy for Lumigift's Soroban smart contracts located in `contracts/`.

---

## 1. Core Principles

1. **Deterministic, Reproducible Builds**: Every build of the smart contract WASM binary must produce byte-for-byte identical output when compiled against the same commit.
2. **Strict `Cargo.lock` Version Control**: `contracts/Cargo.lock` is committed to git and is the authoritative bill of materials.
3. **Continuous Security Auditing**: All dependencies are scanned against the RustSec Advisory Database on every pull request, develop push, and pre-deployment gate.
4. **Transparent Exception Management**: Any ignored vulnerability must be documented with explicit rationale, WASM runtime impact analysis, and an expiration date.

---

## 2. Pinning Policy

### 2.1 Rust Toolchain Pinning

The Rust compiler version is strictly pinned in [`rust-toolchain.toml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/rust-toolchain.toml):

```toml
[toolchain]
channel = "1.91.0"
components = ["rustfmt"]
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
```

CI workflows and local developers must compile using this exact toolchain version.

### 2.2 Soroban SDK & Direct Dependencies

Direct dependencies in [`contracts/escrow/Cargo.toml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/contracts/escrow/Cargo.toml) must specify exact versions or tightly constrained semver:

```toml
[dependencies]
soroban-sdk = { version = "28.0.0", features = ["alloc"] }

[dev-dependencies]
soroban-sdk = { version = "28.0.0", features = ["testutils"] }
proptest = { version = "1", default-features = false, features = ["std"] }
criterion = { version = "0.8", features = ["html_reports"] }
```

### 2.3 Enforcement of `--locked`

All cargo commands across CI, local npm scripts, and deployment workflows **must** pass `--locked` (or `--frozen`):

| Purpose | Command |
| --- | --- |
| **Immutability Check** | `cargo check --locked` |
| **Unit & Integration Tests** | `cargo test --locked` |
| **Fuzz Tests** | `cargo test --locked --test-threads=4 fuzz_` |
| **Security Audit** | `cargo audit --locked --deny warnings` |
| **NPM Script** | `npm run contract:test` / `npm run contract:audit` |

If a dependency update in `Cargo.toml` is made without updating and committing `Cargo.lock`, `cargo check --locked` will fail immediately in CI.

---

## 3. Dependency Security Auditing (`cargo-audit`)

### 3.1 Automated Audit Workflow

Security auditing is integrated into:
- [`.github/workflows/ci.yml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/.github/workflows/ci.yml) (dedicated `contract-audit` job)
- [`.github/workflows/deploy-contract-testnet.yml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/.github/workflows/deploy-contract-testnet.yml) (pre-deployment gate in `build-contract`)

### 3.2 Audit Configuration

Audit rules are defined in [`.cargo/audit.toml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/.cargo/audit.toml) and [`contracts/.cargo/audit.toml`](file:///c:/Users/DELL/Desktop/Lumigift-lumigifts/contracts/.cargo/audit.toml):

```toml
[advisories]
ignore = []
yanked = "deny"
unsound = "deny"
unmaintained = "warn"
informational_warnings = ["unmaintained", "unsound", "notice"]
severity_threshold = "low"

[output]
format = "text"
quiet = false
deny = ["unmaintained", "unsound"]

[database]
url = "https://github.com/rustsec/advisory-db.git"
fetch = true
stale = "warn"
```

---

## 4. Exception Management Procedure

When `cargo audit` flags an advisory that cannot be immediately resolved (e.g. upstream fix pending or issue only impacts native code paths not included in WASM), follow this procedure:

### 4.1 Evaluation Checklist

Before adding an exception to `ignore = [...]`:

1. **Scope Verification**: Is the vulnerable function or crate compiled into the `wasm32-unknown-unknown` contract binary, or is it isolated to dev-dependencies/benchmarks?
2. **Exploitability Analysis**: Can untrusted inputs on-chain trigger the vulnerable code path?
3. **Alternative Workarounds**: Can the dependency be replaced or updated before granting an exception?
4. **Expiration Date**: Set a hard review date (maximum 90 days).

### 4.2 Exception Format

Every ignored advisory in `.cargo/audit.toml` and `contracts/.cargo/audit.toml` must follow this documented format:

```toml
[advisories]
ignore = [
    # Format:
    # "RUSTSEC-YYYY-XXXX", # Crate: <name>@<version> | Severity: <level> | Scope: <dev/test/wasm> | Rationale: <reason> | Review By: <YYYY-MM-DD> | Approver: <github-username>
]
```

### 4.3 Approval

- Adding or modifying an ignored advisory requires **two approvals** from senior engineers/security reviewers.
- Ignored advisories are reviewed monthly. Expired exceptions fail CI during dependency audits.

---

## 5. Dependency Upgrade Cadence

1. **Monthly Review**: Run `npm run contract:audit` and check for Soroban SDK updates.
2. **Benchmark Verification**: Run `cargo bench` to verify memory and CPU resource consumption does not exceed Soroban ledger limits.
3. **Contract Size Check**: Verify that optimized WASM size remains within acceptable bounds.
4. **Bindings Synchronization**: Run `npm run contract:bindings` to verify TypeScript client types remain aligned.
