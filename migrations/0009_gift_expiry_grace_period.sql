-- Migration: 0009_gift_expiry_grace_period
-- Issue #338 — Gift expiry grace period before refund processing
--
-- Expired gifts enter `expired_pending_refund` with `refund_due_at` set to
-- now + GIFT_EXPIRY_GRACE_PERIOD_DAYS. The expire cron only refunds once
-- `refund_due_at` has passed. Admins may shorten or waive it per gift.

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS refund_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gifts_expired_pending_refund
  ON gifts(refund_due_at)
  WHERE status = 'expired_pending_refund';
