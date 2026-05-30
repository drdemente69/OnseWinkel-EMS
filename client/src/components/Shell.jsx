import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { I } from './Icons.jsx';
import { useStore } from '../store.jsx';
import { api } from '../api.js';

export const useRoute = () => {
  const [hash, setHash] = useState(() => location.hash || '#/dashboard');
  useEffect(() => {
    const onHash = () => setHash(location.hash || '#/dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const parts = hash.replace(/^#\/?/, '').split('/');
  return {
    route: parts[0] || 'dashboard',
    param: parts[1],
    subparam: parts[2],
    extra: parts.slice(3).join('/'),
    go: (path) => { location.hash = path; },
  };
};

const userInitials = (u) => {
  if (!u) return '?';
  const src = u.name || u.username || '';
  const parts = src.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const Sidebar = ({ route, go }) => {
  const { employees, activeEmployees, user, signOut, pendingLeaveCount } = useStore();
  // Badge counts reflect what the rest of the app surfaces (active only) —
  // the Employees menu shows the full list internally.
  const docCount = activeEmployees.reduce((a, e) => a + (e.documents?.length || 0), 0);
  const psCount = activeEmployees.reduce((a, e) => a + (e.payslips?.length || 0), 0);
  const empCount = activeEmployees.length;

  const handleLogout = async () => {
    if (!confirm('Sign out of Onse Winkel EMS?')) return;
    await signOut();
  };

  const items = [
    { id: 'dashboard',  label: 'Dashboard',     icon: <I.Dashboard /> },
    { id: 'employees',  label: 'Employees',     icon: <I.Users />,    badge: empCount },
    { id: 'attendance', label: 'Attendance',    icon: <I.Calendar /> },
    { id: 'leave',      label: 'Leave Approval', icon: <I.CheckCircle />, badge: pendingLeaveCount || undefined },
    { id: 'payslips',   label: 'Payslips',      icon: <I.Receipt />,  badge: psCount },
    { id: 'documents',  label: 'Documents',     icon: <I.Folder />,   badge: docCount },
    { id: 'ocr',        label: 'Timesheet OCR', icon: <I.ScanText /> },
  ];
  const bottom = [{ id: 'settings', label: 'Settings', icon: <I.Settings /> }];

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-brand-logo"><img src="/static/logo.jpg" alt="Onse Winkel"/></div>
        <div className="sb-brand-text">
          <strong>Onse Winkel</strong>
          <span>Employee Management</span>
        </div>
      </div>
      <div className="sb-section">
        <div className="sb-section-label">Workspace</div>
        <nav className="sb-nav">
          {items.map(it => (
            <button key={it.id}
              className={`sb-nav-item ${route === it.id ? 'is-active' : ''}`}
              onClick={() => go(`#/${it.id}`)}>
              {it.icon}<span>{it.label}</span>
              {it.badge != null && <span className="badge-count num">{it.badge}</span>}
            </button>
          ))}
        </nav>
      </div>
      <div className="sb-section" style={{ marginTop: 'auto' }}>
        <nav className="sb-nav">
          {bottom.map(it => (
            <button key={it.id}
              className={`sb-nav-item ${route === it.id ? 'is-active' : ''}`}
              onClick={() => go(`#/${it.id}`)}>
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="sb-foot">
        <div className="sb-user-avatar">{userInitials(user)}</div>
        <div className="sb-user-info">
          <strong>{user?.name || user?.username || 'Signed in'}</strong>
          <span>{user?.role ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}` : ''}</span>
        </div>
        <button className="sb-user-btn" title="Sign out" onClick={handleLogout}><I.Logout size={14}/></button>
      </div>
    </aside>
  );
};

export const Topbar = ({ crumbs, onCommand, theme, setTheme, openTweaks }) => (
  <header className="topbar">
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep"><I.ChevronRight size={12}/></span>}
          {c.go ? (
            <a className="hover-link" onClick={() => c.go()} style={{ cursor: 'pointer' }}>{c.label}</a>
          ) : (
            <span className={i === crumbs.length - 1 ? 'current' : ''}>{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
    <div className="search">
      <I.Search />
      <input placeholder="Search employees, documents, payslips…" onFocus={onCommand} readOnly />
      <kbd>⌘K</kbd>
    </div>
    <div className="tb-actions">
      <button className="btn btn-ghost btn-icon" title="Notifications"><I.Bell /></button>
      <button className="btn btn-ghost btn-icon" title="Tweaks" onClick={openTweaks}><I.Sliders /></button>
      <button className="btn btn-ghost btn-icon"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <I.Sun /> : <I.Moon />}
      </button>
    </div>
  </header>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="page-header">
    <div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <div className="page-subtitle">{subtitle}</div>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
);

export const Modal = ({ open, onClose, title, children, wide, footer }) => {
  if (!open) return null;
  // Render via portal so the backdrop is a direct child of <body>, escaping
  // any ancestor that creates a containing block for `position: fixed`
  // (e.g. anything with a non-`none` transform/filter/contain).
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><I.X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export const CommandPalette = ({ open, onClose, go }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => {
    let alive = true;
    if (!open) return;
    if (!q) {
      const items = ['Dashboard','Employees','Attendance','Payslips','Documents','Settings']
        .map(p => ({ kind: 'Page', label: p, sub: 'Navigate', go: `#/${p.toLowerCase()}` }));
      setResults(items);
      return;
    }
    api.search(q).then(r => { if (alive) setResults(r); }).catch(() => setResults([]));
    return () => { alive = false; };
  }, [q, open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: '10vh' }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
          <I.Search size={16}/>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
                 placeholder="Search anything…"
                 style={{ flex:1, border:'none', background:'transparent', outline:'none', fontSize:14, color:'var(--text)' }}/>
          <kbd style={{ fontSize:10.5, padding:'2px 6px', background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-3)' }}>esc</kbd>
        </div>
        <div style={{ maxHeight:'50vh', overflow:'auto', padding:6 }}>
          {results.length === 0 && <div className="empty" style={{ padding:24 }}>No results for "{q}"</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => { go(r.go); onClose(); }}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', borderRadius:6,
                       border:'none', background:'transparent', cursor:'pointer', width:'100%', textAlign:'left', color:'var(--text)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span className="tag" style={{ minWidth:72, justifyContent:'center' }}>{r.kind}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.label}</div>
                <div style={{ fontSize:11.5, color:'var(--text-3)' }}>{r.sub}</div>
              </div>
              <I.ArrowRight size={14} color="var(--text-4)"/>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};
