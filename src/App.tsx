/**
 * App shell: top navigation, notifications, and view switching.
 *
 * Uses a simple in-memory view state instead of a router to stay barebones.
 * Swap `useState<View>` for react-router when the app grows.
 */

import { useState } from 'react';
import './App.css';
import { NotificationsPanel } from './components/NotificationsPanel';
import { useApp } from './context/AppContext';
import type { View } from './navigation';
import { DirectoryPage } from './pages/DirectoryPage';
import { FriendCardPage } from './pages/FriendCardPage';
import { GroupsPage } from './pages/GroupsPage';

function App() {
  const [view, setView] = useState<View>({ name: 'directory' });
  const [showNotifications, setShowNotifications] = useState(false);
  const { currentUser, notifications } = useApp();

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎉 BirthdayHub</div>
        <nav className="nav">
          <button
            type="button"
            className={view.name === 'directory' ? 'active' : ''}
            onClick={() => setView({ name: 'directory' })}
          >
            Directory
          </button>
          <button
            type="button"
            className={view.name === 'groups' ? 'active' : ''}
            onClick={() => setView({ name: 'groups' })}
          >
            Groups
          </button>
        </nav>
        <div className="topbar-right">
          <button
            type="button"
            className="bell"
            onClick={() => setShowNotifications((s) => !s)}
          >
            🔔{unread > 0 && <span className="badge-count">{unread}</span>}
          </button>
          <span className="current-user">{currentUser.fullName}</span>
        </div>
      </header>

      {showNotifications && (
        <NotificationsPanel onClose={() => setShowNotifications(false)} />
      )}

      <main className="content">
        {view.name === 'directory' && <DirectoryPage navigate={setView} />}
        {view.name === 'groups' && <GroupsPage navigate={setView} />}
        {view.name === 'friend' && (
          <div>
            <button
              type="button"
              className="back-btn"
              onClick={() => setView({ name: 'directory' })}
            >
              ← Back
            </button>
            <FriendCardPage userId={view.userId} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
