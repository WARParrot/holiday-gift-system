import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { GroupInvitation, GroupWithMeta } from '../types/domain';
import { Loading, ErrorNote } from '../components/Feedback';

/**
 * Scenario 1 (groups half) — master directory of all groups; create + join.
 */
export function GroupsPage() {
  const [groups, setGroups] = useState<GroupWithMeta[] | null>(null);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INVITE'>('PUBLIC');

  const load = () => {
    Promise.all([api.groups(), api.groupInvitations()])
      .then(([g, inv]) => {
        setGroups(g.groups);
        setInvitations(inv.invitations);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load groups'));
  };
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createGroup({ name, description, visibility });
    setName('');
    setDescription('');
    load();
  }

  async function toggleJoin(g: GroupWithMeta) {
    if (g.isMember) await api.leaveGroup(g.id);
    else await api.joinGroup(g.id);
    load();
  }

  async function resolveInvitation(id: string, action: 'accept' | 'decline') {
    if (action === 'accept') await api.acceptGroupInvitation(id);
    else await api.declineGroupInvitation(id);
    load();
  }

  if (error) return <ErrorNote message={error} />;
  if (!groups) return <Loading label="Loading groups…" />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="mb-4 text-xl font-bold">Groups directory</h1>
        {invitations.length > 0 && (
          <div className="mb-4 space-y-2">
            <h2 className="font-semibold">Group invitations</h2>
            {invitations.map((i) => (
              <div key={i.id} className="card flex items-center justify-between border-brand-100 bg-brand-50/40">
                <div>
                  <p className="font-medium">{i.groupName}</p>
                  <p className="text-sm text-slate-500">Invited by {i.inviterName}</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => resolveInvitation(i.id, 'accept')}>Accept</button>
                  <button className="btn-ghost" onClick={() => resolveInvitation(i.id, 'decline')}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="card flex items-center justify-between">
              <div>
                <Link to={`/groups/${g.id}`} className="font-semibold hover:text-brand-600">
                  {g.name}
                </Link>
                <p className="text-sm text-slate-500">{g.description || 'No description'}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.visibility}
                </p>
              </div>
              <button className={g.isMember ? 'btn-ghost' : 'btn-primary'} onClick={() => toggleJoin(g)}>
                {g.isMember ? 'Leave' : 'Join'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Create a group</h2>
          <form onSubmit={create} className="space-y-3">
            <input className="input" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'INVITE')}>
              <option value="PUBLIC">Public (anyone can join)</option>
              <option value="INVITE">Invite-only</option>
            </select>
            <button className="btn-primary w-full" type="submit">
              Create group
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
