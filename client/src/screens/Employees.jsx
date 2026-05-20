import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader, Modal } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, ZAR, initials, fmtDate, NUM, fmtBytes } from '../api.js';
import AttendanceCalendar from './Attendance.jsx';

export function EmployeesList({ go }) {
  const { employees, refresh, can } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);

  const list = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return employees.filter(e => {
      if (filter === 'active' && e.status !== 'active') return false;
      if (filter === 'inactive' && e.status === 'active') return false;
      if (!ql) return true;
      return `${e.first_name} ${e.last_name}`.toLowerCase().includes(ql)
        || (e.position || '').toLowerCase().includes(ql)
        || (e.email || '').toLowerCase().includes(ql);
    });
  }, [employees, q, filter]);

  const exportCSV = () => {
    const cols = ['employee_no','first_name','last_name','position','department','email','phone','date_employed','hourly_wage','status'];
    const rows = [cols.join(',')].concat(employees.map(e => cols.map(c => JSON.stringify(e[c] ?? '')).join(',')));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `employees-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page fade-in">
      <PageHeader title="Employees"
        subtitle={`${employees.length} total · ${employees.filter(e => e.status === 'active').length} active`}
        actions={
          <>
            <button className="btn" onClick={exportCSV}><I.Download/> Export CSV</button>
            {can('employees:create') && <button className="btn btn-accent" onClick={() => setNewOpen(true)}><I.Plus/> Add employee</button>}
          </>
        }/>

      <div style={{display:'flex', gap:8, marginBottom:16}}>
        <div className="search" style={{margin:0, maxWidth:320}}>
          <I.Search/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, role, email…"/>
        </div>
        <div style={{display:'flex', gap:2, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:3}}>
          {['all','active','inactive'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer',
              background: filter === f ? 'var(--surface-3)' : 'transparent',
              color: filter === f ? 'var(--text)' : 'var(--text-3)',
              fontSize:12.5, fontWeight:500, textTransform:'capitalize',
            }}>{f}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="table">
          <thead>
            <tr>
              <th style={{width:'30%'}}>Employee</th>
              <th>Position</th>
              <th>Contact</th>
              <th>Hire date</th>
              <th className="right">Rate</th>
              <th className="right">YTD gross</th>
              <th>Status</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {list.map(e => {
              const ytd = (e.initial_ytd || 0) + (e.payslips || []).reduce((a, p) => a + (p.gross || 0), 0);
              return (
                <tr key={e.id} onClick={() => go(`#/employees/${e.id}`)}>
                  <td>
                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                      <span className="avatar">{initials(e.first_name, e.last_name)}</span>
                      <div style={{lineHeight:1.25}}>
                        <div style={{fontWeight:500}}>{e.first_name} {e.last_name}</div>
                        <div style={{fontSize:11.5, color:'var(--text-3)', fontFamily:'var(--font-mono)'}}>#{e.employee_no}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{fontWeight:500}}>{e.position}</div>
                    <div style={{fontSize:11.5, color:'var(--text-3)'}}>{e.department}</div>
                  </td>
                  <td>
                    <div style={{fontSize:12.5}}>{e.email}</div>
                    <div style={{fontSize:11.5, color:'var(--text-3)'}}>{e.phone}</div>
                  </td>
                  <td><span className="muted">{fmtDate(e.date_employed)}</span></td>
                  <td className="right num">R{Number(e.hourly_wage).toFixed(2)}<span className="muted-2" style={{marginLeft:2, fontSize:11}}>/h</span></td>
                  <td className="right num">{ZAR(ytd)}</td>
                  <td>
                    <span className={`badge dot ${e.status === 'active' ? 'badge-success' : ''}`}>
                      {e.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-icon-sm" onClick={ev => ev.stopPropagation()}><I.More/></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EmployeeFormModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); refresh(); }}/>
    </div>
  );
}

function EmployeeFormModal({ open, onClose, onSaved, employee }) {
  const [form, setForm] = useState(() => ({
    employee_no: '',
    first_name: '',
    last_name: '',
    position: '',
    department: '',
    email: '',
    phone: '',
    address: '',
    date_employed: new Date().toISOString().slice(0,10),
    hourly_wage: 30,
    initial_ytd: 0,
    status: 'active',
    payment_method: 'EFT',
    bank: '',
    bank_account: '',
    id_number: '',
    tax_code: '',
    ...(employee || {}),
  }));
  const [busy, setBusy] = useState(false);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      if (employee?.id) await api.updateEmployee(employee.id, form);
      else await api.createEmployee(form);
      onSaved?.();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} wide
      title={employee ? `Edit ${employee.first_name}` : 'Add employee'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={save} disabled={busy}>
            <I.Save/> {busy ? 'Saving…' : (employee ? 'Save changes' : 'Create employee')}
          </button>
        </>
      }>
      <div className="grid grid-2" style={{gap:14}}>
        <div><label className="label">First name</label><input className="input" value={form.first_name} onChange={e=>setF('first_name', e.target.value)}/></div>
        <div><label className="label">Last name</label><input className="input" value={form.last_name} onChange={e=>setF('last_name', e.target.value)}/></div>
        <div><label className="label">Employee #</label><input className="input" value={form.employee_no} onChange={e=>setF('employee_no', e.target.value)}/></div>
        <div><label className="label">Status</label>
          <select className="select" value={form.status} onChange={e=>setF('status', e.target.value)}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
          </select>
        </div>
        <div><label className="label">Position</label><input className="input" value={form.position} onChange={e=>setF('position', e.target.value)}/></div>
        <div><label className="label">Department</label><input className="input" value={form.department} onChange={e=>setF('department', e.target.value)}/></div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={e=>setF('email', e.target.value)}/></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e=>setF('phone', e.target.value)}/></div>
        <div style={{gridColumn:'span 2'}}><label className="label">Address</label><input className="input" value={form.address} onChange={e=>setF('address', e.target.value)}/></div>
        <div><label className="label">Date employed</label><input className="input" type="date" value={form.date_employed} onChange={e=>setF('date_employed', e.target.value)}/></div>
        <div><label className="label">Hourly wage (R)</label><input className="input num" type="number" step="0.01" value={form.hourly_wage} onChange={e=>setF('hourly_wage', Number(e.target.value))}/></div>
        <div><label className="label">Initial YTD (R)</label><input className="input num" type="number" step="0.01" value={form.initial_ytd} onChange={e=>setF('initial_ytd', Number(e.target.value))}/></div>
        <div><label className="label">Payment method</label>
          <select className="select" value={form.payment_method} onChange={e=>setF('payment_method', e.target.value)}>
            <option value="EFT">EFT</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option>
          </select>
        </div>
        <div><label className="label">Bank</label><input className="input" value={form.bank} onChange={e=>setF('bank', e.target.value)}/></div>
        <div><label className="label">Account number</label><input className="input" value={form.bank_account} onChange={e=>setF('bank_account', e.target.value)}/></div>
        <div><label className="label">ID number</label><input className="input" value={form.id_number} onChange={e=>setF('id_number', e.target.value)}/></div>
        <div><label className="label">Tax code</label><input className="input" value={form.tax_code} onChange={e=>setF('tax_code', e.target.value)}/></div>
      </div>
    </Modal>
  );
}

export function Profile({ employeeId, tab = 'overview', go }) {
  const [employee, setEmployee] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const { refresh, can } = useStore();
  const reloadEmployee = async () => setEmployee(await api.getEmployee(employeeId));

  useEffect(() => { reloadEmployee().catch(() => setEmployee(false)); }, [employeeId]);

  if (employee === null) return <div className="page"><div className="empty"><h4>Loading…</h4></div></div>;
  if (employee === false) return (
    <div className="page">
      <div className="empty">
        <I.AlertCircle size={32}/>
        <h4>Employee not found</h4>
        <p>This profile may have been archived or deleted.</p>
        <button className="btn" onClick={() => go('#/employees')}>Back to employees</button>
      </div>
    </div>
  );

  const ytd = (employee.initial_ytd || 0) + (employee.payslips || []).reduce((a, p) => a + (p.gross || 0), 0);
  const tenure = (() => {
    const d = new Date(employee.date_employed);
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 12) return `${months} months`;
    return `${(months / 12).toFixed(1)} years`;
  })();

  const tabs = [
    { id: 'overview',    label: 'Overview' },
    { id: 'attendance',  label: 'Attendance' },
    { id: 'payslips',    label: 'Payslips',    count: employee.payslips.length },
    { id: 'documents',   label: 'Documents',   count: employee.documents.length },
  ];

  return (
    <div className="page fade-in">
      <div className="card" style={{padding:24, marginBottom:24}}>
        <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
          <div className="avatar avatar-xl" style={{background:'var(--brand-brown)', color:'white'}}>{initials(employee.first_name, employee.last_name)}</div>
          <div style={{flex:1}}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:4}}>
              <h1 style={{margin:0, fontSize:24, fontWeight:600, letterSpacing:'-0.02em'}}>{employee.first_name} {employee.last_name}</h1>
              <span className={`badge dot ${employee.status === 'active' ? 'badge-success' : ''}`}>
                {employee.status === 'active' ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div style={{color:'var(--text-2)', fontSize:13.5, marginBottom:12}}>{employee.position} · {employee.department}</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:14, color:'var(--text-3)', fontSize:12.5}}>
              <span style={{display:'flex', alignItems:'center', gap:5}}><I.Mail size={13}/> {employee.email}</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><I.Phone size={13}/> {employee.phone}</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><I.MapPin size={13}/> {employee.address}</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><I.Briefcase size={13}/> #{employee.employee_no}</span>
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            {can('employees:edit') && <button className="btn" onClick={() => setEditOpen(true)}><I.Edit/> Edit</button>}
            {can('payslips:create') && <button className="btn btn-accent" onClick={() => go(`#/payslips/new?employee=${employee.id}`)}><I.Receipt/> New payslip</button>}
          </div>
        </div>

        <div className="grid grid-4" style={{marginTop:24, gap:0, borderTop:'1px solid var(--border)', paddingTop:20}}>
          <ProfileStat label="Hourly wage" value={`R${Number(employee.hourly_wage).toFixed(2)}`} suffix="/ hour"/>
          <ProfileStat label="YTD gross"   value={ZAR(ytd)} suffix="2025/26"/>
          <ProfileStat label="Tenure"      value={tenure} suffix={`since ${fmtDate(employee.date_employed, { year:'numeric', month:'short' })}`}/>
          <ProfileStat label="Latest payslip" value={fmtDate(employee.payslips[0]?.pay_date)} suffix={employee.payslips[0]?.period_label}/>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id}
            className={`tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => go(`#/employees/${employee.id}${t.id === 'overview' ? '' : '/' + t.id}`)}>
            {t.label} {t.count != null && <span className="muted" style={{marginLeft:4, fontFamily:'var(--font-mono)'}}>{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview'   && <ProfileOverview employee={employee} go={go} onChanged={() => { reloadEmployee(); refresh(); }}/>}
      {tab === 'attendance' && <AttendanceCalendar employee={employee} embedded onChange={reloadEmployee}/>}
      {tab === 'payslips'   && <ProfilePayslips employee={employee} go={go} onChanged={reloadEmployee}/>}
      {tab === 'documents'  && <ProfileDocuments employee={employee} onChanged={reloadEmployee}/>}

      <EmployeeFormModal open={editOpen} onClose={() => setEditOpen(false)} employee={employee} onSaved={() => { setEditOpen(false); reloadEmployee(); refresh(); }}/>
    </div>
  );
}

const ProfileStat = ({ label, value, suffix }) => (
  <div style={{padding:'0 24px', borderRight:'1px solid var(--border)'}}>
    <div style={{fontSize:11.5, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:500, marginBottom:4}}>{label}</div>
    <div className="num" style={{fontSize:18, fontWeight:600, letterSpacing:'-0.02em'}}>{value}</div>
    {suffix && <div style={{fontSize:11.5, color:'var(--text-3)', marginTop:2}}>{suffix}</div>}
  </div>
);

function ProfileOverview({ employee, go, onChanged }) {
  const { can } = useStore();
  const latest = employee.payslips[0];
  return (
    <div className="grid" style={{gridTemplateColumns:'2fr 1fr', gap:16}}>
      <div className="col" style={{gap:16}}>
        <div className="card">
          <div className="card-head"><h3>Personal information</h3></div>
          <div className="card-pad">
            <div className="grid grid-2">
              <InfoRow label="Full name" value={`${employee.first_name} ${employee.last_name}`}/>
              <InfoRow label="Employee ID" value={`#${employee.employee_no}`} mono/>
              <HireDateRow employee={employee} canEdit={can('employees:edit')} onSaved={onChanged}/>
              <InfoRow label="Status" value={employee.status === 'active' ? 'Active' : 'Inactive'}/>
              <InfoRow label="Email" value={employee.email}/>
              <InfoRow label="Phone" value={employee.phone}/>
              <InfoRow label="Address" value={employee.address}/>
              <InfoRow label="Position" value={employee.position}/>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Payroll details</h3></div>
          <div className="card-pad">
            <div className="grid grid-2">
              <InfoRow label="Hourly wage"     value={`R${Number(employee.hourly_wage).toFixed(2)} / hour`} mono/>
              <InfoRow label="Payment method"  value={employee.payment_method}/>
              <InfoRow label="Bank"            value={employee.bank}/>
              <InfoRow label="Account number"  value={employee.bank_account} mono/>
              <InfoRow label="ID / Tax number" value={employee.id_number} mono/>
              <InfoRow label="Tax code"        value={employee.tax_code} mono/>
              <InfoRow label="Initial YTD"     value={ZAR(employee.initial_ytd)} mono/>
              <InfoRow label="Current YTD"     value={ZAR((employee.initial_ytd || 0) + employee.payslips.reduce((a, p) => a + p.gross, 0))} mono/>
            </div>
          </div>
        </div>
      </div>

      <div className="col" style={{gap:16}}>
        <div className="card">
          <div className="card-head">
            <h3>Latest payslip</h3>
            {latest && <button className="btn btn-ghost btn-sm" onClick={() => go(`#/employees/${employee.id}/payslips`)}>All →</button>}
          </div>
          {latest ? (
            <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:10}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                <div>
                  <div style={{fontSize:13, fontWeight:500}}>{latest.period_label}</div>
                  <div style={{fontSize:11.5, color:'var(--text-3)'}}>Paid {fmtDate(latest.pay_date)}</div>
                </div>
                <span className="badge badge-success"><I.CheckCircle size={11}/> Paid</span>
              </div>
              <hr className="divider" style={{margin:'4px 0'}}/>
              <PsLine label="Standard pay" value={latest.normal_pay}/>
              <PsLine label="Overtime pay" value={latest.overtime_pay}/>
              <PsLine label="Sunday & worked holiday" value={latest.holiday_pay}/>
              {Number(latest.public_holiday_pay) > 0 && <PsLine label="Public holiday pay" value={latest.public_holiday_pay}/>}
              {latest.commission > 0 && <PsLine label="Commission" value={latest.commission}/>}
              {latest.bonus > 0 && <PsLine label="Bonus" value={latest.bonus}/>}
              <hr className="divider" style={{margin:'4px 0'}}/>
              <PsLine label="Gross pay" value={latest.gross} bold/>
              <PsLine label="UIF (1%)" value={-latest.uif} muted/>
              <hr className="divider" style={{margin:'4px 0'}}/>
              <PsLine label="Net pay" value={latest.net} accent/>
              <button className="btn" style={{marginTop:8}} onClick={() => go(`#/payslips/view/${employee.id}/${latest.id}`)}><I.Eye size={13}/> View payslip</button>
            </div>
          ) : <div className="empty"><p>No payslips yet</p></div>}
        </div>
      </div>
    </div>
  );
}

const InfoRow = ({ label, value, mono }) => (
  <div style={{padding:'6px 0'}}>
    <div style={{fontSize:11.5, color:'var(--text-3)', marginBottom:2}}>{label}</div>
    <div className={mono ? 'num' : ''} style={{fontSize:13, fontWeight:500}}>{value || '–'}</div>
  </div>
);

// Inline-editable hire date — click the pencil to change, ✓ to save.
function HireDateRow({ employee, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(employee.date_employed || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(employee.date_employed || ''); }, [employee.date_employed]);

  const save = async () => {
    if (!value || value === employee.date_employed) { setEditing(false); return; }
    setBusy(true);
    try {
      await api.updateEmployee(employee.id, { date_employed: value });
      onSaved?.();
      setEditing(false);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div style={{padding:'6px 0'}}>
      <div style={{fontSize:11.5, color:'var(--text-3)', marginBottom:2}}>Date of employment</div>
      {!editing ? (
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span style={{fontSize:13, fontWeight:500}}>{fmtDate(employee.date_employed) || '–'}</span>
          {canEdit && (
            <button className="btn btn-ghost btn-icon-sm"
              title="Change hire date"
              onClick={() => setEditing(true)}>
              <I.Edit size={11}/>
            </button>
          )}
        </div>
      ) : (
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <input className="input" type="date" autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(employee.date_employed); setEditing(false); } }}
            style={{height:30, fontSize:12.5, padding:'0 8px', maxWidth:170}}/>
          <button className="btn btn-accent btn-icon-sm" onClick={save} disabled={busy} title="Save">
            <I.Check size={12}/>
          </button>
          <button className="btn btn-ghost btn-icon-sm" onClick={() => { setValue(employee.date_employed); setEditing(false); }} title="Cancel">
            <I.X size={12}/>
          </button>
        </div>
      )}
    </div>
  );
}

export const PsLine = ({ label, value, bold, muted, accent }) => (
  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
    <span style={{fontSize:12.5, color: muted ? 'var(--text-3)' : 'var(--text-2)', fontWeight: bold ? 600 : 400}}>{label}</span>
    <span className="num" style={{
      fontSize: accent ? 15 : 13,
      fontWeight: bold || accent ? 600 : 500,
      color: accent ? 'var(--accent-fg)' : (muted ? 'var(--text-3)' : 'var(--text)'),
    }}>{ZAR(value)}</span>
  </div>
);

function ProfilePayslips({ employee, go, onChanged }) {
  const { can } = useStore();
  const remove = async (e, p) => {
    e.stopPropagation();
    if (!confirm(`Delete payslip ${p.period_label}? This cannot be undone.`)) return;
    try { await api.deletePayslip(p.id); onChanged?.(); }
    catch (err) { alert(err.message); }
  };
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <table className="table">
        <thead>
          <tr><th>Period</th><th>Pay date</th>
            <th className="right">Normal</th><th className="right">OT</th>
            <th className="right">Worked hol.</th><th className="right">Public hol.</th>
            <th className="right">Gross</th><th className="right">UIF</th><th className="right">Net</th>
            <th className="actions"></th></tr>
        </thead>
        <tbody>
          {employee.payslips.map(p => (
            <tr key={p.id} onClick={() => go(`#/payslips/view/${employee.id}/${p.id}`)}>
              <td><strong>{p.period_label}</strong></td>
              <td className="muted">{fmtDate(p.pay_date)}</td>
              <td className="right num">{ZAR(p.normal_pay)}</td>
              <td className="right num">{ZAR(p.overtime_pay)}</td>
              <td className="right num">{ZAR(p.holiday_pay)}</td>
              <td className="right num">{ZAR(p.public_holiday_pay)}</td>
              <td className="right num"><strong>{ZAR(p.gross)}</strong></td>
              <td className="right num muted">{ZAR(p.uif)}</td>
              <td className="right num" style={{color:'var(--accent-fg)', fontWeight:600}}>{ZAR(p.net)}</td>
              <td className="actions">
                <button className="btn btn-ghost btn-icon-sm" title="View" onClick={e => { e.stopPropagation(); go(`#/payslips/view/${employee.id}/${p.id}`); }}><I.Eye size={13}/></button>
                <a className="btn btn-ghost btn-icon-sm" title="Download" href={api.payslipPdfUrl(p.id)} download={`payslip-${p.id}.pdf`} onClick={e => e.stopPropagation()}><I.Download size={13}/></a>
                {can('payslips:delete') && <button className="btn btn-ghost btn-icon-sm" title="Delete payslip" onClick={e => remove(e, p)}><I.Trash size={13}/></button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileDocuments({ employee, onChanged }) {
  return <DocumentsList docs={employee.documents} employee={employee} onChanged={onChanged}/>;
}

const TAGS = ['Contract','Leave','Payroll','HR','Medical','Performance','Warning'];
const TAG_COLORS = {
  Contract:'badge-info', Leave:'badge-warning', Payroll:'badge-accent', HR:'badge',
  Medical:'badge-danger', Performance:'badge-success', Warning:'badge-warning',
};

export function DocumentsList({ docs, employee, onChanged }) {
  const { can } = useStore();
  const [drag, setDrag] = useState(false);
  const fileRef = React.useRef();
  const [tag, setTag] = useState('HR');
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files) => {
    setBusy(true);
    for (const file of files) {
      try { await api.uploadDocument(employee.id, file, tag); }
      catch (e) { alert(`Upload failed: ${e.message}`); }
    }
    setBusy(false);
    onChanged?.();
  };

  return (
    <div className="col" style={{gap:16}}>
      {can('documents:upload') && (
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(Array.from(e.dataTransfer.files || [])); }}>
          <I.Upload/>
          <h4>Drop files to upload to {employee.first_name}'s vault</h4>
          <p>or click to browse · PDF, DOC, JPG, PNG up to 20 MB</p>
          <div style={{marginTop:10}}>
            <select className="select" style={{maxWidth:160, display:'inline-block'}} value={tag} onChange={e => setTag(e.target.value)} onClick={e => e.stopPropagation()}>
              {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input ref={fileRef} type="file" multiple style={{display:'none'}}
            onChange={e => handleFiles(Array.from(e.target.files || []))}/>
          {busy && <p style={{marginTop:8, color:'var(--accent-fg)'}}>Uploading…</p>}
        </div>
      )}

      <div className="card" style={{overflow:'hidden'}}>
        <table className="table">
          <thead>
            <tr><th>Document</th><th>Tag</th><th>Uploaded</th><th>Size</th><th>Version</th><th className="actions"></th></tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id}>
                <td>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <FileIcon name={d.name}/>
                    <strong style={{fontSize:13}}>{d.name}</strong>
                  </div>
                </td>
                <td><span className={`badge ${TAG_COLORS[d.tag] || 'badge'}`}>{d.tag}</span></td>
                <td className="muted">{fmtDate(d.uploaded_at)}</td>
                <td className="num muted">{fmtBytes(d.size)}</td>
                <td><span className="tag">v{d.version}</span></td>
                <td className="actions">
                  <a className="btn btn-ghost btn-icon-sm" href={api.documentUrl(d.id)} target="_blank" rel="noreferrer"><I.Eye size={13}/></a>
                  <a className="btn btn-ghost btn-icon-sm" href={api.documentUrl(d.id)} download><I.Download size={13}/></a>
                  {can('documents:delete') && (
                    <button className="btn btn-ghost btn-icon-sm" onClick={async () => {
                      if (!confirm(`Delete ${d.name}?`)) return;
                      await api.deleteDocument(d.id); onChanged?.();
                    }}><I.Trash size={13}/></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const FileIcon = ({ name }) => {
  const ext = name.split('.').pop().toUpperCase();
  const color = ext === 'PDF' ? 'oklch(58% 0.18 25)'
              : ext === 'JPG' || ext === 'PNG' || ext === 'JPEG' ? 'oklch(60% 0.13 240)'
              : 'var(--text-3)';
  return (
    <div style={{
      width:28, height:36, borderRadius:4, background:'var(--surface-3)',
      display:'grid', placeItems:'center', position:'relative', flexShrink:0,
    }}>
      <span style={{
        position:'absolute', bottom:4, fontSize:8.5, fontWeight:700,
        color:'white', background:color, padding:'1px 4px', borderRadius:2,
        fontFamily:'var(--font-mono)', letterSpacing:'0.02em',
      }}>{ext}</span>
    </div>
  );
};
