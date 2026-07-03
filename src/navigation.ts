/** Lightweight view routing (no router dependency in this barebones version). */

import type { ID } from './types';

export type View =
  | { name: 'directory' }
  | { name: 'groups' }
  | { name: 'friend'; userId: ID };

export type Navigate = (view: View) => void;
