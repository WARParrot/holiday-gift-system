/** Displays a user's wishlist. Read-only in this barebones version. */

import type { WishlistItem } from '../types';

const STATUS_LABEL: Record<WishlistItem['status'], string> = {
  available: 'Available',
  suggested: 'Suggested',
  reserved: 'Reserved',
};

export function Wishlist({
  items,
  editable,
}: {
  items: WishlistItem[];
  editable: boolean;
}) {
  if (items.length === 0) {
    return <p className="muted">No wishlist items yet.</p>;
  }

  return (
    <ul className="wishlist">
      {items.map((item) => (
        <li key={item.id} className="wishlist-item">
          <div className="wishlist-item-head">
            <span className="wishlist-title">{item.title}</span>
            {!editable && (
              <span className={`badge badge-${item.status}`}>
                {STATUS_LABEL[item.status]}
              </span>
            )}
          </div>
          {item.description && <p className="muted">{item.description}</p>}
          <div className="wishlist-meta">
            {item.priceRange && <span>{item.priceRange}</span>}
            {item.link && (
              <a href={item.link} target="_blank" rel="noreferrer">
                View link
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
