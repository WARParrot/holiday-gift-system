import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import type { WishlistItem } from '../types/domain';
import { Loading, ErrorNote, Empty } from '../components/Feedback';
import { formatPriceRange } from '../components/format';

interface FormState {
  title: string;
  description: string;
  link: string;
  priceMin: string;
  priceMax: string;
}

const EMPTY: FormState = { title: '', description: '', link: '', priceMin: '', priceMax: '' };

/** Scenario 3 (self side) — manage your own wishlist. */
export function WishlistPage() {
  const user = useAuth((s) => s.user);
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!user) return;
    api
      .wishlist(user.id)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load wishlist'));
  };
  useEffect(load, [user]);

  function toPayload(f: FormState) {
    return {
      title: f.title.trim(),
      description: f.description.trim(),
      link: f.link.trim() || null,
      priceMin: f.priceMin ? Number(f.priceMin) : null,
      priceMax: f.priceMax ? Number(f.priceMax) : null,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      if (editingId) await api.updateWishlistItem(editingId, toPayload(form));
      else await api.addWishlistItem(toPayload(form));
      setForm(EMPTY);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  function startEdit(item: WishlistItem) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description,
      link: item.link ?? '',
      priceMin: item.priceMin?.toString() ?? '',
      priceMax: item.priceMax?.toString() ?? '',
    });
  }

  async function remove(id: string) {
    await api.deleteWishlistItem(id);
    load();
  }

  if (error) return <ErrorNote message={error} />;
  if (!items) return <Loading label="Loading your wishlist…" />;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-4 text-xl font-bold">My wishlist</h1>
        {items.length === 0 && <Empty label="Your wishlist is empty. Add something you'd love to receive." />}
        <div className="space-y-3">
          {items.map((item) => {
            const price = formatPriceRange(item.priceMin, item.priceMax);
            return (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    {item.description && <p className="mt-1 text-sm text-slate-500">{item.description}</p>}
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      {price && <span className="badge bg-emerald-50 text-emerald-700">{price}</span>}
                      <span className="badge bg-slate-100 text-slate-500">{item.status}</span>
                      {item.link && (
                        <a href={item.link} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                          View link ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button className="btn-ghost text-rose-600" onClick={() => remove(item.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={submit} className="card h-fit space-y-3">
        <h2 className="font-semibold">{editingId ? 'Edit item' : 'Add an item'}</h2>
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <textarea className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        <input className="input" placeholder="Link (optional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
        <div className="flex gap-2">
          <input className="input" placeholder="Min $" type="number" value={form.priceMin} onChange={(e) => setForm({ ...form, priceMin: e.target.value })} />
          <input className="input" placeholder="Max $" type="number" value={form.priceMax} onChange={(e) => setForm({ ...form, priceMax: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">
            {editingId ? 'Save changes' : 'Add item'}
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
