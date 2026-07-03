import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import type { PublicUser } from '../types/domain';
import { Loading, ErrorNote } from '../components/Feedback';

/** Restricted back-office: user CRUD + JSON/CSV data portability. */
export function AdminPage() {
  const role = useAuth((s) => s.user?.role);
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [payload, setPayload] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const res = await api.adminUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (role !== 'ADMIN') {
    return <ErrorNote message="Forbidden: this area requires the ADMIN role." />;
  }

  async function remove(id: string) {
    if (!confirm('Delete this user and all their data? This cannot be undone.')) return;
    await api.adminDeleteUser(id);
    void reload();
  }

  async function doExport() {
    const data = await api.adminExport(format);
    const text = format === 'json' ? JSON.stringify(data, null, 2) : String(data);
    const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bcms-users.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    setImportResult(null);
    setError(null);
    try {
      const res = await api.adminImport(format, payload);
      setImportResult(`Imported ${res.created} new, skipped ${res.skipped} (of ${res.total}).`);
      setPayload('');
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Admin back-office</h1>
      {error && <ErrorNote message={error} />}

      <section className="card">
        <h2 className="mb-3 font-semibold">Users ({users?.length ?? 0})</h2>
        {!users ? (
          <Loading />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Name</th>
                <th>Email</th>
                <th>Birthdate</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-1.5">{u.fullName}</td>
                  <td>{u.email}</td>
                  <td>{u.birthdate}</td>
                  <td>{u.role}</td>
                  <td className="text-right">
                    <button onClick={() => remove(u.id)} className="text-xs text-rose-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Data portability</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">Format</label>
          <select className="input w-32" value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
          <button onClick={doExport} className="btn-secondary">
            Export users
          </button>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Import payload ({format.toUpperCase()})</label>
          <textarea
            className="input h-32 font-mono text-xs"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder={format === 'json' ? '[{"email":"new@example.com","fullName":"New User","birthdate":"1990-01-01"}]' : 'email,fullName,birthdate\nnew@example.com,New User,1990-01-01'}
          />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={doImport} className="btn-primary" disabled={!payload.trim()}>
              Import
            </button>
            {importResult && <span className="text-sm text-emerald-600">{importResult}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
