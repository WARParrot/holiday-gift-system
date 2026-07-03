import { randomUUID } from 'node:crypto';

/**
 * Mock financial gateway (the "Pseudo-Bank").
 *
 * The spec calls for a mock banking API that processes a payload of
 * { userId, targetAmount, currentBalance }. This module SIMULATES a payment
 * processor: it validates the charge, produces a deterministic-looking
 * transaction reference, and reports success/failure. No real money moves and
 * no external network call is made — it is intentionally self-contained so the
 * deliverable runs anywhere.
 */
export interface MockChargeRequest {
  userId: string;
  amount: number;
  /** The pool's target amount (for context / limit checks). */
  targetAmount: number;
  /** The pool's balance before this charge. */
  currentBalance: number;
}

export interface MockChargeResult {
  ok: boolean;
  txRef: string;
  processedAmount: number;
  error?: string;
}

const MAX_SINGLE_CHARGE = 100_000;

export function processMockCharge(req: MockChargeRequest): MockChargeResult {
  if (!Number.isFinite(req.amount) || req.amount <= 0) {
    return { ok: false, txRef: '', processedAmount: 0, error: 'Amount must be a positive number' };
  }
  if (req.amount > MAX_SINGLE_CHARGE) {
    return { ok: false, txRef: '', processedAmount: 0, error: 'Amount exceeds per-charge limit' };
  }
  // A real gateway would authorize against a card here. We simulate approval.
  const txRef = `MOCK-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  return { ok: true, txRef, processedAmount: Math.round(req.amount * 100) / 100 };
}
