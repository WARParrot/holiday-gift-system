import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { DirectoryUser, Group, GroupInvitation, GroupMemberView } from '../types/domain';
import { Avatar } from '../components/Avatar';
import { Loading, ErrorNote } from '../components/Feedback';
import { formatBirthdayCountdown } from '../components/format';
import { useAuth } from '../store/auth';

/** Group detail: members sorted by birthday, group subscription, owner invite widget, and leave handling. */
export function GroupDetailPage() {
  const { t } = useTranslation();
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const [data, setData] = useState<{ group: Group; members: GroupMemberView[]; isMember: boolean; pendingInvitations: GroupInvitation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [calendarSync, setCalendarSync] = useState(false);

  const load = () => {
    if (!groupId) return;
    api.group(groupId).then(setData).catch((e) => setError(e instanceof Error ? e.message : t('groupDetail.loadFailed')));
    api.subscriptions().then((r) => setSubscribed(r.subscriptions.some((s) => s.kind === 'GROUP' && s.targetId === groupId)));
  };
  useEffect(load, [groupId]);

  async function toggleSubscribe() {
    if (!groupId) return;
    if (subscribed) {
      await api.unsubscribe({ kind: 'GROUP', targetId: groupId });
      setSubscribed(false);
    } else {
      await api.subscribe({ kind: 'GROUP', targetId: groupId, calendarSync });
      setSubscribed(true);
    }
  }

  async function leave() {
    if (!groupId) return;
    const res = await api.leaveGroup(groupId);
    if (res.groupDeleted) {
      navigate('/groups');
      return;
    }
    load();
  }

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label={t('groupDetail.loading')} />;
  const isOwner = me?.id === data.group.ownerId;

  return (
    <div>
      <div className="card mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{data.group.name}</h1>
            <p className="text-sm text-slate-500">{data.group.description || t('common.noDescription')}</p>
            <p className="mt-1 text-xs text-slate-400">
              {data.group.visibility === 'INVITE' ? t('groupDetail.inviteOnly') : t('groupDetail.public')} · {t('groupDetail.membersCount', { count: data.members.length })}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className={subscribed ? 'btn-ghost' : 'btn-primary'} onClick={toggleSubscribe}>
              {subscribed ? t('groupDetail.subscribedGroup') : t('groupDetail.subscribeGroup')}
            </button>
            {!subscribed && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={calendarSync} onChange={(e) => setCalendarSync(e.target.checked)} />
                {t('groupDetail.addAllToCalendar')}
              </label>
            )}
            {data.isMember && <button className="btn-ghost text-xs text-rose-600" onClick={leave}>{t('groupDetail.leaveGroup')}</button>}
          </div>
        </div>
      </div>

      {isOwner && <InviteWidget groupId={data.group.id} members={data.members} onInvited={load} />}
      {isOwner && data.pendingInvitations.length > 0 && (
        <div className="card mb-4">
          <h2 className="mb-2 font-semibold">{t('groupDetail.pendingInvitations')}</h2>
          <ul className="space-y-1 text-sm text-slate-600">
            {data.pendingInvitations.map((i) => (
              <li key={i.id}>{t('groupDetail.pendingLine', { invitee: i.inviteeName, inviter: i.inviterName })}</li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mb-2 font-semibold">{t('groupDetail.membersUpcoming')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.members.map((m) => (
          <Link key={m.userId} to={`/friends/${m.userId}`} className="card flex items-center gap-3 hover:shadow-md">
            <Avatar name={m.fullName} url={m.avatarUrl} size={44} />
            <div>
              <p className="font-medium">{m.fullName}</p>
              <p className="text-sm text-slate-500">🎂 {formatBirthdayCountdown(m.daysUntilBirthday)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function InviteWidget({ groupId, members, onInvited }: { groupId: string; members: GroupMemberView[]; onInvited: () => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.directory().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = users.filter((u) => !memberIds.has(u.id) && !u.isSelf);

  async function invite() {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.inviteToGroup(groupId, selected);
      setSelected('');
      setMsg(t('groupDetail.inviteSent'));
      onInvited();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('groupDetail.inviteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4">
      <h2 className="mb-2 font-semibold">{t('groupDetail.inviteMember')}</h2>
      <p className="mb-2 text-xs text-slate-400">{t('groupDetail.inviteHint')}</p>
      <div className="flex gap-2">
        <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t('groupDetail.selectPerson')}</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
        <button className="btn-primary" disabled={busy || !selected} onClick={invite}>{busy ? t('common.sending') : t('groupDetail.sendInvite')}</button>
      </div>
      {msg && <p className="mt-2 text-sm text-slate-500">{msg}</p>}
    </div>
  );
}
