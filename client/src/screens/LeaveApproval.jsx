import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader, Modal } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, ZAR, NUM, initials, fmtDate } from '../api.js';

// Leave-type catalogue with display labels + pill colours.
const TYPE_DEFS = {
  annual:        { label: 'Annual',          pill: 'lp-annual',    rate: 'normal',      writes: true,  desc: 'Paid at the normal rate using avg daily hours' },
  sick:          { label: 'Sick',            pill: 'lp-sick',      rate: 'normal',      writes: true,  desc: '30 days per rolling 3-year cycle (BCEA § 22)' },
  family:        { label: 'Family resp.',    pill: 'lp-family',    rate: 'normal',      writes: true,  desc: '3 days/year for birth, child illness, or family death (BCEA § 27)' },
  maternity:     { label: 'Maternity',       pill: 'lp-maternity', rate: 'unpaid-uif',  writes: false, desc: '4 months unpaid by employer; employee claims UIF (BCEA § 25)' },
  parental:      { label: 'Parental',        pill: 'lp-parental',  rate: 'unpaid-uif',  writes: false, desc: '10 consecutive days unpaid; employee claims UIF (BCEA § 25A)' },
  unpaid:        { label: 'Unpaid',          pill: 'lp-unpaid',    rate: 'unpaid',      writes: true,  desc: 'No statutory quota; no pay for the period' },
  study:         { label: 'Study',           pill: 'lp-unpaid',    rate: 'unpaid',      writes: true,  desc: 'Discretionary; treated as unpaid time off unless company policy says otherwise' },
  compassionate: { label: 'Compassionate',   pill: 'lp-family',    rate: 'normal',      writes: true,  desc: 'Discretionary, usually 3–5 days; paid at normal rate' },
};

// Inline styles for the colour pills (kept here so the component is self-contained).
const PILL_STYLE = {
  'lp-annual':    { background: 'oklch(95% 0.04 240)', color: 'oklch(40% 0.13 240)' },
  'lp-sick':      { background: 'var(--danger-soft)', color: 'var(--danger)' },
  'lp-family':    { background: 'oklch(94% 0.05 320)', color: 'oklch(40% 0.15 320)' },
  'lp-maternity': { background: 'oklch(94% 0.05 25)',  color: 'oklch(45% 0.16 25)' },
  'lp-parental':  { background: 'oklch(94% 0.05 150)', color: 'oklch(38% 0.14 150)' },
  'lp-unpaid':    { background: 'var(--surface-3)', color: 'var(--text-2)' },
};

const TypePill = ({ type }) => {
  const def = TYPE_DEFS[type] || { label: type, pill: 'lp-unpaid' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 500,
      ...PILL_STYLE[def.pill],
    }}>{def.label}</span>
  );
};

const StatusBadge = ({ status }) => {
  if (status === 'approved') return <span className="badge badge-success dot">Approved</span>;
  if (status === 'rejected') return <span className="badge badge-danger dot">Rejected</span>;
  return <span className="badge badge-warning dot">Pending</span>;
};

const FAMILY_SUB_REASONS = [
  { id: 'birth',   label: 'Birth of child' },
  { id: 'illness', label: 'Illness of child' },
  { id: 'death',   label: 'Death of family member' },
  { id: 'other',   label: 'Other' },
];

export default function LeaveApproval({ go, subroute }) {
  const tab = subroute === 'dashboard' ? 'dashboard' : 'requests';
  return (
    <div className="page fade-in">
      <PageHeader title="Leave Approval"
        subtitle="Manage leave requests, balances, and dashboard"
        actions={
          <div className="tabs" style={{ margin: 0, border: 'none' }}>
            <button className={`tab ${tab === 'requests' ? 'is-active' : ''}`} onClick={() => go('#/leave')}>Requests</button>
            <button className={`tab ${tab === 'dashboard' ? 'is-active' : ''}`} onClick={() => go('#/leave/dashboard')}>Dashboard</button>
          </div>
        }/>
      {tab === 'requests' ? <RequestsTab go={go}/> : <DashboardTab go={go}/>}
    </div>
  );
}

// ============================================================
// Requests tab
// ============================================================
function RequestsTab({ go }) {
  const { activeEmployees, can, refresh } = useStore();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(null); // id currently being acted on

  const reload = async () => {
    const params = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    if (employeeFilter !== 'all') params.employeeId = employeeFilter;
    if (typeFilter !== 'all') params.type = typeFilter;
    setRequests(await api.listLeaveRequests(params));
    refresh();
  };
  useEffect(() => { reload(); }, [statusFilter, employeeFilter, typeFilter]);

  const counts = useMemo(() => {
    return requests.reduce((acc, r) => {
      acc.all++; acc[r.status] = (acc[r.status] || 0) + 1; return acc;
    }, { all: 0, pending: 0, approved: 0, rejected: 0 });
  }, [requests]);

  const decide = async (id, status) => {
    setBusy(id);
    try { await api.updateLeaveRequest(id, { status }); await reload(); }
    catch (e) { alert(e.message); }
    setBusy(null);
  };
  const remove = async (id) => {
    if (!confirm('Delete this leave request? Any attendance rows it wrote will be removed.')) return;
    setBusy(id);
    try { await api.deleteLeaveRequest(id); await reload(); }
    catch (e) { alert(e.message); }
    setBusy(null);
  };

  return (
    <>
      <div style={{display:'flex', gap:8, marginBottom:16, flexWrap:'wrap'}}>
        <SegFilter value={statusFilter} onChange={setStatusFilter} options={[
          { v: 'all',      l: 'All',      count: counts.all },
          { v: 'pending',  l: 'Pending',  count: counts.pending },
          { v: 'approved', l: 'Approved', count: counts.approved },
          { v: 'rejected', l: 'Rejected', count: counts.rejected },
        ]}/>
        <div style={{display:'flex', gap:6, marginLeft:'auto'}}>
          <select className="select" style={{width:170}} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
            <option value="all">All employees</option>
            {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
          <select className="select" style={{width:170}} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All leave types</option>
            {Object.keys(TYPE_DEFS).map(t => <option key={t} value={t}>{TYPE_DEFS[t].label}</option>)}
          </select>
          {can('leave:create') && (
            <button className="btn btn-accent" onClick={() => setNewOpen(true)}><I.Plus size={13}/> New leave request</button>
          )}
        </div>
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Leave type</th>
              <th>Period</th>
              <th className="right">Days</th>
              <th>Reason</th>
              <th>Status</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr><td colSpan={7}><div className="empty" style={{padding:36}}>
                <I.CheckCircle size={24}/>
                <h4>No leave requests</h4>
                <p>Create the first one to start tracking leave balances.</p>
              </div></td></tr>
            )}
            {requests.map(r => (
              <tr key={r.id}>
                <td>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <span className="avatar avatar-sm">{initials(r.first_name, r.last_name)}</span>
                    <div style={{lineHeight:1.2}}>
                      <div style={{fontWeight:500, display:'flex', alignItems:'center', gap:6}}>
                        {r.first_name} {r.last_name}
                        {r.employee_status && r.employee_status !== 'active' && (
                          <span className="badge" style={{fontSize:10, padding:'1px 6px', textTransform:'capitalize'}}>{r.employee_status}</span>
                        )}
                      </div>
                      <div style={{fontSize:11, color:'var(--text-3)'}}>#{r.employee_no}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <TypePill type={r.leave_type}/>
                  {r.sub_reason && <div style={{fontSize:11, color:'var(--text-3)', marginTop:3}}>{describeSubReason(r.sub_reason)}</div>}
                </td>
                <td>
                  <div>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</div>
                </td>
                <td className="right num">
                  <strong>{NUM(r.days_count || r.days_requested, 0)}</strong>
                  {r.skipped_dates && r.status === 'approved' && (() => {
                    const sk = safeParse(r.skipped_dates);
                    const skipped = (sk?.sundays?.length || 0) + (sk?.holidays?.length || 0) + (sk?.worked?.length || 0);
                    return skipped > 0
                      ? <div style={{fontSize:10.5, color:'var(--text-3)'}}>({skipped} skipped)</div>
                      : null;
                  })()}
                </td>
                <td style={{fontSize:12.5, color:'var(--text-2)', maxWidth:240}}>{r.reason || '—'}</td>
                <td><StatusBadge status={r.status}/></td>
                <td className="actions">
                  {r.status === 'pending' && can('leave:decide') && (
                    <>
                      <button className="btn btn-sm btn-accent" disabled={busy === r.id} onClick={() => decide(r.id, 'approved')}>Approve</button>
                      <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => decide(r.id, 'rejected')}>Reject</button>
                    </>
                  )}
                  {r.status !== 'pending' && can('leave:decide') && (
                    <button className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => decide(r.id, 'pending')} title="Revert to pending (rolls back attendance)">Revert</button>
                  )}
                  {can('leave:create') && (
                    <button className="btn btn-ghost btn-icon-sm" title="Delete" disabled={busy === r.id} onClick={() => remove(r.id)}><I.Trash size={13}/></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newOpen && <NewRequestModal onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); reload(); }}/>}
    </>
  );
}

function SegFilter({ value, onChange, options }) {
  return (
    <div style={{display:'flex', gap:2, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:3}}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer',
          background: value === o.v ? 'var(--surface-3)' : 'transparent',
          color: value === o.v ? 'var(--text)' : 'var(--text-3)',
          fontSize:12.5, fontWeight:500,
        }}>{o.l} <span className="num" style={{color:'var(--text-4)', marginLeft:4, fontSize:11}}>{o.count}</span></button>
      ))}
    </div>
  );
}

// ============================================================
// New / edit request modal
// ============================================================
function NewRequestModal({ onClose, onSaved, employeeIdDefault }) {
  const { activeEmployees, can } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState(employeeIdDefault || activeEmployees[0]?.id || '');
  const [leaveType, setLeaveType] = useState('annual');
  const [subReason, setSubReason] = useState('birth');
  const [subReasonOther, setSubReasonOther] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('pending');
  const [preview, setPreview] = useState(null);
  const [balances, setBalances] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const def = TYPE_DEFS[leaveType];

  // Recompute preview + balances whenever inputs change.
  useEffect(() => {
    if (!employeeId || !startDate || !endDate || endDate < startDate) { setPreview(null); return; }
    let cancelled = false;
    api.previewLeave({ employeeId, startDate, endDate })
      .then(r => { if (!cancelled) setPreview(r); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [employeeId, startDate, endDate]);

  useEffect(() => {
    if (!employeeId) { setBalances(null); return; }
    let cancelled = false;
    api.leaveBalances({ employeeStatus: 'all' })
      .then(list => {
        const found = list.find(r => r.employee.id === employeeId);
        if (!cancelled) setBalances(found?.balances || null);
      })
      .catch(() => { if (!cancelled) setBalances(null); });
    return () => { cancelled = true; };
  }, [employeeId]);

  const submit = async () => {
    setError(null);
    if (leaveType === 'family') {
      if (!subReason) { setError('Pick a sub-reason for the family responsibility leave.'); return; }
      if (subReason === 'other' && !subReasonOther.trim()) { setError('Describe the "other" reason.'); return; }
    }
    setBusy(true);
    try {
      const body = {
        employeeId, leaveType,
        subReason: leaveType === 'family' ? (subReason === 'other' ? `other:${subReasonOther.trim()}` : subReason) : null,
        startDate, endDate, reason: reason || null,
        status: decision,
      };
      await api.createLeaveRequest(body);
      onSaved?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const showSubReason = leaveType === 'family';
  const isSpan = def && def.writes === false;
  const canDecide = can('leave:decide');

  return (
    <Modal open onClose={onClose} wide title="New leave request"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-accent" onClick={submit} disabled={busy || !employeeId}>
            <I.Check size={14}/> {busy ? 'Saving…' : (decision === 'approved' ? 'Approve & populate' : decision === 'rejected' ? 'Save as rejected' : 'Submit for review')}
          </button>
        </>
      }>
      <div className="col" style={{gap:14}}>

        <div className="grid grid-2" style={{gap:14}}>
          <div>
            <label className="label">Employee</label>
            <select className="select" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Decision</label>
            <select className="select" value={decision} onChange={e => setDecision(e.target.value)} disabled={!canDecide && (decision !== 'pending')}>
              <option value="pending">Pending — submit for later approval</option>
              <option value="approved" disabled={!canDecide}>Approve immediately {!canDecide && '(needs leave:decide)'}</option>
              <option value="rejected" disabled={!canDecide}>Reject {!canDecide && '(needs leave:decide)'}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Leave type</label>
          <div className="grid" style={{gridTemplateColumns:'repeat(4, 1fr)', gap:8}}>
            {Object.entries(TYPE_DEFS).map(([id, t]) => (
              <button key={id} onClick={() => setLeaveType(id)}
                style={{
                  padding:'10px 12px', borderRadius:8, fontSize:12,
                  border:`1px solid ${leaveType === id ? 'var(--accent)' : 'var(--border)'}`,
                  background: leaveType === id ? 'var(--accent-soft)' : 'var(--surface)',
                  color: leaveType === id ? 'var(--accent-fg)' : 'var(--text-2)',
                  fontWeight: leaveType === id ? 600 : 500, cursor:'pointer', textAlign:'left',
                  display:'flex', flexDirection:'column', gap:2,
                }}>
                <strong style={{fontSize:13}}>{t.label}</strong>
                <span style={{fontSize:10.5, opacity:0.8}}>{quotaSummary(id, balances)}</span>
              </button>
            ))}
          </div>
          {def && (
            <div style={{fontSize:11.5, color:'var(--text-3)', marginTop:6}}>{def.desc}</div>
          )}
        </div>

        {showSubReason && (
          <div className="grid grid-2" style={{gap:14}}>
            <div>
              <label className="label">Sub-reason <span className="muted-2" style={{fontWeight:400}}>(BCEA § 27)</span></label>
              <select className="select" value={subReason} onChange={e => setSubReason(e.target.value)}>
                {FAMILY_SUB_REASONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            {subReason === 'other' && (
              <div>
                <label className="label">Describe</label>
                <input className="input" value={subReasonOther} onChange={e => setSubReasonOther(e.target.value)} placeholder="Short description"/>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-3" style={{gap:14}}>
          <div>
            <label className="label">Start date</label>
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}/>
          </div>
          <div>
            <label className="label">End date</label>
            <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}/>
          </div>
          <div>
            <label className="label">Working days</label>
            <input className="input num" type="text" readOnly value={isSpan ? `${diffCalendarDays(startDate, endDate)} cal days` : (preview ? `${preview.daysApplied} of ${preview.daysRequested}` : '–')}/>
          </div>
        </div>

        <div>
          <label className="label">Reason (optional)</label>
          <textarea className="textarea" rows={2} placeholder="Short note explaining the leave…" value={reason} onChange={e => setReason(e.target.value)}/>
        </div>

        {isSpan && (
          <div style={{padding:12, background:'oklch(94% 0.05 25)', color:'oklch(35% 0.16 25)', borderRadius:8, fontSize:12, lineHeight:1.55}}>
            <strong style={{display:'block', marginBottom:2}}>Span-only leave</strong>
            {def.label} is recorded as one continuous span (no daily attendance rows). The employee claims UIF directly. Payroll for these days defaults to zero from the employer.
          </div>
        )}

        {!isSpan && preview && (
          <div style={{padding:12, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:10, fontSize:12, color:'var(--text-3)', lineHeight:1.6}}>
            <strong style={{color:'var(--text-2)', display:'block', marginBottom:4}}>When approved:</strong>
            ✓ <strong style={{color:'var(--text)'}}>{preview.daysApplied}</strong> working day(s) will be written to attendance as <TypePill type={leaveType}/><br/>
            {preview.skipped.worked.length > 0 && <>↳ <strong>{preview.skipped.worked.length}</strong> day(s) already worked are kept as-is (not overwritten)<br/></>}
            {preview.skipped.holidays.length > 0 && <>↳ <strong>{preview.skipped.holidays.length}</strong> day(s) are public holidays (skipped)<br/></>}
            {preview.skipped.sundays.length > 0 && <>↳ <strong>{preview.skipped.sundays.length}</strong> Sunday(s) skipped<br/></>}
            {balances && balances[leaveType] && (
              <>↳ Balance: {balances[leaveType].used} used → {balances[leaveType].used + preview.daysApplied} after this · {balances[leaveType].left - preview.daysApplied} left</>
            )}
          </div>
        )}

        {error && (
          <div style={{padding:'10px 12px', background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, fontSize:12.5, display:'flex', alignItems:'center', gap:8}}>
            <I.AlertCircle size={14}/> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// Dashboard tab
// ============================================================
function DashboardTab() {
  const [dash, setDash] = useState(null);
  const [balances, setBalances] = useState([]);
  const [entitlements, setEntitlements] = useState(null);

  useEffect(() => {
    api.leaveDashboard().then(setDash).catch(console.error);
    api.leaveBalances({ employeeStatus: 'active' }).then(setBalances).catch(console.error);
    api.leaveEntitlements().then(setEntitlements).catch(console.error);
  }, []);

  if (!dash || !entitlements) return <div className="empty" style={{padding:48}}>Loading…</div>;

  return (
    <>
      <div className="grid grid-4" style={{marginBottom:16}}>
        <div className="stat">
          <div className="stat-label">On leave today</div>
          <div className="stat-value num">{dash.onLeaveToday.length}</div>
          <div className="stat-meta">
            {dash.onLeaveToday.length === 0 ? 'Everyone is in' :
              dash.onLeaveToday.slice(0, 2).map(p => `${p.first_name} ${p.last_name[0]}.`).join(', ')}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Approved this month</div>
          <div className="stat-value num">{dash.stats.approvedThisMonth.count}</div>
          <div className="stat-meta">{NUM(dash.stats.approvedThisMonth.days, 0)} working days</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pending requests</div>
          <div className="stat-value num">{dash.stats.pendingCount}</div>
          <div className="stat-meta">Awaiting decision</div>
        </div>
        <div className="stat">
          <div className="stat-label">Annual leave used (YTD)</div>
          <div className="stat-value num">{NUM(dash.stats.annualUsedYTD, 0)} / {dash.stats.annualAllowedTotal}</div>
          <div className="stat-meta">Across active employees</div>
        </div>
      </div>

      <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr', gap:16, marginBottom:16}}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Leaves taken by type</h3>
              <div className="sub">Working days · {new Date().getFullYear()}</div>
            </div>
          </div>
          <div className="card-pad" style={{paddingTop:8}}>
            <LeavesByTypeChart byType={dash.byType}/>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Statutory entitlements</h3><span className="badge">SA BCEA</span></div>
          <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:10, fontSize:12.5}}>
            <EntRow label="Annual leave"          section="§ 20"  value={`${entitlements.annual_days} days / year`}/>
            <EntRow label="Sick leave"            section="§ 22"  value={`${entitlements.sick_days_per_year * entitlements.sick_cycle_years} days / ${entitlements.sick_cycle_years}-yr cycle`}/>
            <EntRow label="Family responsibility" section="§ 27"  value={`${entitlements.family_days} days / year`}/>
            <EntRow label="Maternity"             section="§ 25"  value={`${entitlements.maternity_months} months (UIF)`}/>
            <EntRow label="Parental"              section="§ 25A" value={`${entitlements.parental_days} days`}/>
            <hr className="divider" style={{margin:'4px 0'}}/>
            <div style={{fontSize:11.5, color:'var(--text-3)', lineHeight:1.5}}>
              These are the minimums Onse Winkel applies. Family responsibility and annual leave reset on the employee's hire-date anniversary; sick days run on a rolling 3-year cycle.
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="card-head">
          <div><h3>Per-employee balances</h3><div className="sub">Annual cycle starts on the employee's hire-date anniversary</div></div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Annual</th>
              <th>Sick</th>
              <th>Family resp.</th>
              <th>Parental</th>
              <th>Maternity</th>
              <th className="right">Cycle ends</th>
            </tr>
          </thead>
          <tbody>
            {balances.map(({ employee, balances: b }) => (
              <tr key={employee.id}>
                <td><div style={{display:'flex', gap:10, alignItems:'center'}}><span className="avatar avatar-sm">{initials(employee.first_name, employee.last_name)}</span><strong>{employee.first_name} {employee.last_name}</strong></div></td>
                <td><BalBar used={b.annual.used} allowed={b.annual.allowed}/></td>
                <td><BalBar used={b.sick.used}   allowed={b.sick.allowed}/></td>
                <td><BalBar used={b.family.used} allowed={b.family.allowed}/></td>
                <td><BalBar used={b.parental.used} allowed={b.parental.allowed}/></td>
                <td>{b.maternity.used > 0 ? <span className="badge badge-info">Active</span> : <span className="muted">—</span>}</td>
                <td className="right num muted">{fmtDate(b.cycle.endISO)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h3>Recent decisions</h3></div>
        <div style={{padding:'4px 0'}}>
          {dash.recent.length === 0 && <div className="empty" style={{padding:24}}>No decisions yet</div>}
          {dash.recent.map(r => (
            <div key={r.id} style={{display:'flex', alignItems:'center', gap:12, padding:'10px 18px', borderBottom:'1px solid var(--border)'}}>
              <span className="avatar avatar-sm">{initials(r.first_name, r.last_name)}</span>
              <div style={{flex:1, fontSize:13}}>
                <strong>{r.first_name} {r.last_name}</strong> — {TYPE_DEFS[r.leave_type]?.label || r.leave_type} ({NUM(r.days_count || 0, 0)} days) {r.status}
                <div style={{fontSize:11.5, color:'var(--text-3)'}}>
                  {fmtDate(r.start_date)} – {fmtDate(r.end_date)}
                  {r.decided_by_name && ` · by ${r.decided_by_name}`}
                  {r.decided_at && ` · ${fmtDate(r.decided_at)}`}
                </div>
              </div>
              <StatusBadge status={r.status}/>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function EntRow({ label, section, value }) {
  return (
    <div style={{display:'flex', justifyContent:'space-between'}}>
      <span><strong style={{color:'var(--text)'}}>{label}</strong> <span className="muted-2"> · {section}</span></span>
      <span className="num">{value}</span>
    </div>
  );
}

function BalBar({ used, allowed }) {
  const pct = allowed > 0 ? Math.min(100, (used / allowed) * 100) : 0;
  const color = pct < 50 ? 'var(--success)' : pct < 95 ? 'oklch(72% 0.15 75)' : 'var(--danger)';
  return (
    <div style={{display:'flex', flexDirection:'column', gap:4, minWidth:120}}>
      <div style={{height:5, background:'var(--surface-3)', borderRadius:99, overflow:'hidden'}}>
        <div style={{height:'100%', width:`${pct}%`, background:color, borderRadius:99}}/>
      </div>
      <div style={{fontSize:11.5, color:'var(--text-3)', fontFamily:'var(--font-mono)', display:'flex', justifyContent:'space-between'}}>
        <span><strong style={{color:'var(--text)'}}>{NUM(used, 0)}</strong> used</span>
        <span><strong style={{color:'var(--text)'}}>{NUM(Math.max(0, allowed - used), 0)}</strong> left</span>
      </div>
    </div>
  );
}

function LeavesByTypeChart({ byType }) {
  const types = Object.keys(TYPE_DEFS);
  const values = types.map(t => byType[t]?.days || 0);
  const max = Math.max(...values, 5);
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const W = 600, H = 220, padL = 36, padR = 8, padT = 16, padB = 28;
  const w = W - padL - padR, h = H - padT - padB;
  const colours = ['oklch(60% 0.16 240)', 'var(--danger)', 'oklch(60% 0.16 320)', 'oklch(60% 0.16 25)', 'oklch(60% 0.16 150)', 'var(--text-3)', 'var(--text-3)', 'oklch(60% 0.16 320)'];
  const bw = w / types.length * 0.62;
  const gap = w / types.length * 0.38;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <g className="chart-grid">
        {[0,0.25,0.5,0.75,1].map(t => <line key={t} x1={padL} x2={W-padR} y1={padT + h*(1-t)} y2={padT + h*(1-t)}/>)}
      </g>
      <g className="chart-axis">
        {[0,0.5,1].map(t => <text key={t} x={padL-6} y={padT + h*(1-t) + 4} textAnchor="end">{Math.round(niceMax*t)}</text>)}
        {types.map((t, i) => <text key={t} x={padL + (i+0.5)*(w/types.length)} y={H-10} textAnchor="middle">{TYPE_DEFS[t].label.slice(0,7)}</text>)}
      </g>
      {values.map((v, i) => {
        const bh = (v / niceMax) * h;
        return <g key={i}>
          <rect x={padL + i*(w/types.length) + gap/2}
                y={padT + h - bh}
                width={bw}
                height={Math.max(0, bh)}
                rx={3}
                fill={colours[i % colours.length]}
                opacity="0.88"/>
          {v > 0 && (
            <text x={padL + i*(w/types.length) + (w/types.length)/2}
                  y={padT + h - bh - 4}
                  textAnchor="middle"
                  fill="var(--text-2)"
                  style={{font:'600 11px var(--font-mono)'}}>{v}</text>
          )}
        </g>;
      })}
    </svg>
  );
}

// ===== helpers =====
function diffCalendarDays(a, b) {
  if (!a || !b) return 0;
  const ms = new Date(b) - new Date(a);
  return Math.max(0, Math.round(ms / 86400000) + 1);
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function quotaSummary(typeId, balances) {
  if (!balances) return '—';
  const b = balances[typeId];
  if (!b) return '—';
  if (typeId === 'maternity') return `${b.months || 4} months · UIF`;
  if (typeId === 'unpaid' || typeId === 'study') return 'no quota';
  return `${b.left} / ${b.allowed} left`;
}
function describeSubReason(sub) {
  if (!sub) return '';
  if (sub.startsWith('other:')) return `Other: ${sub.slice(6)}`;
  const f = FAMILY_SUB_REASONS.find(s => s.id === sub);
  return f ? f.label : sub;
}
