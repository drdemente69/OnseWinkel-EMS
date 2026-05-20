import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, auth, onUnauthorized } from './api';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('checking'); // checking | signedOut | signedIn
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({ company: null, payroll_rules: null, preferences: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Boot: if a token exists in localStorage, validate it via /auth/me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.token) { setAuthStatus('signedOut'); setLoading(false); return; }
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me);
        setAuthStatus('signedIn');
      } catch {
        if (cancelled) return;
        auth.clear();
        setAuthStatus('signedOut');
        setLoading(false);
      }
    })();
    const off = onUnauthorized(() => {
      setUser(null);
      setAuthStatus('signedOut');
      setLoading(false);
    });
    return () => { cancelled = true; off(); };
  }, []);

  const refresh = useCallback(async () => {
    if (authStatus !== 'signedIn') return;
    setError(null);
    try {
      const [emps, sets] = await Promise.all([api.listEmployees(), api.getSettings()]);
      setEmployees(emps);
      setSettings(sets);
      setLoading(false);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === 'signedIn') refresh();
  }, [authStatus, refresh]);

  const signIn = (u) => {
    setUser(u);
    setAuthStatus('signedIn');
    setLoading(true);
  };

  const signOut = async () => {
    try { await api.logout(); } catch {}
    auth.clear();
    setUser(null);
    setAuthStatus('signedOut');
    setEmployees([]);
    setSettings({ company: null, payroll_rules: null, preferences: null });
  };

  const isOwner = !!user?.is_owner;
  const can = (perm) => isOwner || user?.permissions?.[perm] === true;

  const value = {
    user, authStatus, signIn, signOut,
    isOwner, can,
    employees, settings, loading, error, refresh,
    setEmployees, setSettings,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
