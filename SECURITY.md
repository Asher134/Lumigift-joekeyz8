# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | ✅ Yes    |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please email **security@lumigift.com** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Any suggested mitigations

We will acknowledge your report within 48 hours and aim to release a fix within 14 days for critical issues.

## Scope

In scope:

- Smart contract vulnerabilities (fund loss, unauthorized claims)
- Authentication bypass
- API injection or data exposure
- Dependency vulnerabilities with known exploits

Out of scope:

- Social engineering
- Denial of service via resource exhaustion
- Issues requiring physical access to a device

## Automated Vulnerability Scanning & Gates

All commits and pull requests targeting protected branches (`main`, `develop`) undergo continuous security scans:

- **npm**: Automated dependency audit & Trivy vulnerability scans
- **Cargo**: Automated Rust contract security audit (`cargo-audit`)
- **Docker**: Container vulnerability and CIS benchmark scans (`trivy`, `dockle`)
- **Terraform**: Infrastructure as Code misconfiguration scans (`trivy config`)

### Security Exceptions Policy

Critical/High vulnerabilities fail protected branches automatically. Temporary exceptions require designated owners and strict expiration dates tracked in [`.security-exceptions.json`](.security-exceptions.json). Expired exceptions immediately block builds. See [docs/ops/vulnerability-scanning.md](docs/ops/vulnerability-scanning.md) for details.

