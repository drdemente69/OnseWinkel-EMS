import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, ZAR, NUM, initials, fmtDate } from '../api.js';
import { PsLine } from './Employees.jsx';
import { payPeriodFor } from '../period.js';

export function PayslipsList({ go }) {
  const { refresh, can } = useStore();
  const [all, setAll] = useState([]);
  const reload = () => api.listPayslips().then(setAll);
  useEffect(() => { reload(); }, []);
  const ytd = all.reduce((a, p) => a + (p.gross || 0), 0);

  const remove = async (p) => {
    if (!confirm(`Delete payslip ${p.period_label} for ${p.first_name} ${p.last_name}? This cannot be undone.`)) return;
    try { await api.deletePayslip(p.id); await reload(); refresh(); }
    catch (e) { alert(e.message); }
  };

  // Group every payslip by its period_label so the screen reads as a stack of
  // pay-cycle cards rather than one long flat table. Within each card the
  // payslips stay sorted by employee name.
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of all) {
      const key = p.period_label || '—';
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          period_start: p.period_start,
          period_end: p.period_end,
          pay_date: p.pay_date,
          rows: [],
          totals: { gross: 0, uif: 0, net: 0, hours: 0, publicHolidayPay: 0 },
        });
      }
      const g = map.get(key);
      g.rows.push(p);
      g.totals.gross += Number(p.gross) || 0;
      g.totals.uif   += Number(p.uif)   || 0;
      g.totals.net   += Number(p.net)   || 0;
      g.totals.hours += (Number(p.normal_hours)||0) + (Number(p.overtime_hours)||0)
                     + (Number(p.holiday_hours)||0) + (Number(p.public_holiday_hours)||0);
      g.totals.publicHolidayPay += Number(p.public_holiday_pay) || 0;
      // Earliest period_start/end and latest pay_date wins for header display.
      if (p.period_start && (!g.period_start || p.period_start < g.period_start)) g.period_start = p.period_start;
      if (p.period_end   && (!g.period_end   || p.period_end   > g.period_end))   g.period_end   = p.period_end;
      if (p.pay_date     && (!g.pay_date     || p.pay_date     > g.pay_date))     g.pay_date     = p.pay_date;
    }
    const list = [...map.values()];
    for (const g of list) {
      g.rows.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
    }
    // Newest pay cycle first.
    list.sort((a, b) => (b.pay_date || '').localeCompare(a.pay_date || ''));
    return list;
  }, [all]);

  return (
    <div className="page fade-in">
      <PageHeader title="Payslips"
        subtitle={`${all.length} payslips across ${groups.length} pay ${groups.length === 1 ? 'period' : 'periods'} · Total ${ZAR(ytd)}`}
        actions={
          <>
            <a className="btn" href="/api/backup/export"><I.Download/> Export all</a>
            {can('payslips:create') && <button className="btn btn-accent" onClick={() => go('#/payslips/new')}><I.Plus/> New payslip</button>}
          </>
        }/>

      {groups.length === 0 && (
        <div className="card"><div className="empty" style={{padding:48}}>
          <I.Receipt size={28}/>
          <h4>No payslips yet</h4>
          <p>Generate your first one to get the period view rolling.</p>
          {can('payslips:create') && <button className="btn btn-accent" onClick={() => go('#/payslips/new')}><I.Plus/> New payslip</button>}
        </div></div>
      )}

      <div className="col" style={{gap:16}}>
        {groups.map((group, idx) => (
          <PayslipPeriodCard
            key={group.label}
            group={group}
            defaultOpen={idx === 0}
            canDelete={can('payslips:delete')}
            onRowClick={p => go(`#/payslips/view/${p.employee_id}/${p.id}`)}
            onRemove={remove}/>
        ))}
      </div>
    </div>
  );
}

function PayslipPeriodCard({ group, defaultOpen, canDelete, onRowClick, onRemove }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="card-head"
        style={{
          width:'100%', textAlign:'left', cursor:'pointer',
          background: 'transparent', border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          padding: '14px 18px',
        }}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <I.ChevronRight size={14} style={{transform: open ? 'rotate(90deg)' : 'none', transition:'transform 120ms ease'}}/>
          <div>
            <h3 style={{margin:0}}>{group.label}</h3>
            <div className="sub">
              {group.period_start && group.period_end
                ? <>{fmtDate(group.period_start)} → {fmtDate(group.period_end)}</>
                : '—'}
              {group.pay_date && <> · Paid {fmtDate(group.pay_date)}</>}
            </div>
          </div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:24}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10.5, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:500}}>
              {group.rows.length} {group.rows.length === 1 ? 'payslip' : 'payslips'}
            </div>
            <div className="num" style={{fontSize:14, fontWeight:600}}>{ZAR(group.totals.gross)}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10.5, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:500}}>Total net</div>
            <div className="num" style={{fontSize:14, fontWeight:600, color:'var(--accent-fg)'}}>{ZAR(group.totals.net)}</div>
          </div>
        </div>
      </button>

      {open && (
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="right">Hours</th>
              <th className="right">Public hol.</th>
              <th className="right">Gross</th>
              <th className="right">UIF</th>
              <th className="right">Net</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map(p => (
              <tr key={p.id} onClick={() => onRowClick(p)}>
                <td>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <span className="avatar avatar-sm">{initials(p.first_name, p.last_name)}</span>
                    <div style={{lineHeight:1.25}}>
                      <div style={{fontWeight:500}}>{p.first_name} {p.last_name}</div>
                      <div style={{fontSize:11.5, color:'var(--text-3)'}}>{p.position}</div>
                    </div>
                  </div>
                </td>
                <td className="right num muted">{NUM((p.normal_hours||0)+(p.overtime_hours||0)+(p.holiday_hours||0)+(p.public_holiday_hours||0), 0)}h</td>
                <td className="right num muted">{ZAR(p.public_holiday_pay)}</td>
                <td className="right num">{ZAR(p.gross)}</td>
                <td className="right num muted">{ZAR(p.uif)}</td>
                <td className="right num" style={{fontWeight:600}}>{ZAR(p.net)}</td>
                <td className="actions">
                  <a className="btn btn-ghost btn-icon-sm" href={api.payslipPdfUrl(p.id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="View PDF"><I.Eye size={13}/></a>
                  <a className="btn btn-ghost btn-icon-sm" href={api.payslipPdfUrl(p.id)} download={`payslip-${p.id}.pdf`} onClick={e => e.stopPropagation()} title="Download"><I.Download size={13}/></a>
                  {canDelete && <button className="btn btn-ghost btn-icon-sm" onClick={e => { e.stopPropagation(); onRemove(p); }} title="Delete payslip"><I.Trash size={13}/></button>}
                </td>
              </tr>
            ))}
            {/* Period totals row */}
            <tr style={{background:'var(--surface-2)'}}>
              <td style={{fontWeight:600, fontSize:12.5, color:'var(--text-2)'}}>Period totals</td>
              <td className="right num" style={{fontWeight:600}}>{NUM(group.totals.hours, 0)}h</td>
              <td className="right num" style={{fontWeight:600}}>{ZAR(group.totals.publicHolidayPay)}</td>
              <td className="right num" style={{fontWeight:600}}>{ZAR(group.totals.gross)}</td>
              <td className="right num" style={{fontWeight:600}}>{ZAR(group.totals.uif)}</td>
              <td className="right num" style={{fontWeight:700, color:'var(--accent-fg)'}}>{ZAR(group.totals.net)}</td>
              <td/>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PayslipBuilder({ go, prefilledEmployeeId }) {
  // PayslipBuilder only lets you create payslips for currently-active employees.
  // The full employees list is still searched in case `prefilledEmployeeId`
  // points at an inactive profile (deep-linked from somewhere), so the picker
  // can still resolve their record for display.
  const { employees, activeEmployees } = useStore();
  const [step, setStep] = useState(1);
  const [employeeId, setEmployeeId] = useState(prefilledEmployeeId || activeEmployees[0]?.id || '');
  const employee = employees.find(e => e.id === employeeId);

  // Default to the pay period containing today (runs 21st → 20th).
  const defaultPeriod = useMemo(() => payPeriodFor(new Date()), []);
  const [periodStart, setPeriodStart] = useState(defaultPeriod.startISO);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.endISO);
  const [payDate, setPayDate] = useState(defaultPeriod.payDate);
  const [periodLabel, setPeriodLabel] = useState(defaultPeriod.label);
  const [commission, setCommission] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [otherEarnings, setOtherEarnings] = useState(0);
  const [paye, setPaye] = useState(0);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    api.previewPayslip({ employeeId, periodStart, periodEnd, commission, bonus, otherEarnings, paye })
      .then(r => { if (!cancelled) setPreview(r); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [employeeId, periodStart, periodEnd, commission, bonus, otherEarnings, paye]);

  const finalize = async () => {
    setBusy(true);
    try {
      const ps = await api.createPayslip({
        employeeId, periodStart, periodEnd, payDate, periodLabel,
        commission, bonus, otherEarnings, paye,
      });
      go(`#/payslips/view/${employeeId}/${ps.id}`);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const calc = preview?.calc;

  return (
    <div className="page fade-in">
      <PageHeader title="New payslip"
        subtitle="Select employee, confirm hours, calculate, and finalise"
        actions={<button className="btn btn-ghost" onClick={() => go('#/payslips')}><I.X/> Cancel</button>}/>

      <Stepper step={step} steps={[
        {n:1, label:'Employee'},{n:2, label:'Period & hours'},
        {n:3, label:'Earnings'},{n:4, label:'Review'},
      ]}/>

      <div className="grid" style={{gridTemplateColumns:'1.4fr 1fr', gap:16, marginTop:24}}>
        <div className="card card-pad">
          {step === 1 && (
            <div style={{display:'flex', flexDirection:'column', gap:16}}>
              <h3 style={{margin:0, fontSize:15}}>Choose employee</h3>
              {activeEmployees.map(e => (
                <button key={e.id} onClick={() => setEmployeeId(e.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:14, padding:14,
                    border:`1px solid ${employeeId === e.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: employeeId === e.id ? 'var(--accent-soft)' : 'var(--surface)',
                    borderRadius:10, textAlign:'left', cursor:'pointer',
                  }}>
                  <span className="avatar avatar-lg" style={{background:'var(--brand-brown)', color:'white'}}>{initials(e.first_name, e.last_name)}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600, fontSize:14}}>{e.first_name} {e.last_name}</div>
                    <div style={{fontSize:12, color:'var(--text-3)'}}>{e.position} · R{e.hourly_wage}/h</div>
                  </div>
                  {employeeId === e.id && <I.Check color="var(--accent-fg)"/>}
                </button>
              ))}
              <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
                <button className="btn btn-accent" onClick={() => setStep(2)} disabled={!employeeId}>Next <I.ArrowRight size={13}/></button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{display:'flex', flexDirection:'column', gap:16}}>
              <h3 style={{margin:0, fontSize:15}}>Pay period</h3>
              <div className="grid grid-3">
                <div><label className="label">Period start</label><input className="input" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}/></div>
                <div><label className="label">Period end</label><input className="input" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}/></div>
                <div><label className="label">Pay date</label><input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)}/></div>
              </div>
              <div><label className="label">Period label (appears on payslip)</label><input className="input" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}/></div>

              <div style={{padding:14, background:'var(--surface-2)', borderRadius:10, border:'1px solid var(--border)'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                  <strong style={{fontSize:13}}>Hours from attendance ({preview?.attendance?.length || 0} days logged)</strong>
                  <button className="btn btn-ghost btn-sm" onClick={() => go('#/ocr')}><I.ScanText size={13}/> Import via OCR</button>
                </div>
                <div className="grid grid-3" style={{gap:10}}>
                  <HoursCard label="Standard"   value={calc?.hours.normal || 0}/>
                  <HoursCard label="Overtime"   value={calc?.hours.overtime || 0}/>
                  <HoursCard label="Holiday/Sun" value={calc?.hours.holiday || 0}/>
                </div>
              </div>

              <div style={{display:'flex', justifyContent:'space-between', gap:8, marginTop:8}}>
                <button className="btn btn-ghost" onClick={() => setStep(1)}><I.ArrowLeft size={13}/> Back</button>
                <button className="btn btn-accent" onClick={() => setStep(3)}>Next <I.ArrowRight size={13}/></button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{display:'flex', flexDirection:'column', gap:16}}>
              <h3 style={{margin:0, fontSize:15}}>Additional earnings & deductions</h3>
              <div className="grid grid-3">
                {[
                  {label:'Commission', value:commission, set:setCommission},
                  {label:'Bonus', value:bonus, set:setBonus},
                  {label:'Other allowances', value:otherEarnings, set:setOtherEarnings},
                ].map(f => (
                  <div key={f.label}>
                    <label className="label">{f.label}</label>
                    <div style={{position:'relative'}}>
                      <span style={{position:'absolute', left:10, top:9, color:'var(--text-3)', fontSize:12}}>R</span>
                      <input className="input num" style={{paddingLeft:24}} type="number" step="0.01"
                        value={f.value} onChange={e => f.set(Number(e.target.value))}/>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-3">
                <div>
                  <label className="label">PAYE tax</label>
                  <div style={{position:'relative'}}>
                    <span style={{position:'absolute', left:10, top:9, color:'var(--text-3)', fontSize:12}}>R</span>
                    <input className="input num" style={{paddingLeft:24}} type="number" step="0.01" value={paye} onChange={e => setPaye(Number(e.target.value))}/>
                  </div>
                </div>
              </div>
              <div style={{display:'flex', justifyContent:'space-between', gap:8, marginTop:8}}>
                <button className="btn btn-ghost" onClick={() => setStep(2)}><I.ArrowLeft size={13}/> Back</button>
                <button className="btn btn-accent" onClick={() => setStep(4)}>Next <I.ArrowRight size={13}/></button>
              </div>
            </div>
          )}

          {step === 4 && calc && (
            <div style={{display:'flex', flexDirection:'column', gap:16}}>
              <h3 style={{margin:0, fontSize:15}}>Review & finalise</h3>
              <table className="table" style={{borderRadius:0, fontSize:12.5}}>
                <thead><tr><th>Item</th><th className="right">Hours</th><th className="right">Rate</th><th className="right">Amount</th></tr></thead>
                <tbody>
                  <tr><td>Standard pay</td><td className="right num">{NUM(calc.hours.normal)}</td><td className="right num">R{calc.rates.normal.toFixed(2)}</td><td className="right num"><strong>{ZAR(calc.earnings.normalPay)}</strong></td></tr>
                  <tr><td>Overtime pay (1.5×)</td><td className="right num">{NUM(calc.hours.overtime)}</td><td className="right num">R{calc.rates.overtime.toFixed(2)}</td><td className="right num"><strong>{ZAR(calc.earnings.overtimePay)}</strong></td></tr>
                  <tr><td>Sunday & worked holiday (2×)</td><td className="right num">{NUM(calc.hours.holiday)}</td><td className="right num">R{calc.rates.holiday.toFixed(2)}</td><td className="right num"><strong>{ZAR(calc.earnings.holidayPay)}</strong></td></tr>
                  {(calc.earnings.publicHolidayPay || 0) > 0 && (
                    <tr><td>Public holiday pay (1×)</td><td className="right num">{NUM(calc.hours.publicHoliday, 1)}</td><td className="right num">R{calc.rates.publicHoliday.toFixed(2)}</td><td className="right num"><strong>{ZAR(calc.earnings.publicHolidayPay)}</strong></td></tr>
                  )}
                  {calc.earnings.sickPay > 0 && <tr><td>Sick pay</td><td className="right num">{calc.sickDays}d</td><td className="right num">{NUM(calc.avgDaily,1)}h avg</td><td className="right num"><strong>{ZAR(calc.earnings.sickPay)}</strong></td></tr>}
                  {Number(commission) > 0 && <tr><td>Commission</td><td className="right">–</td><td className="right">–</td><td className="right num"><strong>{ZAR(Number(commission))}</strong></td></tr>}
                  {Number(bonus) > 0 && <tr><td>Bonus</td><td className="right">–</td><td className="right">–</td><td className="right num"><strong>{ZAR(Number(bonus))}</strong></td></tr>}
                </tbody>
              </table>
              <div style={{display:'flex', justifyContent:'space-between', gap:8, marginTop:8}}>
                <button className="btn btn-ghost" onClick={() => setStep(3)}><I.ArrowLeft size={13}/> Back</button>
                <button className="btn btn-accent btn-lg" onClick={finalize} disabled={busy}><I.Save/> {busy ? 'Generating…' : 'Generate payslip'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="col" style={{gap:16, position:'sticky', top:80, alignSelf:'flex-start'}}>
          <div className="card">
            <div className="card-head"><h3>Live calculation</h3><span className="badge badge-accent">Auto</span></div>
            <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:10}}>
              <div style={{display:'flex', alignItems:'center', gap:10, paddingBottom:12, borderBottom:'1px solid var(--border)'}}>
                <span className="avatar">{employee && initials(employee.first_name, employee.last_name)}</span>
                <div>
                  <div style={{fontWeight:600, fontSize:13}}>{employee?.first_name} {employee?.last_name}</div>
                  <div style={{fontSize:11.5, color:'var(--text-3)'}}>{periodLabel} · {fmtDate(payDate)}</div>
                </div>
              </div>
              <PsLine label="Standard pay"          value={calc?.earnings.normalPay || 0}/>
              <PsLine label="Overtime pay"          value={calc?.earnings.overtimePay || 0}/>
              <PsLine label="Sunday & worked holiday" value={calc?.earnings.holidayPay || 0}/>
              {(calc?.earnings.publicHolidayPay || 0) > 0 && <PsLine label="Public holiday pay" value={calc.earnings.publicHolidayPay}/>}
              {(calc?.earnings.sickPay || 0) > 0 && <PsLine label="Sick pay" value={calc.earnings.sickPay}/>}
              {Number(commission) > 0 && <PsLine label="Commission" value={Number(commission)}/>}
              {Number(bonus) > 0 && <PsLine label="Bonus" value={Number(bonus)}/>}
              <hr className="divider" style={{margin:'4px 0'}}/>
              <PsLine label="Gross pay" value={calc?.gross || 0} bold/>
              <PsLine label="UIF (1%)" value={-(calc?.uif || 0)} muted/>
              {Number(paye) > 0 && <PsLine label="PAYE" value={-Number(paye)} muted/>}
              <hr className="divider" style={{margin:'4px 0'}}/>
              <PsLine label="Net pay" value={calc?.net || 0} accent/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, steps }) {
  return (
    <div style={{display:'flex', gap:0, marginTop:8}}>
      {steps.map((s, i) => {
        const active = step === s.n, done = step > s.n;
        return (
          <React.Fragment key={s.n}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <div style={{
                width:22, height:22, borderRadius:'50%',
                background: done ? 'var(--accent)' : active ? 'var(--accent-soft)' : 'var(--surface-3)',
                color: done || active ? 'var(--accent-fg)' : 'var(--text-3)',
                display:'grid', placeItems:'center',
                fontSize:11, fontWeight:600,
                border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
              }}>{done ? <I.Check size={12}/> : s.n}</div>
              <span style={{fontSize:12.5, fontWeight: active || done ? 600 : 500, color: active || done ? 'var(--text)' : 'var(--text-3)'}}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div style={{flex:1, height:1, background: done ? 'var(--accent)' : 'var(--border)', margin:'0 14px'}}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function HoursCard({ label, value }) {
  return (
    <div style={{padding:12, background:'var(--surface)', borderRadius:8, border:'1px solid var(--border)'}}>
      <div style={{fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4}}>{label}</div>
      <div className="num" style={{fontSize:18, fontWeight:600}}>{NUM(value)}<span style={{fontSize:12, color:'var(--text-3)', marginLeft:2}}>h</span></div>
    </div>
  );
}

export function PayslipView({ employeeId, payslipId, go }) {
  const { refresh, can } = useStore();
  const [data, setData] = useState(null);
  useEffect(() => { api.getPayslip(payslipId).then(setData).catch(() => setData(false)); }, [payslipId]);

  if (data === null) return <div className="page"><div className="empty"><h4>Loading…</h4></div></div>;
  if (!data) return <div className="page"><div className="empty"><h4>Payslip not found</h4></div></div>;

  const remove = async () => {
    if (!confirm(`Delete payslip ${data.period_label} for ${data.first_name} ${data.last_name}? This cannot be undone.`)) return;
    try { await api.deletePayslip(data.id); refresh(); go(`#/employees/${employeeId}/payslips`); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="page fade-in" style={{paddingTop:24}}>
      <div className="no-print" style={{maxWidth:900, margin:'0 auto 16px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <button className="btn btn-ghost" onClick={() => go(`#/employees/${employeeId}/payslips`)}><I.ArrowLeft/> Back to {data.first_name}'s payslips</button>
        <div style={{display:'flex', gap:8}}>
          <a className="btn" href={`mailto:?subject=Payslip ${data.period_label}&body=Payslip for ${data.first_name} ${data.last_name}`}><I.Mail/> Email</a>
          <button className="btn" onClick={() => window.open(api.payslipPdfUrl(data.id), '_blank').print()}><I.Printer/> Print</button>
          <a className="btn btn-accent" href={api.payslipPdfUrl(data.id)} download={`payslip-${data.id}.pdf`}><I.Download/> Download PDF</a>
          {can('payslips:delete') && <button className="btn btn-danger" onClick={remove}><I.Trash/> Delete</button>}
        </div>
      </div>
      <div style={{maxWidth:900, margin:'0 auto'}}>
        <iframe title="payslip-pdf" src={api.payslipPdfUrl(data.id)} style={{
          width:'100%', height:'1100px', border:'1px solid var(--border)', borderRadius:8, background:'#fff',
        }}/>
      </div>
    </div>
  );
}
