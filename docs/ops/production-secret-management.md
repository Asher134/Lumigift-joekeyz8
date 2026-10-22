# Production Secret Management & Rotation Specification

**Applies to:** Lumigift Production & Staging Environments  
**Status:** Active  
**Security Classification:** Confidential / Internal DevOps  

---

## 1. Executive Summary

All sensitive runtime configuration and secrets in Lumigift are decoupled from container images, version-controlled files, and Docker Compose defaults. In production, runtime secrets are managed exclusively through a dedicated, auditable secret store (**AWS Secrets Manager** / **HashiCorp Vault**) and injected securely into compute environments at runtime.

### Core Tenets
1. **Zero Hardcoded Defaults in Production:** Placeholder strings (e.g., `replace_with_a_strong_random_secret`, `lumigift_dev_password`, `your_*`) and insecure defaults are blocked by multi-layer gates and cannot reach running containers.
2. **Zero-Downtime Key Rotation:** Rotation procedures are architected to ensure active user sessions, ongoing Stellar escrow operations, and database connections remain uninterrupted during credential updates.
3. **Least Privilege IAM:** Container roles have read-only access strictly scoped to the specific secret ARNs required for operation.
4. **Audit Trail Compliance:** Every secret rotation, lifecycle transition, and revocation event is logged with operator identity, timestamp, and verification status.

---

## 2. Secret Store Architecture

```
                               ┌──────────────────────────────────────────────┐
                               │             AWS Secrets Manager              │
                               │  (Encrypted at rest with KMS, CMK per env)   │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┼──────────────────────────────┐
                       │                              │                              │
                       ▼                              ▼                              ▼
          ┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
          │  App Runner (Production)│    │  CI/CD Deployment Gate  │    │  Terraform IaC Registry │
          │  Runtime env injection  │    │  Validation & checks    │    │  Resource ARN mapping   │
          └─────────────────────────┘    └─────────────────────────┘    └─────────────────────────┘
```

### Environment Tiering

| Environment | Secret Store Provider | Injection Mechanism | Access Policy |
| :--- | :--- | :--- | :--- |
| **Local Dev** | `.env.local` (uncommitted) / `docker-compose.dev.yml` | Filesystem / Docker env | Developer workstation only |
| **Staging** | GitHub Environment Secrets (`STAGING_*`) & AWS Secrets Manager | CI/CD build & Vercel Preview | Automated branch deployments (`develop`) |
| **Production** | AWS Secrets Manager (`lumigift/prod/*`) | AWS App Runner runtime secrets | Strictly controlled via IAM & CI/CD (`main`) |

---

## 3. Secret Inventory & Specifications

| Environment Variable | Category | Minimum Length / Format | Rotation Strategy | Cadence |
| :--- | :--- | :--- | :--- | :--- |
| `NEXTAUTH_SECRET` | Auth | 32 chars (High-entropy base64) | Dual-key grace window (`NEXTAUTH_SECRET_PREVIOUS`) | 90 days |
| `CSRF_SECRET` | Security | 32 chars (High-entropy base64) | Blue-green / rolling deploy | 90 days |
| `CRON_SECRET` | Automation | 32 chars (High-entropy base64) | Coordinated cron caller update | 90 days |
| `DATABASE_URL` | Database | PostgreSQL connection URI | Dual-user database role rotation | 180 days |
| `REDIS_URL` | Cache/Queue | `rediss://:password@host:port` | Dual AUTH credential rotation | 180 days |
| `STELLAR_SERVER_SECRET_KEY` | Blockchain | `S` + 55 chars Base32 | Multi-signature co-signing handover | 180 days / On-demand |
| `STELLAR_ESCROW_CONTRACT_ID`| Blockchain | `C` + 55 chars Base32 | Smart contract migration protocol | Versioned releases |
| `PAYSTACK_SECRET_KEY` | Payment | `sk_live_...` (Prod) | Dashboard rollover & deployment | 180 days |
| `STRIPE_SECRET_KEY` | Payment | `sk_live_...` (Prod) | Stripe dashboard API key rolling | 180 days |
| `STRIPE_WEBHOOK_SECRET` | Payment | `whsec_...` (Prod) | Dual-webhook endpoint rollover | 180 days |
| `TERMII_API_KEY` | SMS / OTP | Alphanumeric API token | Dashboard renewal & deployment | 180 days |
| `CLOUDINARY_API_SECRET` | Media | Hex/Alphanumeric secret | Dashboard renewal & deployment | 180 days |

---

## 4. Multi-Layer Placeholder Prevention Gates

To guarantee that placeholder values or compose defaults never reach a production workload, Lumigift employs 4 independent layers of enforcement:

```
[Layer 1: Compose Schema Gate]  -->  [Layer 2: CI Pre-Deploy Script]  -->  [Layer 3: Runtime Zod Gate]  -->  [Layer 4: Terraform Managed Store]
```

### Layer 1: Docker Compose Syntax Enforcement
In [`docker-compose.yml`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/docker-compose.yml), sensitive variables use parameter expansion with mandatory error triggers (`${VAR:?Error: message}`) rather than default fallback strings (`${VAR:-fallback}`). If any variable is missing or empty, Docker Compose halts container initialization immediately:
```yaml
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Error: POSTGRES_PASSWORD must be provided from managed secret store}
  NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?Error: NEXTAUTH_SECRET must be supplied from managed secret store}
```

### Layer 2: Pre-Deployment Automated Validation Script
The validation script [`scripts/validate-production-secrets.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/scripts/validate-production-secrets.ts) runs in CI/CD before any deployment step:
```bash
npm run secrets:validate
```
The validator inspects every required variable against regex patterns, checks length/entropy, and rejects any known placeholder values (`replace_with_*`, `lumigift_dev_password`, `your_*`, `changeme`, `dummy`, `<...>`, test keys on mainnet).

### Layer 3: Runtime Application Validation (`env.ts`)
On startup, [`src/server/config/env.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/src/server/config/env.ts) validates `process.env` before establishing database pools or external API clients. In production mode (`NODE_ENV=production`), any detected placeholder causes immediate process termination with a structured error log.

### Layer 4: Terraform Infrastructure as Code
All production secrets are defined as AWS Secrets Manager resources in [`infra/terraform/main.tf`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/infra/terraform/main.tf). App Runner pulls secrets directly from Secrets Manager ARNs via IAM role [`aws_iam_role.app_runner_instance_role`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/infra/terraform/main.tf#L72-L130).

---

## 5. Zero-Downtime Secret Rotation Playbooks

### Playbook 1: NextAuth Session Key (`NEXTAUTH_SECRET`)
*Mechanism: Dual-key signature verification with grace period.*

1. **Generate a new 32-byte secret:**
   ```bash
   NEW_SECRET=$(openssl rand -base64 32)
   ```
2. **Fetch current active secret from Secrets Manager:**
   ```bash
   CURRENT_SECRET=$(aws secretsmanager get-secret-value \
     --secret-id lumigift/prod/NEXTAUTH_SECRET \
     --query SecretString --output text)
   ```
3. **Stage current secret as previous and update active secret:**
   ```bash
   # Set previous secret
   aws secretsmanager put-secret-value \
     --secret-id lumigift/prod/NEXTAUTH_SECRET_PREVIOUS \
     --secret-string "$CURRENT_SECRET"

   # Set new secret
   aws secretsmanager put-secret-value \
     --secret-id lumigift/prod/NEXTAUTH_SECRET \
     --secret-string "$NEW_SECRET"
   ```
4. **Trigger application rollout:**
   - App Runner redeploys containers with new and previous secrets.
   - Newly created JWT tokens are signed with `$NEW_SECRET`.
   - Existing active sessions remain valid for `NEXTAUTH_ROTATION_GRACE_HOURS` (24h) handled by [`src/lib/jwt-rotation.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/src/lib/jwt-rotation.ts).
5. **Post-grace cleanup (after 24 hours):**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id lumigift/prod/NEXTAUTH_SECRET_PREVIOUS \
     --secret-string ""
   ```

---

### Playbook 2: Stellar Server Signer Key (`STELLAR_SERVER_SECRET_KEY`)
*Mechanism: Stellar account multi-signature co-signing handover.*

1. **Generate new Stellar keypair:**
   ```bash
   stellar keys generate lumigift-server-new --network mainnet
   # Output: Public (G_NEW...), Secret (S_NEW...)
   ```
2. **Add new public key as authorized signer on Escrow account:**
   ```bash
   stellar tx new set-options \
     --source-account <ESCROW_PUBLIC_KEY> \
     --signer-key <G_NEW_PUBLIC_KEY> \
     --signer-weight 1 \
     --network mainnet \
     --sign-with-key <S_OLD_SECRET_KEY>
   ```
   *(Now both old and new keys have signature weight 1).*
3. **Update secret in AWS Secrets Manager:**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id lumigift/prod/STELLAR_SERVER_SECRET_KEY \
     --secret-string "<S_NEW_SECRET_KEY>"
   ```
4. **Redeploy and verify deep health:**
   ```bash
   curl -f https://lumigift.app/api/health?deep=1
   ```
5. **Remove old key from Escrow account signers:**
   ```bash
   stellar tx new set-options \
     --source-account <ESCROW_PUBLIC_KEY> \
     --signer-key <G_OLD_PUBLIC_KEY> \
     --signer-weight 0 \
     --network mainnet \
     --sign-with-key <S_NEW_SECRET_KEY>
   ```

---

### Playbook 3: PostgreSQL Database Credentials (`DATABASE_URL`)
*Mechanism: Dual database role rotation.*

1. **Create secondary database user in RDS PostgreSQL:**
   ```sql
   CREATE USER lumigift_app_b WITH PASSWORD 'new_high_entropy_password';
   GRANT lumigift_app_role TO lumigift_app_b;
   ```
2. **Update `DATABASE_URL` in Secrets Manager to user `lumigift_app_b`:**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id lumigift/prod/DATABASE_URL \
     --secret-string "postgresql://lumigift_app_b:new_high_entropy_password@rds-endpoint:5432/lumigift"
   ```
3. **Trigger rolling deployment and confirm new connection pools establish successfully.**
4. **Revoke and drop previous user (`lumigift_app_a`) after connection draining:**
   ```sql
   REVOKE CONNECT ON DATABASE lumigift FROM lumigift_app_a;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'lumigift_app_a';
   DROP USER lumigift_app_a;
   ```

---

### Playbook 4: Stripe & Paystack Payment Provider Keys

1. **Generate secondary API key in provider dashboard (Stripe / Paystack).**
2. **Update secret in AWS Secrets Manager (`STRIPE_SECRET_KEY` / `PAYSTACK_SECRET_KEY`).**
3. **Trigger zero-downtime container redeployment.**
4. **Execute end-to-end test checkout to confirm provider acceptance.**
5. **Revoke / expire old API key in provider dashboard.**

---

## 6. Emergency Compromise Response Procedure

If a production secret is suspected to be exposed or compromised:

1. **Declare Incident:** Notify security on-call and open incident room.
2. **Immediate Dual Signer Revocation (Stellar):**
   - If `STELLAR_SERVER_SECRET_KEY` is compromised, immediately execute `set-options --signer-weight 0` for the compromised key.
3. **Rotate Credential in Secrets Manager:** Update the compromised secret value immediately.
4. **Force Container Restart:** Trigger immediate App Runner rolling deployment to cycle runtime instances.
5. **Session Invalidation:** Invalidate all active NextAuth JWT sessions by rotating `NEXTAUTH_SECRET` without setting `NEXTAUTH_SECRET_PREVIOUS`.
6. **Audit & Forensics:** Inspect [`audit_logs`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/migrations/0005_audit_logs.sql) and provider access logs for unauthorized transactions during the window of vulnerability.
7. **Record Post-Mortem:** Log incident timeline and remediation in [`docs/ops/key-rotation-log.md`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/docs/ops/key-rotation-log.md).

---

## 7. Automated Testing & Verification

The secret management and rotation subsystems are continuously verified via automated tests:
- [`src/lib/__tests__/jwt-rotation.test.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/src/lib/__tests__/jwt-rotation.test.ts): Tests dual-key rotation, active session survival during grace window, and expiration enforcement.
- [`src/server/config/__tests__/env.test.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/src/server/config/__tests__/env.test.ts): Tests placeholder pattern detection, strict production schema validation, and test key rejection on mainnet.
- [`scripts/validate-production-secrets.ts`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/scripts/validate-production-secrets.ts): Pre-flight verification tool for CI/CD pipelines.
