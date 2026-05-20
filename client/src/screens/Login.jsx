import React, { useEffect, useRef, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { api, auth } from '../api.js';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const userRef = useRef(null);

  useEffect(() => { userRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!username || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    try {
      const { token, user } = await api.login(username, password);
      auth.token = token;
      onSignedIn(user);
    } catch (err) {
      setError(err.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight:'100vh', background:'var(--canvas)',
      display:'grid', placeItems:'center', padding:24,
    }}>
      <div style={{
        width:'100%', maxWidth:420,
        background:'var(--surface)', border:'1px solid var(--border)',
        borderRadius:16, padding:'36px 32px',
        boxShadow:'var(--shadow-lg)',
      }}>
        <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:24}}>
          <div style={{width:44, height:44, borderRadius:10, background:'#000', overflow:'hidden', flexShrink:0}}>
            <img src="/static/logo.jpg" alt="Onse Winkel" style={{width:'100%', height:'100%', objectFit:'cover'}}/>
          </div>
          <div>
            <div style={{fontSize:16, fontWeight:600, letterSpacing:'-0.01em'}}>Onse Winkel</div>
            <div style={{fontSize:12, color:'var(--text-3)'}}>Employee Management System</div>
          </div>
        </div>

        <h1 style={{margin:'0 0 4px', fontSize:22, fontWeight:600, letterSpacing:'-0.02em'}}>Sign in</h1>
        <p style={{margin:'0 0 22px', color:'var(--text-3)', fontSize:13.5}}>
          Enter your credentials to access the EMS.
        </p>

        <form onSubmit={submit} className="col" style={{gap:14}}>
          <div>
            <label className="label">Username</label>
            <input ref={userRef} className="input" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin"/>
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"/>
          </div>

          {error && (
            <div style={{
              padding:'10px 12px', borderRadius:8,
              background:'var(--danger-soft)', color:'var(--danger)',
              fontSize:12.5, display:'flex', alignItems:'center', gap:8,
            }}>
              <I.AlertCircle size={14}/> {error}
            </div>
          )}

          <button type="submit" className="btn btn-accent btn-lg" disabled={busy} style={{justifyContent:'center', marginTop:6}}>
            <I.Lock size={14}/> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{
          marginTop:22, padding:'12px 14px', borderRadius:10,
          background:'var(--surface-2)', border:'1px solid var(--border)',
          fontSize:12, color:'var(--text-3)', lineHeight:1.55,
        }}>
          <strong style={{color:'var(--text-2)', display:'block', marginBottom:2, fontSize:12}}>First-time use</strong>
          Default credentials are <code className="num">admin</code> / <code className="num">onsewinkel</code>.
          Change the password from Settings → Account after signing in.
        </div>
      </div>
    </div>
  );
}
