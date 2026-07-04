import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { NotificationBell } from './NotificationBell';
import { Avatar } from './Avatar';
import { ProfileWidget } from './ProfileWidget';

const navItems = [
  { to: '/directory', key: 'directory' },
  { to: '/friends', key: 'friends' },
  { to: '/groups', key: 'groups' },
  { to: '/subscriptions', key: 'subscriptions' },
  { to: '/wishlist', key: 'wishlist' },
];

export function Layout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <NavLink to="/directory" className="text-lg font-bold text-brand-700">
            🎂 BdayManager
          </NavLink>
          <nav className="ml-4 hidden gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-100 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {t(`nav.${item.key}`)}
              </NavLink>
            ))}
            {user?.role === 'ADMIN' && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-100 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {t('nav.admin')}
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            {user && (
              <button
                className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 hover:bg-slate-50"
                onClick={() => setProfileOpen(true)}
                aria-label={t('nav.openProfile')}
                title={t('nav.profileTitle')}
              >
                <Avatar name={user.fullName} url={user.avatarUrl} size={32} />
                <span className="hidden text-xs font-semibold text-emerald-700 sm:inline">
                  ${user.balance.toFixed(2)}
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium ${isActive ? 'bg-brand-100 text-brand-700' : 'text-slate-600'}`
              }
            >
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
          {user?.role === 'ADMIN' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium ${isActive ? 'bg-brand-100 text-brand-700' : 'text-slate-600'}`
              }
            >
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
      {profileOpen && <ProfileWidget onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
