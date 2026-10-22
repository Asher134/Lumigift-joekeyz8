# Production Secret & Key Rotation Audit Log

This file records every rotation of production credentials (`STELLAR_SERVER_SECRET_KEY`, `NEXTAUTH_SECRET`, `DATABASE_URL`, `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, etc.).
Append a new entry each time a secret rotation or revocation is performed.

See [`docs/ops/production-secret-management.md`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/docs/ops/production-secret-management.md) and [`docs/ops/key-rotation.md`](file:///c:/Users/DELL/Desktop/kud/Lumigift-lumigift/docs/ops/key-rotation.md) for procedures.

---

<!-- Template:
## Rotation — YYYY-MM-DD

- Secret Name: [e.g. STELLAR_SERVER_SECRET_KEY / NEXTAUTH_SECRET / DATABASE_URL]
- Rotated by: [engineer name / automated system]
- Reason: [scheduled (90d/180d) / suspected compromise / provider migration / testing]
- Environment: [production / staging]
- Secret Store Version / ID: [AWS Secrets Manager version / ARN]
- Deployment Ref / SHA: [deployment ID or commit SHA]
- Verification: [health endpoint 200 / deep check / test transaction confirmed]
- Previous Secret Revoked / Deprecated: [yes/no, timestamp]
- Notes / Incident Ref: [optional notes or ticket ID]
-->

