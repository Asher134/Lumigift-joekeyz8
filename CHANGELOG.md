# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Data export (`GET /api/v1/users/me/export`) and OTP-verified account erasure (`DELETE /api/v1/users/me`), both audited. Financial records are retained per the documented exceptions (#145)
- Gift cancellation preview (`GET /api/v1/gifts/:id/cancel`), a confirmation dialog, and refund status with a support link on the sender's gift card (#147)
- Recipient claim discovery page (`/claim`) and OTP-gated `POST /api/v1/gifts/discover` (#148)

### Changed

- Cancellation eligibility now mirrors the escrow contract: cancellable until claimed, including after unlock (#147)

### Deprecated

### Removed

### Fixed

- Misplaced `return otp;` in `sms.ts` that broke compilation of `gift.service` imports

### Security

- Authenticated API penetration test report and regression tests, see `docs/security/pentest-2026-09.md` (#146)
- Claim route no longer skips the recipient check for sessions without a phone (PT-01)
- Cron routes fail closed when `CRON_SECRET` is unset (PT-05)
- Phone registration lookup requires a session and is rate limited (PT-02)
- Public gift view hides the amount, message and media until unlock (PT-03)
- Media upload endpoints require a session (PT-04)
- OTPs are generated with `crypto.randomInt` (PT-08)

---

## [0.1.0] - 2024-12-15

### Added

#### Core Features

- Time-locked cash gift creation with surprise unlock dates
- Phone-based OTP authentication via Termii SMS
- Sender dashboard for tracking sent gifts
- Gift claiming flow for recipients
- Gift cancellation before unlock date

#### Blockchain Integration

- Soroban smart contract for escrow with time-lock enforcement
- USDC stablecoin support on Stellar testnet
- Stellar transaction tracking and event indexing
- Automated unlock scheduler via cron jobs

#### Payment Processing

- Paystack integration for Nigerian Naira (NGN) on-ramp
- Stripe integration for international card payments
- Payment callback handling and verification
- Webhook processing for payment status updates

#### User Experience

- Responsive Next.js 14 App Router frontend
- Vanilla CSS design system with accessibility focus
- Gift card preview with media upload support
- Real-time gift status tracking
- Email and SMS notifications for gift events

#### Developer Experience

- TypeScript throughout with strict type checking
- Zod schemas for runtime validation
- Comprehensive test suite (Jest + Playwright)
- Visual regression testing with Playwright
- Load testing with k6
- OpenAPI documentation at `/api/docs`
- Docker Compose for local development
- Terraform infrastructure as code
- CI/CD pipeline with GitHub Actions
- Pre-commit hooks with Husky and gitleaks
- Conventional commits enforcement

#### Security & Compliance

- Secret scanning with gitleaks
- AML/regulatory gift amount limits
- Device tracking for fraud prevention
- Phone number hashing for privacy
- Rate limiting on API endpoints
- WCAG 2.1 AA accessibility compliance tracking

#### Documentation

- Architecture Decision Records (ADRs)
- API documentation with OpenAPI spec
- Local development setup guide
- Database backup and recovery procedures
- Performance benchmarking results
- Security audit plan
- Contributing guidelines
- Code of conduct

### Security

- Environment variable validation on startup
- NextAuth.js session management with JWT
- Secure key rotation support for auth secrets
- Cron job authentication with bearer tokens
- Webhook signature verification (Stripe)

---

## Release History

[Unreleased]: https://github.com/joekeyz8/Lumigift-lumigift/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joekeyz8/Lumigift-lumigift/releases/tag/v0.1.0
