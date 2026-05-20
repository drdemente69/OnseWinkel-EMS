import React, { useEffect, useMemo, useState } from 'react';
import { useRoute, Sidebar, Topbar, CommandPalette } from './components/Shell.jsx';
import { I } from './components/Icons.jsx';
import { StoreProvider, useStore } from './store.jsx';
import Dashboard from './screens/Dashboard.jsx';
import { EmployeesList, Profile } from './screens/Employees.jsx';
import AttendanceCalendar from './screens/Attendance.jsx';
import { PayslipsList, PayslipBuilder, PayslipView } from './screens/Payslips.jsx';
import DocumentsAll from './screens/Documents.jsx';
import OCRFlow from './screens/OCR.jsx';
import Settings from './screens/Settings.jsx';
import Login from './screens/Login.jsx';

function Crumbs({ route, param, employees }) {
  const crumbs = [{ label: 'Onse Winkel', go: () => { location.hash = '#/dashboard'; } }];
  if (route === 'dashboard') crumbs.push({ label: 'Dashboard' });
  else if (route === 'employees') {
    crumbs.push({ label: 'Employees', go: () => { location.hash = '#/employees'; } });
    if (param) {
      const e = employees.find(x => x.id === param);
      if (e) crumbs.push({ label: `${e.first_name} ${e.last_name}` });
    }
  }
  else if (route === 'attendance') crumbs.push({ label: 'Attendance' });
  else if (route === 'payslips') {
    crumbs.push({ label: 'Payslips', go: () => { location.hash = '#/payslips'; } });
    if (param === 'new') crumbs.push({ label: 'New' });
    if (param === 'view') crumbs.push({ label: 'View' });
  }
  else if (route === 'documents') crumbs.push({ label: 'Documents' });
  else if (route === 'ocr') crumbs.push({ label: 'Timesheet OCR' });
  else if (route === 'settings') crumbs.push({ label: 'Settings' });
  return crumbs;
}

function AppShell() {
  const { route, param, subparam, extra, go } = useRoute();
  const { employees, loading, authStatus, signIn, can } = useStore();

  const Forbidden = ({ message }) => (
    <div className="page">
      <div className="empty">
        <I.Lock size={28}/>
        <h4>Access restricted</h4>
        <p>{message}</p>
      </div>
    </div>
  );
  const [theme, setTheme] = useState(() => localStorage.getItem('ow-theme') || 'light');
  const [density, setDensity] = useState(() => localStorage.getItem('ow-density') || 'balanced');
  const [accent, setAccent] = useState(() => localStorage.getItem('ow-accent') || 'olive');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ow-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('ow-density', density);
  }, [density]);
  useEffect(() => {
    const map = {
      olive: 'oklch(68% 0.14 110)',
      brown: 'oklch(45% 0.10 55)',
      indigo: 'oklch(60% 0.16 270)',
      coral: 'oklch(68% 0.16 30)',
    };
    document.documentElement.style.setProperty('--accent', map[accent] || map.olive);
    localStorage.setItem('ow-accent', accent);
  }, [accent]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
      if (e.key === 'Escape') { setCmdOpen(false); setTweaksOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const crumbs = useMemo(() => Crumbs({ route, param, employees }), [route, param, employees]);

  if (authStatus === 'checking') {
    return <div style={{minHeight:'100vh', display:'grid', placeItems:'center', color:'var(--text-3)'}}>Loading…</div>;
  }
  if (authStatus !== 'signedIn') {
    return <Login onSignedIn={signIn}/>;
  }

  const renderScreen = () => {
    if (loading) return <div className="page"><div className="empty"><h4>Loading workspace…</h4></div></div>;

    if (route === 'dashboard') return <Dashboard go={go}/>;

    if (route === 'employees') {
      if (!param) return <EmployeesList go={go}/>;
      return <Profile employeeId={param} tab={subparam || 'overview'} go={go}/>;
    }
    if (route === 'attendance') return <AttendanceCalendar/>;
    if (route === 'payslips') {
      if (param === 'new') {
        if (!can('payslips:create')) return <Forbidden message="You don't have permission to generate payslips."/>;
        const hash = location.hash;
        const m = /employee=([^&]+)/.exec(hash);
        return <PayslipBuilder go={go} prefilledEmployeeId={m?.[1]}/>;
      }
      if (param === 'view') {
        const parts = location.hash.split('/');
        return <PayslipView employeeId={parts[3]} payslipId={parts[4]} go={go}/>;
      }
      return <PayslipsList go={go}/>;
    }
    if (route === 'documents') return <DocumentsAll go={go}/>;
    if (route === 'ocr') {
      if (!can('ocr:use')) return <Forbidden message="You don't have permission to use the timesheet OCR."/>;
      return <OCRFlow go={go}/>;
    }
    if (route === 'settings') return <Settings go={go}/>;
    return <Dashboard go={go}/>;
  };

  return (
    <div className="app">
      <Sidebar route={route} go={go}/>
      <div className="main">
        <Topbar crumbs={crumbs} onCommand={() => setCmdOpen(true)}
          theme={theme} setTheme={setTheme}
          openTweaks={() => setTweaksOpen(o => !o)}/>
        {renderScreen()}
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} go={go}/>
      {tweaksOpen && (
        <TweaksUI
          onClose={() => setTweaksOpen(false)}
          theme={theme} setTheme={setTheme}
          density={density} setDensity={setDensity}
          accent={accent} setAccent={setAccent}/>
      )}
    </div>
  );
}

const TweaksUI = ({ onClose, theme, setTheme, density, setDensity, accent, setAccent }) => (
  <div style={{
    position:'fixed', right:16, bottom:16, width:280,
    background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:12, padding:16, boxShadow:'var(--shadow-lg)', zIndex:90,
  }}>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
      <strong style={{fontSize:13.5}}>Tweaks</strong>
      <button className="btn btn-ghost btn-icon-sm" onClick={onClose}><I.X size={13}/></button>
    </div>
    <div className="col" style={{gap:14}}>
      <div>
        <div style={{fontSize:11.5, color:'var(--text-3)', marginBottom:6, fontWeight:500}}>Theme</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, background:'var(--surface-2)', padding:3, borderRadius:7}}>
          {['light','dark'].map(t => (
            <button key={t} onClick={() => setTheme(t)} style={{
              padding:'6px 8px', fontSize:12, borderRadius:5, border:'none',
              background: theme === t ? 'var(--surface)' : 'transparent',
              color: theme === t ? 'var(--text)' : 'var(--text-3)',
              fontWeight:500, cursor:'pointer', textTransform:'capitalize',
              boxShadow: theme === t ? 'var(--shadow-xs)' : 'none',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={{fontSize:11.5, color:'var(--text-3)', marginBottom:6, fontWeight:500}}>Density</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, background:'var(--surface-2)', padding:3, borderRadius:7}}>
          {['compact','balanced','spacious'].map(t => (
            <button key={t} onClick={() => setDensity(t)} style={{
              padding:'6px 6px', fontSize:11, borderRadius:5, border:'none',
              background: density === t ? 'var(--surface)' : 'transparent',
              color: density === t ? 'var(--text)' : 'var(--text-3)',
              fontWeight:500, cursor:'pointer', textTransform:'capitalize',
              boxShadow: density === t ? 'var(--shadow-xs)' : 'none',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={{fontSize:11.5, color:'var(--text-3)', marginBottom:6, fontWeight:500}}>Accent</div>
        <div style={{display:'flex', gap:8}}>
          {[
            {id:'olive', color:'oklch(68% 0.14 110)'},
            {id:'brown', color:'oklch(45% 0.10 55)'},
            {id:'indigo', color:'oklch(60% 0.16 270)'},
            {id:'coral', color:'oklch(68% 0.16 30)'},
          ].map(a => (
            <button key={a.id} onClick={() => setAccent(a.id)} title={a.id} style={{
              width:28, height:28, borderRadius:'50%', background:a.color,
              border: accent === a.id ? '2px solid var(--text)' : '2px solid transparent',
              cursor:'pointer', padding:0, outline:'1px solid var(--border)', outlineOffset:1,
            }}/>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default function App() {
  return (
    <StoreProvider>
      <AppShell/>
    </StoreProvider>
  );
}
