import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { DirectoryUser } from '../types/domain';
import { Avatar } from '../components/Avatar';
import { Loading, ErrorNote, Empty } from '../components/Feedback';
import { formatBirthdayCountdown } from '../components/format';

/**
 * Scenario 1 — Discovery & Directory Inspection.
 * Browse all users sorted by nearest upcoming birthday; open a Friend Card.
 */
export function DirectoryPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .directory()
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e instanceof Error ? e.message : t('directory.loadFailed')));
  }, [t]);

  if (error) return <ErrorNote message={error} />;
  if (!users) return <Loading label={t('directory.loading')} />;

  const filtered = users.filter((u) => u.fullName.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('directory.title')}</h1>
        <input
          className="input max-w-xs"
          placeholder={t('directory.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered.length === 0 && <Empty label={t('directory.noMatch')} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((u) => (
          <Link key={u.id} to={`/friends/${u.id}`} className="card transition hover:shadow-md">
            <div className="flex items-center gap-3">
              <Avatar name={u.fullName} url={u.avatarUrl} size={48} />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {u.fullName} {u.isSelf && <span className="text-xs text-slate-400">{t('common.you')}</span>}
                </p>
                <p className="text-sm text-slate-500">🎂 {formatBirthdayCountdown(u.daysUntilBirthday)}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
