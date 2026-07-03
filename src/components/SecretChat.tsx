/**
 * Secret Celebration Chat for a friend card.
 *
 * Exclusion logic: the birthday person (card owner) must never see this
 * component. Callers are responsible for not rendering it when the current
 * user is the card owner; this component asserts that invariant too.
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { ID } from '../types';
import { formatDateTime } from '../utils/dates';

export function SecretChat({ friendCardUserId }: { friendCardUserId: ID }) {
  const { currentUser, users, getChatMessages, sendChatMessage } = useApp();
  const [draft, setDraft] = useState('');

  // Guard the exclusion invariant.
  if (currentUser.id === friendCardUserId) return null;

  const messages = getChatMessages(friendCardUserId);
  const nameOf = (id: ID) =>
    users.find((u) => u.id === id)?.fullName ?? 'Unknown';

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    sendChatMessage(friendCardUserId, draft);
    setDraft('');
  };

  return (
    <div className="secret-chat">
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="muted">No messages yet. Start planning!</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <div className="chat-message-head">
              <strong>{nameOf(m.authorId)}</strong>
              <span className="muted">{formatDateTime(m.createdAt)}</span>
            </div>
            <p>{m.text}</p>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={draft}
          placeholder="Type a planning message…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
