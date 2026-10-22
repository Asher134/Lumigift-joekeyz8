# Issue #311: Device Anomaly Detection Plan

This draft records an implementation plan for step-up verification on
unrecognized-device logins. It does not change authentication behavior; the
issue remains open pending implementation and review of the security flow.

## Current Behavior

- `src/lib/auth.ts` verifies the login OTP in the NextAuth credentials provider.
- After that OTP succeeds, an unknown fingerprint is immediately inserted into
  `known_devices` and an SMS alert is sent. There is no additional verification
  step before the device becomes trusted.
- `src/lib/device.ts` hashes request `User-Agent`, `Accept-Language`, and
  `Accept-Encoding`. Screen resolution and timezone are not available in these
  server request headers.
- `migrations/0002_add_device_tracking.sql` stores only the fingerprint and
  timestamps. There is no admin device-history endpoint or device unit test.

## Proposed Implementation

1. Collect the required client signals (user-agent, screen resolution, and
   timezone) at the login boundary. Derive the network signal server-side from
   the trusted proxy address and normalize IPv4 to its `/24` network; do not
   trust a client-supplied IP value.
2. For an unknown fingerprint, issue a short-lived, single-use step-up
   challenge bound to the user and fingerprint. Do not insert the device or
   create a session until the existing phone OTP has been verified for that
   challenge.
3. Store the new device only after successful step-up. Persist only the
   fingerprint and the minimum metadata needed for anomaly comparison and
   history; avoid retaining the full IP address.
4. Send the new-device SMS after successful verification. Keep delivery
   failures from blocking login, but record them for operational visibility.
5. Add an admin-only, paginated device-history endpoint that returns masked
   metadata and timestamps, and add unit tests for known/new devices, challenge
   replay/expiry, and `/24` normalization.

## Decisions Needed Before Runtime Changes

- Define how to trust and parse proxy IP headers in each deployment environment.
- Decide whether country changes are a step-up signal or an alert-only signal;
  the issue description mentions country changes, while its acceptance list
  specifies the fingerprint fields but not a geolocation provider.
- Confirm challenge storage, retention, and rate limits, and whether an existing
  OTP can be reused or a separate OTP purpose is required.
- Define the admin endpoint's authorization, pagination, audit, and retention
  requirements.

## Acceptance Mapping

The current code does not meet the step-up, post-verification storage,
resolution/timezone/IP-prefix, admin-history, or unit-test criteria. This plan
is a review aid only and intentionally does not claim to resolve #311.
