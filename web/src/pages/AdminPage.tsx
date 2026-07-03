import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import type { CrowdfundingPool, GroupMemberView, GroupWithMembers, PublicUser } from '../types/domain';
import { Loading, ErrorNote } from '../components/Feedback';

type Tab = 'users' | 'groups' | 'pools' | 'data';

/** Restricted back-office: user CRUD + money editing + full group management + data portability. */
export function AdminPage() {
  const role = useAuth((s) => s.user?.role);
  const [tab, setTab] = useState<Tab>('users');

  if (role !== 'ADMIN') {
    return <ErrorNote message="Forbidden: this area requires the ADMIN role." />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Admin back-office</h1>
      <nav className="flex gap-1 border-b border-slate-200">
        {(['users', 'groups', 'pools', 'data'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-brand-500 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'pools' ? 'Gift pools' : t}
          </button>
        ))}
      </nav>
      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'pools' && <PoolsTab />}
      {tab === 'data' && <DataTab />}
    </div>
  );
}

// ---- Users (with money editing) ------------------------------------------
function UsersTab() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicUser | null>(null);

  async function reload() {
    setError(null);
    try {
      setUsers((await api.adminUsers()).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this user and all their data? This cannot be undone.')) return;
    await api.adminDeleteUser(id);
    void reload();
  }

  if (error) return <ErrorNote message={error} />;
  if (!users) return <Loading />;

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Users ({users.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th className="text-right">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-1.5">{u.fullName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td className="text-right font-medium text-emerald-700">${u.balance.toFixed(2)}</td>
                <td className="text-right">
                  <button onClick={() => setEditing(u)} className="mr-3 text-xs text-brand-600 hover:underline">
                    Money
                  </button>
                  <button onClick={() => remove(u.id)} className="text-xs text-rose-600 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <BalanceEditor
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

function BalanceEditor({ user, onClose, onSaved }: { user: PublicUser; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'adjust' | 'set'>('adjust');
  const [amount, setAmount] = useState('0');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.adminSetBalance(user.id, Number(amount), mode, memo);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative z-50 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="font-semibold">Edit balance — {user.fullName}</h3>
        <p className="mt-1 text-sm text-slate-500">Current: ${user.balance.toFixed(2)}</p>
        <div className="mt-3 flex gap-2">
          <select className="input w-28" value={mode} onChange={(e) => setMode(e.target.value as 'adjust' | 'set')}>
            <option value="adjust">Adjust by</option>
            <option value="set">Set to</option>
          </select>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <input className="input mt-2" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <p className="mt-1 text-[11px] text-slate-400">
          {mode === 'adjust' ? 'Positive credits, negative debits.' : 'Sets the absolute balance.'}
        </p>
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Apply'}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Groups (full management) --------------------------------------------
function GroupsTab() {
  const [groups, setGroups] = useState<GroupWithMembers[] | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INVITE'>('PUBLIC');

  async function reload() {
    setError(null);
    try {
      const [g, u] = await Promise.all([api.adminGroups(), api.adminUsers()]);
      setGroups(g.groups);
      setUsers(u.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.adminCreateGroup({ name, description, visibility });
    setName('');
    setDescription('');
    void reload();
  }

  if (error) return <ErrorNote message={error} />;
  if (!groups) return <Loading />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {groups.map((g) => (
          <AdminGroupCard key={g.id} group={g} users={users} onChanged={reload} />
        ))}
        {groups.length === 0 && <p className="text-sm text-slate-400">No groups yet.</p>}
      </div>
      <div className="card h-fit">
        <h2 className="mb-3 font-semibold">Create group</h2>
        <form onSubmit={create} className="space-y-2">
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'INVITE')}>
            <option value="PUBLIC">Public</option>
            <option value="INVITE">Invite-only</option>
          </select>
          <button className="btn-primary w-full" type="submit">
            Create
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminGroupCard({ group, users, onChanged }: { group: GroupWithMembers; users: PublicUser[]; onChanged: () => void }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [visibility, setVisibility] = useState(group.visibility);
  const [members, setMembers] = useState<GroupMemberView[]>(group.members);
  const [addUserId, setAddUserId] = useState('');
  const [editing, setEditing] = useState(false);

  const nonMembers = users.filter((u) => !members.some((m) => m.userId === u.id));

  async function saveMeta() {
    await api.adminUpdateGroup(group.id, { name, description, visibility });
    setEditing(false);
    onChanged();
  }
  async function removeGroup() {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    await api.adminDeleteGroup(group.id);
    onChanged();
  }
  async function addMember() {
    if (!addUserId) return;
    const res = await api.adminAddGroupMember(group.id, addUserId);
    setMembers(res.members);
    setAddUserId('');
  }
  async function removeMember(userId: string) {
    const res = await api.adminRemoveGroupMember(group.id, userId);
    setMembers(res.members);
  }

  return (
    <div className="card">
      {editing ? (
        <div className="space-y-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'INVITE')}>
            <option value="PUBLIC">Public</option>
            <option value="INVITE">Invite-only</option>
          </select>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={saveMeta}>
              Save
            </button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold">{group.name}</p>
            <p className="text-sm text-slate-500">{group.description || 'No description'}</p>
            <span className="badge mt-1 bg-slate-100 text-slate-500">{group.visibility}</span>
          </div>
          <div className="flex gap-2">
            <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="text-xs text-rose-600 hover:underline" onClick={removeGroup}>
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-medium text-slate-500">Members ({members.length})</p>
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between text-sm">
              <span>{m.fullName}</span>
              <button className="text-xs text-rose-600 hover:underline" onClick={() => removeMember(m.userId)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <select className="input" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
            <option value="">Add member…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
          <button className="btn-secondary text-xs" onClick={addMember} disabled={!addUserId}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Gift pools (money management) ---------------------------------------
function PoolsTab() {
  const [pools, setPools] = useState<Array<CrowdfundingPool & { contributions: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      setPools((await api.adminPools()).pools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!pools) return <Loading />;

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Crowdfunding gift pools ({pools.length})</h2>
      {pools.length === 0 && <p className="text-sm text-slate-400">No pools yet.</p>}
      <div className="space-y-3">
        {pools.map((p) => (
          <PoolEditor key={p.id} pool={p} onSaved={reload} />
        ))}
      </div>
    </section>
  );
}

function PoolEditor({ pool, onSaved }: { pool: CrowdfundingPool & { contributions: number }; onSaved: () => void }) {
  const [target, setTarget] = useState(String(pool.targetAmount));
  const [balance, setBalance] = useState(String(pool.currentBalance));
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>(pool.status);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.adminUpdatePool(pool.id, Number(target), Number(balance), status);
      setMsg('Saved');
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">🎁 {pool.subjectName}</p>
        <span className="text-xs text-slate-400">{pool.contributions} contribution(s)</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Target</span>
          <input type="number" className="input py-1" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Balance</span>
          <input type="number" className="input py-1" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Status</span>
          <select className="input py-1" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'CLOSED')}>
            <option value="OPEN">OPEN</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn-primary py-1 text-xs" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save pool'}
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

// ---- Data portability -----------------------------------------------------
function DataTab() {
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [payload, setPayload] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Data portability</h2>
      {error && <ErrorNote message={error} />}
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
  );
}
