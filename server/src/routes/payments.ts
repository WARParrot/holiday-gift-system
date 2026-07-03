import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { topUpSchema } from './schemas.js';
import { processMockCharge } from '../services/mockBank.js';

/**
 * Wallet / payments surface. Backs the profile "Payment" subpage:
 *  - GET  /api/payments/wallet       → balance + recent transactions
 *  - POST /api/payments/topup        → add funds via the mock bank
 *
 * Top-ups run through the same `processMockCharge` pseudo-bank used by
 * crowdfunding, then credit the user's balance atomically. No real money or
 * card data is involved — `method` is a display label only.
 */
export function paymentRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config));

  // GET /api/payments/wallet — current balance + ledger
  router.get('/wallet', (req, res) => {
    const userId = req.principal!.userId;
    res.json({
      balance: repo.getBalance(userId),
      transactions: repo.listWalletTransactions(userId),
    });
  });

  // POST /api/payments/topup — add funds to the wallet
  router.post('/topup', (req, res) => {
    const userId = req.principal!.userId;
    const body = parseBody(topUpSchema, req.body, res);
    if (!body) return;

    // Authorize the "charge" against the (simulated) funding source.
    const charge = processMockCharge({
      userId,
      amount: body.amount,
      targetAmount: body.amount,
      currentBalance: repo.getBalance(userId),
    });
    if (!charge.ok) {
      res.status(402).json({ error: charge.error ?? 'Payment failed' });
      return;
    }

    const tx = repo.applyWalletTransaction({
      id: randomUUID(),
      userId,
      kind: 'TOPUP',
      amount: charge.processedAmount,
      memo: `Top-up via ${body.method}`,
      txRef: charge.txRef,
    });
    if (!tx) {
      res.status(500).json({ error: 'Failed to record top-up' });
      return;
    }

    ctx.notifications.push(
      userId,
      'SYSTEM',
      'Wallet topped up',
      `Added ${charge.processedAmount.toFixed(2)} to your balance (${charge.txRef}).`,
      { txRef: charge.txRef, amount: charge.processedAmount },
    );

    res.status(201).json({ balance: tx.balanceAfter, transaction: tx });
  });

  return router;
}
