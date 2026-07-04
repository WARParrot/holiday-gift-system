import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { requireAuth } from '../middleware/auth.js';
import { parseBody } from '../util/validate.js';
import { wishlistCreateSchema, wishlistStatusSchema, wishlistUpdateSchema } from './schemas.js';

/**
 * Wishlist engine. Owners have full CRUD over their own items. Any viewer may
 * flip an item's status to SUGGESTED (to signal "I'm thinking of getting this")
 * — but only the owner can edit/delete content.
 */
export function wishlistRoutes(ctx: AppContext): Router {
  const router = Router();
  const { repo, config } = ctx;
  router.use(requireAuth(config, repo));

  // GET /api/wishlist/:userId — a user's wishlist (own or someone else's)
  router.get('/:userId', (req, res) => {
    res.json({ items: repo.listWishlist(req.params.userId) });
  });

  // POST /api/wishlist — add to own wishlist
  router.post('/', (req, res) => {
    const body = parseBody(wishlistCreateSchema, req.body, res);
    if (!body) return;
    const item = {
      id: randomUUID(),
      ownerId: req.principal!.userId,
      title: body.title,
      description: body.description ?? '',
      link: body.link ?? null,
      priceMin: body.priceMin ?? null,
      priceMax: body.priceMax ?? null,
      status: 'OPEN' as const,
      createdAt: new Date().toISOString(),
    };
    repo.createWishlistItem(item);
    res.status(201).json({ item });
  });

  // PUT /api/wishlist/item/:id — edit own item
  router.put('/item/:id', (req, res) => {
    const existing = repo.getWishlistItem(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Пункт не найден' });
      return;
    }
    if (existing.ownerId !== req.principal!.userId) {
      res.status(403).json({ error: 'Вы можете редактировать только свои желания' });
      return;
    }
    const body = parseBody(wishlistUpdateSchema, req.body, res);
    if (!body) return;
    const updated = {
      ...existing,
      title: body.title,
      description: body.description ?? '',
      link: body.link ?? null,
      priceMin: body.priceMin ?? null,
      priceMax: body.priceMax ?? null,
      status: body.status ?? existing.status,
    };
    repo.updateWishlistItem(updated);
    res.json({ item: updated });
  });

  // DELETE /api/wishlist/item/:id — delete own item
  router.delete('/item/:id', (req, res) => {
    const existing = repo.getWishlistItem(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Пункт не найден' });
      return;
    }
    if (existing.ownerId !== req.principal!.userId) {
      res.status(403).json({ error: 'Вы можете удалять только свои желания' });
      return;
    }
    repo.deleteWishlistItem(req.params.id);
    res.json({ ok: true });
  });

  // PATCH /api/wishlist/item/:id/status — any viewer marks an item SUGGESTED/RESERVED
  router.patch('/item/:id/status', (req, res) => {
    const existing = repo.getWishlistItem(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Пункт не найден' });
      return;
    }
    const body = parseBody(wishlistStatusSchema, req.body, res);
    if (!body) return;
    // A viewer must not mark their OWN item as suggested/reserved.
    if (existing.ownerId === req.principal!.userId) {
      res.status(403).json({ error: 'Нельзя менять статус собственного пункта' });
      return;
    }
    repo.setWishlistStatus(req.params.id, body.status);
    res.json({ item: repo.getWishlistItem(req.params.id) });
  });

  return router;
}
