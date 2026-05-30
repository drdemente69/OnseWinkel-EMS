import React, { useEffect, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader, Modal } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, fmtDate } from '../api.js';

export default function Settings({ go }) {
  const { settings, refresh, user, isOwner, can } = useStore();
  const [showReset, setShowReset] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const canEdit = can('settings:edit');
  const flash = (msg) => { setStatusMsg(msg); setTimeout(() => setStatusMsg(null), 3000); };

  const exportBackup = () => { window.location.href = '/api/backup/export'; flash('Backup downloaded.'); };
  const importBackup = (file) => {
    setImporting(true);
    api.importBackup(file)
      .then(async () => { await refresh(); flash('Backup restored.'); })
      .catch(e => alert('Import failed: ' + e.message))
      .finally(() => setImporting(false));
  };

  const SECTIONS = [
    { id: 0, label: 'Company' },
    { id: 1, label: 'Payroll rules' },
    { id: 6, label: 'Leave entitlements' },
    { id: 2, label: 'Data & backup' },
    { id: 3, label: 'Preferences' },
    { id: 4, label: 'Account' },
    ...(isOwner ? [{ id: 5, label: 'Users & access' }] : []),
  ];

  return (
    <div className="page fade-in">
      <PageHeader title="Settings" subtitle="Company info, data, preferences, and access"/>

      {statusMsg && (
        <div style={{padding:'10px 14px', background:'var(--success-soft)', color:'var(--success)', borderRadius:8, fontSize:13, marginBottom:14, display:'flex', alignItems:'center', gap:8}}>
          <I.CheckCircle size={14}/> {statusMsg}
        </div>
      )}

      <div className="grid" style={{gridTemplateColumns:'220px 1fr', gap:32, alignItems:'flex-start'}}>
        <nav style={{position:'sticky', top:80, display:'flex', flexDirection:'column', gap:2}}>
          {SECTIONS.map(s => (
            <a key={s.id} href={`#section-${s.id}`} style={{padding:'8px 12px', fontSize:13, color:'var(--text-2)', borderRadius:6, fontWeight:500}}>{s.label}</a>
          ))}
        </nav>

        <div className="col" style={{gap:16}}>
          <CompanyCard settings={settings} refresh={refresh} flash={flash} canEdit={canEdit}/>
          <PayrollRulesCard settings={settings} refresh={refresh} flash={flash} canEdit={canEdit}/>
          <LeaveEntitlementsCard settings={settings} refresh={refresh} flash={flash} canEdit={canEdit}/>
          <DataCard settings={settings} importing={importing} canEdit={canEdit}
            exportBackup={exportBackup} importBackup={importBackup}
            onSavedLocal={() => { refresh(); flash('Local backup saved.'); }}
            onReset={() => setShowReset(true)}/>
          <PreferencesCard settings={settings} refresh={refresh} flash={flash} canEdit={canEdit}/>
          <AccountCard user={user} flash={flash}/>
          {isOwner && <UsersCard flash={flash}/>}
        </div>
      </div>

      <Modal open={showReset} onClose={() => setShowReset(false)} title="Reset all data?"
        footer={
          <>
            <button className="btn" onClick={() => setShowReset(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={async () => {
              try {
                await fetch('/api/backup/import', {
                  method:'POST',
                  headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('ow-auth-token')}` },
                  body: JSON.stringify({ schemaVersion:1, settings, employees:[], attendance:[], documents:[], payslips:[] }),
                });
                await refresh();
                setShowReset(false);
                flash('All employee data cleared.');
              } catch (e) { alert(e.message); }
            }}><I.Trash/> Yes, reset</button>
          </>
        }>
        <p style={{margin:0, color:'var(--text-2)', lineHeight:1.5}}>
          This will permanently delete all employees, attendance, documents and payslips you've added.
          Settings, users and your login account stay intact.
        </p>
      </Modal>
    </div>
  );
}

// ===== Company =====
function CompanyCard({ settings, refresh, flash, canEdit }) {
  const original = settings?.company || {};
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings?.company || {}); }, [settings?.company]);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const save = async () => {
    setBusy(true);
    try { await api.saveSetting('company', form); await refresh(); flash('Company info saved.'); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div className="card" id="section-0">
      <div className="card-head"><h3>Company information</h3><span className="muted-2">Appears on every payslip</span></div>
      <div className="card-pad">
        <div className="grid grid-2" style={{gap:14}}>
          <EditField label="Company name" value={form.name} onChange={v => setF('name', v)} disabled={!canEdit}/>
          <EditField label="Email"        value={form.email} onChange={v => setF('email', v)} disabled={!canEdit}/>
          <EditField label="Address" wide value={form.address} onChange={v => setF('address', v)} disabled={!canEdit}/>
          <EditField label="Phone"        value={form.phone} onChange={v => setF('phone', v)} disabled={!canEdit}/>
          <EditField label="Payslip contact name" value={form.contact} onChange={v => setF('contact', v)} disabled={!canEdit}/>
          <EditField label="Payslip contact phone" value={form.contactPhone} onChange={v => setF('contactPhone', v)} disabled={!canEdit}/>
        </div>
        {canEdit && (
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            {dirty && <button className="btn btn-ghost" onClick={() => setForm(original)}>Cancel</button>}
            <button className="btn btn-accent" onClick={save} disabled={!dirty || busy}>
              <I.Save/> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Payroll rules =====
function PayrollRulesCard({ settings, refresh, flash, canEdit }) {
  const original = settings?.payroll_rules || {};
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings?.payroll_rules || {}); }, [settings?.payroll_rules]);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const save = async () => {
    setBusy(true);
    try {
      const clean = {
        ...form,
        overtimeMultiplier: Number(form.overtimeMultiplier) || 1.5,
        holidayMultiplier: Number(form.holidayMultiplier) || 2,
        sundayMultiplier: Number(form.sundayMultiplier) || 2,
        uifRate: Number(form.uifRate) || 0,
      };
      await api.saveSetting('payroll_rules', clean); await refresh(); flash('Payroll rules saved.');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div className="card" id="section-1">
      <div className="card-head"><h3>Payroll rules</h3><span className="muted-2">Applied to future calculations</span></div>
      <div className="card-pad">
        <div className="grid grid-2" style={{gap:16}}>
          <RuleStatic label="Pay cycle" value="21 → 20" note="21st of one month to 20th of the next"/>
          <RuleEdit label="Overtime multiplier" value={form.overtimeMultiplier} step="0.05" onChange={v => setF('overtimeMultiplier', v)} note="Mon–Sat hours past standard" disabled={!canEdit}/>
          <RuleEdit label="Holiday multiplier"  value={form.holidayMultiplier}  step="0.05" onChange={v => setF('holidayMultiplier', v)}  note="Public holidays" disabled={!canEdit}/>
          <RuleEdit label="Sunday multiplier"   value={form.sundayMultiplier}   step="0.05" onChange={v => setF('sundayMultiplier', v)}   note="Worked Sundays" disabled={!canEdit}/>
          <RuleEdit label="UIF rate (decimal)"  value={form.uifRate}            step="0.001" onChange={v => setF('uifRate', v)}            note="0.01 = 1% of gross" disabled={!canEdit}/>
          <RuleStatic label="Sick leave" value="Avg" note="Avg daily hours × hourly wage"/>
        </div>
        {canEdit && (
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            {dirty && <button className="btn btn-ghost" onClick={() => setForm(original)}>Cancel</button>}
            <button className="btn btn-accent" onClick={save} disabled={!dirty || busy}>
              <I.Save/> {busy ? 'Saving…' : 'Save rules'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Leave entitlements (owner-editable) =====
function LeaveEntitlementsCard({ settings, refresh, flash, canEdit }) {
  const defaults = {
    annual_days: 18, sick_days_per_year: 10, sick_cycle_years: 3,
    family_days: 3, parental_days: 10, maternity_months: 4,
    compassionate_days: 3, study_days: 0,
  };
  const original = { ...defaults, ...(settings?.leave_entitlements || {}) };
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm({ ...defaults, ...(settings?.leave_entitlements || {}) }); }, [settings?.leave_entitlements]);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const save = async () => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
      );
      await api.saveSetting('leave_entitlements', clean);
      await refresh();
      flash('Leave entitlements saved.');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const FIELDS = [
    { key: 'annual_days',          label: 'Annual leave',          unit: 'days / year',         note: 'BCEA § 20 minimum is 15. Onse Winkel default: 18.' },
    { key: 'sick_days_per_year',   label: 'Sick leave',            unit: 'days / year',         note: 'BCEA § 22: 30 days per 3-year cycle (10/year averaged).' },
    { key: 'sick_cycle_years',     label: 'Sick leave cycle',      unit: 'years',               note: 'Used to compute the rolling sick-leave window.' },
    { key: 'family_days',          label: 'Family responsibility', unit: 'days / year',         note: 'BCEA § 27.' },
    { key: 'parental_days',        label: 'Parental leave',        unit: 'days (unpaid · UIF)', note: 'BCEA § 25A. Unpaid by employer; employee claims UIF.' },
    { key: 'maternity_months',     label: 'Maternity leave',       unit: 'months (unpaid · UIF)', note: 'BCEA § 25. Unpaid by employer.' },
    { key: 'compassionate_days',   label: 'Compassionate',         unit: 'days / year',         note: 'Company policy.' },
    { key: 'study_days',           label: 'Study leave',           unit: 'days / year',         note: 'Discretionary. 0 = not offered.' },
  ];

  return (
    <div className="card" id="section-6">
      <div className="card-head">
        <h3>Leave entitlements</h3>
        <span className="muted-2">SA BCEA defaults — adjust to match your company policy</span>
      </div>
      <div className="card-pad">
        <div className="grid grid-2" style={{gap:16}}>
          {FIELDS.map(f => (
            <div key={f.key} style={{padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-2)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:4}}>
                <span style={{fontSize:12.5, color:'var(--text-2)', fontWeight:500}}>{f.label}</span>
                <div style={{display:'flex', alignItems:'center', gap:6}}>
                  <input className="input num" type="number" step="0.5" min="0"
                    disabled={!canEdit}
                    value={form[f.key] ?? 0}
                    onChange={e => setF(f.key, e.target.value)}
                    style={{width:80, height:30, fontSize:13, textAlign:'right'}}/>
                  <span style={{fontSize:11.5, color:'var(--text-3)', minWidth:120}}>{f.unit}</span>
                </div>
              </div>
              <div style={{fontSize:11.5, color:'var(--text-3)'}}>{f.note}</div>
            </div>
          ))}
        </div>
        {canEdit && (
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            {dirty && <button className="btn btn-ghost" onClick={() => setForm(original)}>Cancel</button>}
            <button className="btn btn-accent" onClick={save} disabled={!dirty || busy}>
              <I.Save/> {busy ? 'Saving…' : 'Save entitlements'}
            </button>
          </div>
        )}
        <div style={{marginTop:14, padding:12, background:'oklch(95% 0.04 240)', color:'oklch(35% 0.13 240)', borderRadius:8, fontSize:12.5, lineHeight:1.55, display:'flex', alignItems:'flex-start', gap:8}}>
          <I.AlertCircle size={14} style={{flexShrink:0, marginTop:2}}/>
          <span>These numbers drive the Leave Approval dashboard's per-employee balances. Lowering a number below what's already been used in the current cycle just means that employee shows 0 left — historical decisions stand.</span>
        </div>
      </div>
    </div>
  );
}

// ===== Data & backup =====
function DataCard({ settings, importing, canEdit, exportBackup, importBackup, onSavedLocal, onReset }) {
  return (
    <div className="card" id="section-2">
      <div className="card-head"><h3>Data & backup</h3></div>
      <div className="card-pad">
        <div style={{display:'flex', alignItems:'center', gap:14, padding:14, background:'var(--surface-2)', borderRadius:10, marginBottom:12}}>
          <div style={{width:36, height:36, borderRadius:8, background:'var(--success-soft)', color:'var(--success)', display:'grid', placeItems:'center'}}>
            <I.CheckCircle size={18}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13, fontWeight:600}}>Last backup</div>
            <div style={{fontSize:12, color:'var(--text-3)'}}>{settings?.preferences?.lastBackup ? new Date(settings.preferences.lastBackup).toLocaleString('en-ZA') : 'Never'}</div>
          </div>
        </div>

        <div className="grid grid-2" style={{gap:10}}>
          <DataAction icon={<I.Download/>} title="Export database" desc="Download a .json snapshot of all data" cta="Export now" onClick={exportBackup}/>
          {canEdit && <DataAction icon={<I.Upload/>} title="Restore from backup" desc="Replace current data with a .json file" cta={importing ? 'Restoring…' : 'Choose file…'} onClick={() => {
            const i = document.createElement('input');
            i.type = 'file'; i.accept = '.json';
            i.onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
            i.click();
          }}/>}
          {canEdit && <DataAction icon={<I.Database/>} title="Save local backup" desc="Stores .json in ~/OnseWinkel-EMS/data/backups" cta="Save now" onClick={async () => { await api.saveLocalBackup(); onSavedLocal?.(); }}/>}
          {canEdit && <DataAction icon={<I.Trash/>} title="Reset employee data" desc="Delete all employees, attendance, documents and payslips" cta="Reset…" danger onClick={onReset}/>}
        </div>
      </div>
    </div>
  );
}

// ===== Preferences =====
function PreferencesCard({ settings, refresh, flash, canEdit }) {
  const original = settings?.preferences || {};
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings?.preferences || {}); }, [settings?.preferences]);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const save = async () => {
    setBusy(true);
    try { await api.saveSetting('preferences', form); await refresh(); flash('Preferences saved.'); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div className="card" id="section-3">
      <div className="card-head"><h3>Preferences</h3></div>
      <div className="card-pad">
        <div className="grid grid-2" style={{gap:14}}>
          <div><label className="label">Currency</label><input className="input" disabled={!canEdit} value={form.currency || ''} onChange={e => setF('currency', e.target.value)}/></div>
          <div><label className="label">Date format</label><input className="input" disabled={!canEdit} value={form.dateFormat || ''} onChange={e => setF('dateFormat', e.target.value)}/></div>
          <div><label className="label">Time zone</label><input className="input" disabled={!canEdit} value={form.timezone || ''} onChange={e => setF('timezone', e.target.value)}/></div>
          <div><label className="label">Auto-backup</label>
            <select className="select" disabled={!canEdit} value={form.autoBackup ? 'on' : 'off'} onChange={e => setF('autoBackup', e.target.value === 'on')}>
              <option value="on">Enabled</option><option value="off">Disabled</option>
            </select>
          </div>
        </div>
        {canEdit && (
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            {dirty && <button className="btn btn-ghost" onClick={() => setForm(original)}>Cancel</button>}
            <button className="btn btn-accent" onClick={save} disabled={!dirty || busy}>
              <I.Save/> {busy ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Account (change own password) =====
function AccountCard({ user, flash }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!current) return setError('Enter your current password.');
    if (next.length < 6) return setError('New password must be at least 6 characters.');
    if (next !== confirm) return setError('New password and confirmation do not match.');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      flash('Password updated. Other sessions have been signed out.');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <div className="card" id="section-4">
      <div className="card-head">
        <h3>Account</h3>
        <span className="muted-2">Signed in as <strong style={{color:'var(--text)'}}>{user?.username}</strong>{user?.is_owner ? ' · Owner' : ''}</span>
      </div>
      <div className="card-pad">
        <form onSubmit={submit} className="grid grid-2" style={{gap:14}}>
          <div style={{gridColumn:'span 2'}}>
            <label className="label">Current password</label>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)}/>
          </div>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}/>
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/>
          </div>
          {error && (
            <div style={{gridColumn:'span 2', padding:'10px 12px', borderRadius:8, background:'var(--danger-soft)', color:'var(--danger)', fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
              <I.AlertCircle size={14}/> {error}
            </div>
          )}
          <div style={{gridColumn:'span 2', display:'flex', justifyContent:'flex-end'}}>
            <button type="submit" className="btn btn-accent" disabled={busy}>
              <I.Lock size={14}/> {busy ? 'Updating…' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== Users & access (owner only) =====
function UsersCard({ flash }) {
  const { user: me } = useStore();
  const [users, setUsers] = useState([]);
  const [perms, setPerms] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [permsTarget, setPermsTarget] = useState(null);

  const reload = () => Promise.all([api.listUsers(), api.permissionsCatalogue()]).then(([u, p]) => {
    setUsers(u); setPerms(p);
  });
  useEffect(() => { reload(); }, []);

  return (
    <div className="card" id="section-5">
      <div className="card-head">
        <h3>Users & access</h3>
        <button className="btn btn-accent btn-sm" onClick={() => setAddOpen(true)}><I.Plus size={13}/> Add user</button>
      </div>
      <div className="card-pad">
        <div style={{padding:12, background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-3)', marginBottom:14, display:'flex', alignItems:'flex-start', gap:8}}>
          <I.Lock size={13} style={{marginTop:2, flexShrink:0}}/>
          <span>
            Only the owner account can manage users. Creating accounts, resetting passwords, or deleting users
            requires the <strong>owner confirmation password</strong> (default <code className="num">usamabaig454</code>).
          </span>
        </div>
        <div className="card" style={{overflow:'hidden'}}>
          <table className="table">
            <thead>
              <tr><th>User</th><th>Username</th><th>Role</th><th>Last login</th><th className="right">Permissions</th><th className="actions"></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td className="num muted">{u.username}</td>
                  <td>
                    {u.is_owner
                      ? <span className="badge badge-accent">Owner</span>
                      : <span className="badge">Staff</span>}
                  </td>
                  <td className="muted">{u.last_login ? fmtDate(u.last_login, { day:'2-digit', month:'short', year:'numeric' }) : 'Never'}</td>
                  <td className="right num muted">
                    {u.is_owner ? 'All' : Object.values(u.permissions || {}).filter(Boolean).length + ' / ' + perms.length}
                  </td>
                  <td className="actions">
                    {!u.is_owner && (
                      <>
                        <button className="btn btn-ghost btn-icon-sm" title="Edit permissions" onClick={() => setPermsTarget(u)}><I.Sliders size={13}/></button>
                        <button className="btn btn-ghost btn-icon-sm" title="Reset password" onClick={() => setResetTarget(u)}><I.RefreshCw size={13}/></button>
                        {u.id !== me?.id && <button className="btn btn-ghost btn-icon-sm" title="Delete user" onClick={() => setDeleteTarget(u)}><I.Trash size={13}/></button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && <AddUserModal perms={perms} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); reload(); flash('User created.'); }}/>}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} onDone={() => { setResetTarget(null); reload(); flash(`Password for ${resetTarget.username} reset.`); }}/>}
      {deleteTarget && <DeleteUserModal user={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={() => { setDeleteTarget(null); reload(); flash('User deleted.'); }}/>}
      {permsTarget && <PermissionsModal user={permsTarget} perms={perms} onClose={() => setPermsTarget(null)} onSaved={() => { setPermsTarget(null); reload(); flash('Permissions updated.'); }}/>}
    </div>
  );
}

function AddUserModal({ perms, onClose, onCreated }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [permState, setPermState] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (id) => setPermState(s => ({ ...s, [id]: !s[id] }));

  const submit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    setBusy(true);
    try {
      await api.createUser({ username, name, password, ownerPassword, permissions: permState });
      onCreated?.();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} wide title="Add user"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy}><I.Plus size={13}/> {busy ? 'Creating…' : 'Create user'}</button>
        </>
      }>
      <form onSubmit={submit} className="col" style={{gap:14}}>
        <div className="grid grid-2" style={{gap:14}}>
          <div>
            <label className="label">Username</label>
            <input className="input" autoFocus value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. jane"/>
          </div>
          <div>
            <label className="label">Full name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe"/>
          </div>
          <div>
            <label className="label">Initial password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters"/>
          </div>
          <div>
            <label className="label">Owner confirmation password</label>
            <input className="input" type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} placeholder="••••••••"/>
          </div>
        </div>

        <PermissionGrid perms={perms} value={permState} onToggle={toggle}/>

        {error && (
          <div style={{padding:'10px 12px', borderRadius:8, background:'var(--danger-soft)', color:'var(--danger)', fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
            <I.AlertCircle size={14}/> {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (newPassword.length < 6) return setError('New password must be at least 6 characters.');
    if (newPassword !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try { await api.resetUserPassword(user.id, newPassword, ownerPassword); onDone?.(); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`Reset password for ${user.name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy}><I.Lock size={13}/> {busy ? 'Resetting…' : 'Reset password'}</button>
        </>
      }>
      <form onSubmit={submit} className="col" style={{gap:14}}>
        <p style={{margin:0, color:'var(--text-3)', fontSize:13, lineHeight:1.5}}>
          Sets a new password for <strong style={{color:'var(--text)'}}>{user.username}</strong>. All of their existing sessions will be signed out.
        </p>
        <div>
          <label className="label">New password</label>
          <input className="input" type="password" autoFocus value={newPassword} onChange={e => setNewPassword(e.target.value)}/>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}/>
        </div>
        <div>
          <label className="label">Owner confirmation password</label>
          <input className="input" type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}/>
        </div>
        {error && (
          <div style={{padding:'10px 12px', borderRadius:8, background:'var(--danger-soft)', color:'var(--danger)', fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
            <I.AlertCircle size={14}/> {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

function DeleteUserModal({ user, onClose, onDone }) {
  const [ownerPassword, setOwnerPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null); setBusy(true);
    try { await api.deleteUser(user.id, ownerPassword); onDone?.(); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`Delete ${user.name}?`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy}><I.Trash/> {busy ? 'Deleting…' : 'Delete user'}</button>
        </>
      }>
      <div className="col" style={{gap:14}}>
        <p style={{margin:0, color:'var(--text-2)', lineHeight:1.5}}>
          This removes <strong>{user.username}</strong> and ends all of their sessions. Their actions stay in the audit log.
        </p>
        <div>
          <label className="label">Owner confirmation password</label>
          <input className="input" type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} autoFocus/>
        </div>
        {error && (
          <div style={{padding:'10px 12px', borderRadius:8, background:'var(--danger-soft)', color:'var(--danger)', fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
            <I.AlertCircle size={14}/> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PermissionsModal({ user, perms, onClose, onSaved }) {
  const [name, setName] = useState(user.name || '');
  const [state, setState] = useState(user.permissions || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (id) => setState(s => ({ ...s, [id]: !s[id] }));
  const save = async () => {
    setError(null); setBusy(true);
    try { await api.updateUser(user.id, { name, permissions: state }); onSaved?.(); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} wide title={`Access for ${user.username}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={save} disabled={busy}><I.Save/> {busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }>
      <div className="col" style={{gap:14}}>
        <div>
          <label className="label">Display name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <PermissionGrid perms={perms} value={state} onToggle={toggle}/>
        {error && (
          <div style={{padding:'10px 12px', borderRadius:8, background:'var(--danger-soft)', color:'var(--danger)', fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
            <I.AlertCircle size={14}/> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PermissionGrid({ perms, value, onToggle }) {
  const grouped = perms.reduce((acc, p) => {
    (acc[p.group] = acc[p.group] || []).push(p);
    return acc;
  }, {});
  return (
    <div>
      <div style={{fontSize:11.5, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:500, marginBottom:8}}>Permissions</div>
      <div className="grid grid-2" style={{gap:10}}>
        {Object.entries(grouped).map(([group, list]) => (
          <div key={group} style={{padding:12, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface-2)'}}>
            <div style={{fontSize:12, fontWeight:600, marginBottom:8, color:'var(--text-2)'}}>{group}</div>
            <div className="col" style={{gap:6}}>
              {list.map(p => (
                <label key={p.id} style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13}}>
                  <input type="checkbox" checked={!!value[p.id]} onChange={() => onToggle(p.id)}/>
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Small helpers =====
const EditField = ({ label, value, onChange, wide, disabled }) => (
  <div style={wide ? { gridColumn:'span 2' } : {}}>
    <label className="label">{label}</label>
    <input className="input" disabled={disabled} value={value || ''} onChange={e => onChange(e.target.value)}/>
  </div>
);
const RuleStatic = ({ label, value, note }) => (
  <div style={{padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-2)'}}>
    <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
      <span style={{fontSize:12.5, color:'var(--text-2)', fontWeight:500}}>{label}</span>
      <strong className="num" style={{fontSize:13.5}}>{value}</strong>
    </div>
    <div style={{fontSize:11.5, color:'var(--text-3)'}}>{note}</div>
  </div>
);
const RuleEdit = ({ label, value, step, onChange, note, disabled }) => (
  <div style={{padding:12, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)'}}>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:4}}>
      <span style={{fontSize:12.5, color:'var(--text-2)', fontWeight:500}}>{label}</span>
      <input className="input num" type="number" step={step || '0.01'} value={value ?? ''} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        style={{width:90, height:30, fontSize:13, textAlign:'right'}}/>
    </div>
    <div style={{fontSize:11.5, color:'var(--text-3)'}}>{note}</div>
  </div>
);
const DataAction = ({ icon, title, desc, cta, onClick, danger }) => (
  <div style={{padding:14, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface)'}}>
    <div style={{display:'flex', gap:10, marginBottom:10}}>
      <span style={{width:30, height:30, borderRadius:7, background: danger ? 'var(--danger-soft)' : 'var(--surface-3)', color: danger ? 'var(--danger)' : 'var(--text-2)', display:'grid', placeItems:'center'}}>{icon}</span>
      <div>
        <div style={{fontSize:13, fontWeight:600}}>{title}</div>
        <div style={{fontSize:11.5, color:'var(--text-3)', marginTop:2}}>{desc}</div>
      </div>
    </div>
    <button className={`btn btn-sm ${danger ? 'btn-danger' : ''}`} onClick={onClick}>{cta}</button>
  </div>
);
