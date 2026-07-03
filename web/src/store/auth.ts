import { create } from 'zustand';
import { clearToken, getToken, setToken } from '../api/client';
import type { PublicUser } from '../types/domain';

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  initialized: boolean;
  setSession: (token: string, user: PublicUser) => void;
  setUser: (user: PublicUser) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: getToken(),
  user: null,
  initialized: false,

  setSession: (token, user) => {
    setToken(token);
    set({ token, user, initialized: true });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    clearToken();
    set({ token: null, user: null });
  },
}));
