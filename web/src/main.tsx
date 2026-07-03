import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/index.css';
import { Layout } from './components/Layout';
import { useAuth } from './store/auth';
import { api } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { GroupsPage } from './pages/GroupsPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { FriendCardPage } from './pages/FriendCardPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { WishlistPage } from './pages/WishlistPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);

  // Restore the session on a fresh load: the token is persisted (localStorage)
  // but `user` is not, so without this the app would render with user === null
  // (no profile widget, no admin link) whenever you arrive with an existing
  // token instead of going through the login form.
  useEffect(() => {
    if (!token || user) return;
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // Token is stale/invalid — drop it and fall back to the login page.
        if (!cancelled) logout();
      });
    return () => {
      cancelled = true;
    };
  }, [token, user, setUser, logout]);

  if (!token) return <Navigate to="/login" replace />;
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  if (user?.role !== 'ADMIN') return <Navigate to="/directory" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:groupId" element={<GroupDetailPage />} />
          <Route path="/friends/:userId" element={<FriendCardPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/directory" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
