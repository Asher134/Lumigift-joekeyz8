# Production Docker Image Hardening Specification

This document details the hardening, security controls, base image pinning, and SBOM (Software Bill of Materials) publishing mechanisms implemented for the Lumigift production container images.

---

## 1. Security Architecture & Threat Model

The production Docker container runs Next.js in `standalone` output mode on an Alpine Linux base. The hardening strategy focuses on minimizing attack surface, enforcing principle of least privilege, preventing privilege escalation, and guaranteeing supply chain transparency.

```
┌────────────────────────────────────────────────────────┐
│               HARDENED RUNNER CONTAINER               │
│                                                        │
│  Base: node:20.18.3-alpine3.21 (pinned version)        │
│  Init: dumb-init (PID 1 signal forwarding & reaping)   │
│  User: nextjs:nodejs (UID 1001, GID 1001 - Non-Root)   │
│                                                        │
│  Filesystem:                                           │
│  ├── /app/.next/standalone  (Only production bundle)   │
│  ├── /app/.next/static      (Static UI assets)         │
│  ├── /app/public            (Public assets)            │
│  └── /app/migrations        (DB schema files)          │
│                                                        │
│  Security Controls:                                    │
│  ✔ No dev tools / compilers / git / npm                │
│  ✔ No secret files (.env, keys, credentials)           │
│  ✔ Capabilities Dropped (cap_drop: ALL)                │
│  ✔ No New Privileges (no-new-privileges: true)         │
│  ✔ Automated Syft SBOM Generation (SPDX & CycloneDX)   │
│  ✔ Automated Trivy Vulnerability & Dockle CIS Scans    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Hardening Measures

### A. Non-Root Execution (`USER nextjs:nodejs`)
- **System User Creation**: The container creates a dedicated system group `nodejs` (GID 1001) and system user `nextjs` (UID 1001).
- **Direct Chown in COPY**: All artifacts copied from the `builder` stage use `--chown=nextjs:nodejs` directly to prevent creating redundant intermediate storage layers with `chown -R`.
- **Pre-created Directory Structure**: Required runtime directories (`/app/.next`, `/app/public`, `/app/migrations`) are pre-created with `1001:1001` ownership.
- **Enforcement**: Explicit `USER nextjs:nodejs` directive switches execution context before exposing ports and defining entrypoints.

### B. Base Image Pinning
- Pinned to explicit, immutable base tags:
  - **Application**: `node:20.18.3-alpine3.21` (via build argument `NODE_VERSION`)
  - **PostgreSQL**: `postgres:16.8-alpine3.21`
  - **Redis**: `redis:7.4.2-alpine3.21`
- Prevents unexpected upstream breaking changes and ensures reproducible, audited base OS environments.

### C. Package & Attack Surface Minimization
- **Multi-stage Build**:
  - `deps`: Installs production dependencies and purges npm cache (`npm cache clean --force`).
  - `builder`: Compiles Next.js standalone server and bundles only runtime code.
  - `runner`: Lightweight runtime container containing only the compiled JS bundle, static assets, and Node.js binary.
- **Zero Build Tools in Production**: Compilers, linters, test harnesses (Playwright, Jest, Stryker), TypeScript compiler, and devDependencies are strictly omitted from the runner container.
- **Process Management (`dumb-init`)**: Uses `dumb-init` (PID 1) to ensure proper forwarding of POSIX signals (`SIGTERM`, `SIGINT`) and preventing zombie process accumulation.

### D. Zero-Secrets & Supply Chain Protection
- **Comprehensive `.dockerignore`**: Excludes all local `.env*` files, SSL keys, SSH credentials, cloud service account JSONs, git history, and local test artifacts from the build context.
- **Standard OCI Image Labels**: Metadata labels defined according to Open Containers Initiative specification.

### E. Runtime Security Flags (Docker Compose)
In `docker-compose.yml`:
- `security_opt: ["no-new-privileges:true"]`: Prevents child processes from gaining elevated privileges via setuid/setgid binaries.
- `cap_drop: ["ALL"]`: Drops all default Linux kernel capabilities.
- `user: "1001:1001"`: Explicit unprivileged UID/GID enforcement.

---

## 3. SBOM (Software Bill of Materials) Publishing

The CI pipeline automatically generates and publishes machine-readable SBOMs for every production container build:

| Standard | Format | File Path |
| :--- | :--- | :--- |
| **SPDX JSON** | SPDX 2.3 | `lumigift-sbom.spdx.json` |
| **CycloneDX JSON** | CycloneDX 1.5 | `lumigift-sbom.cdx.json` |

### Generating SBOM Locally

```bash
# Using npm shortcut
npm run docker:sbom

# Or using script (Linux / Mac)
./scripts/generate-sbom.sh lumigift-app:latest ./build/sbom

# Or using PowerShell (Windows)
.\scripts\generate-sbom.ps1 -ImageTag "lumigift-app:latest" -OutputDir "./build/sbom"
```

---

## 4. Automated CI/CD Security Checks

The workflow `.github/workflows/docker-security.yml` runs on every pull request, commit to `main`/`develop`, and weekly schedule:

1. **Hadolint**: Validates Dockerfile against CIS container best practices.
2. **Docker Buildx**: Builds hardened standalone image.
3. **Aqua Trivy Scan**: Identifies OS and package vulnerabilities (CRITICAL, HIGH), outputs SARIF report for GitHub Code Scanning.
4. **Dockle CIS Verification**: Validates unprivileged user compliance (CIS-DI-0001), permission correctness, and checks for leaked secrets (CIS-DI-0005).
5. **Anchore Syft SBOM**: Extracts and publishes SPDX and CycloneDX inventory artifacts.

### Local Security Verification

```bash
# Run local security and compliance suite
npm run docker:check

# Or run individual checks
npm run docker:lint
npm run docker:scan
```
