import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ChatRoomLite } from '../api/client';
import { useAuth } from '../store/auth';
import type { ChatMessage, CrowdfundingPool, GroupMemberView, GroupWithMembers, PublicUser } from '../types/domain';
import { Loading, ErrorNote } from '../components/Feedback';

type Tab = 'users' | 'groups' | 'pools' | 'messages' | 'data';

const TAB_KEYS: Record<Tab, string> = {
  users: 'admin.tabUsers',
  groups: 'admin.tabGroups',
  pools: 'admin.tabPools',
  messages: 'admin.tabMessages',
  data: 'admin.tabData',
};

/** Restricted back-office: user CRUD + money editing + full group management + data portability. */
export function AdminPage() {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.role);
  const [tab, setTab] = useState<Tab>('users');

  if (role !== 'ADMIN') {
    return <ErrorNote message={t('admin.forbidden')} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t('admin.backOffice')}</h1>
      <nav className="flex gap-1 border-b border-slate-200">
        {(['users', 'groups', 'pools', 'messages', 'data'] as Tab[]).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-sm font-medium ${tab === tabKey ? 'border-b-2 border-brand-500 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t(TAB_KEYS[tabKey])}
          </button>
        ))}
      </nav>
      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'pools' && <PoolsTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'data' && <DataTab />}
    </div>
  );
}

// ---- Users (with money editing) ------------------------------------------
function UsersTab() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicUser | null>(null);

  async function reload() {
    setError(null);
    try {
      setUsers((await api.adminUsers()).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function remove(id: string) {
    if (!confirm(t('admin.deleteUserConfirm'))) return;
    await api.adminDeleteUser(id);
    void reload();
  }

  if (error) return <ErrorNote message={error} />;
  if (!users) return <Loading />;

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">{t('admin.usersCount', { count: users.length })}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">{t('admin.colName')}</th>
              <th>{t('admin.colEmail')}</th>
              <th>{t('admin.colRole')}</th>
              <th className="text-right">{t('admin.colBalance')}</th>
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
                    {t('admin.money')}
                  </button>
                  <button onClick={() => remove(u.id)} className="text-xs text-rose-600 hover:underline">
                    {t('common.delete')}
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<'adjust' | 'set'>('adjust');
  const [amount, setAmount] = useState('0');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { user: authUser, token, setSession } = useAuth();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.adminSetBalance(user.id, Number(amount), mode, memo);
      if (authUser && token && res.user.id === authUser.id) {
        setSession(token, { ...authUser, balance: res.user.balance });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30" aria-label={t('common.close')} onClick={onClose} />
      <div className="relative z-50 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="font-semibold">{t('admin.editBalance', { name: user.fullName })}</h3>
        <p className="mt-1 text-sm text-slate-500">{t('admin.current', { amount: user.balance.toFixed(2) })}</p>
        <div className="mt-3 flex gap-2">
          <select className="input w-28" value={mode} onChange={(e) => setMode(e.target.value as 'adjust' | 'set')}>
            <option value="adjust">{t('admin.adjustBy')}</option>
            <option value="set">{t('admin.setTo')}</option>
          </select>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <input className="input mt-2" placeholder={t('admin.memoOptional')} value={memo} onChange={(e) => setMemo(e.target.value)} />
        <p className="mt-1 text-[11px] text-slate-400">
          {mode === 'adjust' ? t('admin.adjustHint') : t('admin.setHint')}
        </p>
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>
            {busy ? t('common.saving') : t('common.apply')}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Groups (full management) --------------------------------------------
function GroupsTab() {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
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
        {groups.length === 0 && <p className="text-sm text-slate-400">{t('admin.noGroups')}</p>}
      </div>
      <div className="card h-fit">
        <h2 className="mb-3 font-semibold">{t('admin.createGroup')}</h2>
        <form onSubmit={create} className="space-y-2">
          <input className="input" placeholder={t('admin.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" placeholder={t('groups.description')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'INVITE')}>
            <option value="PUBLIC">{t('admin.public')}</option>
            <option value="INVITE">{t('groups.inviteOnly')}</option>
          </select>
          <button className="btn-primary w-full" type="submit">
            {t('common.create')}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminGroupCard({ group, users, onChanged }: { group: GroupWithMembers; users: PublicUser[]; onChanged: () => void }) {
  const { t } = useTranslation();
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
    if (!confirm(t('admin.deleteGroupConfirm', { name: group.name }))) return;
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
            <option value="PUBLIC">{t('admin.public')}</option>
            <option value="INVITE">{t('groups.inviteOnly')}</option>
          </select>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={saveMeta}>
              {t('common.save')}
            </button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold">{group.name}</p>
            <p className="text-sm text-slate-500">{group.description || t('common.noDescription')}</p>
            <span className="badge mt-1 bg-slate-100 text-slate-500">{group.visibility === 'INVITE' ? t('groups.inviteOnly') : t('groups.visPublic')}</span>
          </div>
          <div className="flex gap-2">
            <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </button>
            <button className="text-xs text-rose-600 hover:underline" onClick={removeGroup}>
              {t('common.delete')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-1 text-xs font-medium text-slate-500">{t('admin.membersCount', { count: members.length })}</p>
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between text-sm">
              <span>{m.fullName}</span>
              <button className="text-xs text-rose-600 hover:underline" onClick={() => removeMember(m.userId)}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <select className="input" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
            <option value="">{t('admin.addMember')}</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
          <button className="btn-secondary text-xs" onClick={addMember} disabled={!addUserId}>
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Gift pools (money management) ---------------------------------------
function PoolsTab() {
  const { t } = useTranslation();
  const [pools, setPools] = useState<Array<CrowdfundingPool & { contributions: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      setPools((await api.adminPools()).pools);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!pools) return <Loading />;

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">{t('admin.poolsTitle', { count: pools.length })}</h2>
      {pools.length === 0 && <p className="text-sm text-slate-400">{t('admin.noPools')}</p>}
      <div className="space-y-3">
        {pools.map((p) => (
          <PoolEditor key={p.id} pool={p} onSaved={reload} />
        ))}
      </div>
    </section>
  );
}

function PoolEditor({ pool, onSaved }: { pool: CrowdfundingPool & { contributions: number }; onSaved: () => void }) {
  const { t } = useTranslation();
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
      setMsg(t('admin.savedShort'));
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">🎁 {pool.subjectName}</p>
        <span className="text-xs text-slate-400">{t('admin.contributions', { count: pool.contributions })}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">{t('admin.target')}</span>
          <input type="number" className="input py-1" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">{t('admin.balance')}</span>
          <input type="number" className="input py-1" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">{t('admin.status')}</span>
          <select className="input py-1" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'CLOSED')}>
            <option value="OPEN">OPEN</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn-primary py-1 text-xs" disabled={busy} onClick={save}>
          {busy ? t('common.saving') : t('admin.savePool')}
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

// ---- Data portability -----------------------------------------------------
// ---- Chat moderation ------------------------------------------------------
function MessagesTab() {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<Array<ChatRoomLite & { messageCount: number; participantCount: number }> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [schedulerMsg, setSchedulerMsg] = useState<string | null>(null);

  async function loadRooms() {
    try {
      setRooms((await api.adminRooms()).rooms);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
    }
  }
  useEffect(() => { void loadRooms(); }, []);

  async function openRoom(roomId: string) {
    setSelected(roomId);
    setMessages((await api.adminRoomMessages(roomId)).messages);
  }
  async function saveEdit(m: ChatMessage) {
    await api.adminEditMessage(m.id, draft.trim());
    setEditingId(null);
    if (selected) setMessages((await api.adminRoomMessages(selected)).messages);
  }
  async function createMessage() {
    if (!selected || !newMessage.trim()) return;
    await api.adminCreateMessage(selected, newMessage.trim());
    setNewMessage('');
    setMessages((await api.adminRoomMessages(selected)).messages);
    void loadRooms();
  }
  async function remove(m: ChatMessage) {
    if (!confirm(t('secretChat.deleteConfirm'))) return;
    await api.adminDeleteMessage(m.id);
    if (selected) setMessages((await api.adminRoomMessages(selected)).messages);
    void loadRooms();
  }
  async function runScheduler() {
    const r = await api.adminRunScheduler();
    setSchedulerMsg(t('admin.schedulerRan', { reminders: r.reminders, pools: r.pools }));
  }

  if (error) return <ErrorNote message={error} />;
  if (!rooms) return <Loading />;

  return (
    <div className="space-y-4">
      <section className="card flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{t('admin.reminderScheduler')}</h2>
          <p className="text-xs text-slate-400">{t('admin.schedulerNote')}</p>
          {schedulerMsg && <p className="mt-1 text-xs text-brand-700">{schedulerMsg}</p>}
        </div>
        <button className="btn-ghost" onClick={runScheduler}>{t('admin.runNow')}</button>
      </section>
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <section className="card">
          <h2 className="mb-2 font-semibold">{t('admin.secretRooms', { count: rooms.length })}</h2>
          <ul className="space-y-1 text-sm">
            {rooms.map((r) => (
              <li key={r.id}>
                <button onClick={() => openRoom(r.id)} className={`w-full rounded px-2 py-1 text-left ${selected === r.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'}`}>
                  {r.subjectName}<span className="ml-1 text-xs text-slate-400">· {t('admin.msgCount', { count: r.messageCount })}</span>
                </button>
              </li>
            ))}
            {rooms.length === 0 && <li className="text-sm text-slate-400">{t('admin.noRooms')}</li>}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">{t('admin.messages')}</h2>
          {selected && (
            <div className="mb-3 flex gap-2">
              <input className="input" placeholder={t('admin.createAdminMsg')} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
              <button className="btn-primary" disabled={!newMessage.trim()} onClick={createMessage}>{t('common.create')}</button>
            </div>
          )}
          {!selected && <p className="text-sm text-slate-400">{t('admin.selectRoom')}</p>}
          {selected && messages.length === 0 && <p className="text-sm text-slate-400">{t('admin.noMessagesRoom')}</p>}
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-slate-100 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{m.authorName}</span>
                  <span className="flex gap-2 text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => { setEditingId(m.id); setDraft(m.body); }}>{t('secretChat.editLower')}</button>
                    <button className="text-rose-600 hover:underline" onClick={() => remove(m)}>{t('secretChat.deleteLower')}</button>
                  </span>
                </div>
                {editingId === m.id ? (
                  <div className="mt-1 space-y-1">
                    <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <div className="flex gap-2 text-xs">
                      <button className="btn-primary py-1" onClick={() => saveEdit(m)}>{t('common.save')}</button>
                      <button className="btn-ghost py-1" onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                ) : <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{m.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function DataTab() {
  const { t } = useTranslation();
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
      setImportResult(t('admin.imported', { created: res.created, skipped: res.skipped, total: res.total }));
      setPayload('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.importFailed'));
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{t('admin.dataPortability')}</h2>
      {error && <ErrorNote message={error} />}
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600">{t('admin.format')}</label>
        <select className="input w-32" value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}>
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button onClick={doExport} className="btn-secondary">
          {t('admin.exportUsers')}
        </button>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-600">{t('admin.importPayload', { format: format.toUpperCase() })}</label>
        <textarea
          className="input h-32 font-mono text-xs"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder={format === 'json' ? '[{"email":"new@example.com","fullName":"New User","birthdate":"1990-01-01"}]' : 'email,fullName,birthdate\nnew@example.com,New User,1990-01-01'}
        />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={doImport} className="btn-primary" disabled={!payload.trim()}>
            {t('admin.import')}
          </button>
          {importResult && <span className="text-sm text-emerald-600">{importResult}</span>}
        </div>
      </div>
    </section>
  );
}
