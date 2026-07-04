import type { Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

/**
 * Parse a body with a Zod schema; on failure writes a 400 and returns null.
 *
 * Uses `z.infer<S>` (the schema's OUTPUT type) so fields declared with
 * `.default()` are non-optional in the returned value, matching runtime reality.
 */
export function parseBody<S extends ZodTypeAny>(
  schema: S,
  body: unknown,
  res: Response,
): z.infer<S> | null {
  try {
    return schema.parse(body) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Проверка данных не пройдена', details: err.flatten() });
    } else {
      res.status(400).json({ error: 'Некорректное тело запроса' });
    }
    return null;
  }
}
