import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader, Modal } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, fmtDate, NUM } from '../api.js';
import { payPeriodFor, shiftPayPeriod, isWithinPeriod } from '../period.js';
import { splitHoursFromTimes } from '../time-utils.js';

const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export default function AttendanceCalendar({ employee: empProp, embedded, onChange }) {
  const { employees, activeEmployees, can } = useStore();
  const canEdit = can('attendance:edit');
  // The standalone attendance screen lists only active employees in its
  // picker; the embedded view on a profile is unaffected because empProp is
  // passed in (even for inactive employees, accessed via the Employees menu).
  const [employeeId, setEmployeeId] = useState(empProp?.id || activeEmployees[0]?.id || null);
  const [employee, setEmployee] = useState(empProp || null);
  const initialAnchor = empProp ? new Date(2026, 3, 1) : new Date();
  const [period, setPeriod] = useState(() => payPeriodFor(initialAnchor));
  const [selectedDay, setSelectedDay] = useState(null);
  const [attendance, setAttendance] = useState(empProp?.attendance || []);

  useEffect(() => {
    if (!empProp) setEmployeeId(activeEmployees[0]?.id || null);
  }, [activeEmployees, empProp]);

  // Always fetch the latest data when reloading. If we reused `empProp` here
  // (the snapshot from the parent), the local attendance state would lag a
  // step behind after every save and the day editor would re-open with stale
  // lunch_start/lunch_end values, falling back to the 12:00/13:00 defaults.
  const reload = async (id = employeeId) => {
    if (!id) return;
    const emp = await api.getEmployee(id);
    setEmployee(emp);
    setAttendance(emp.attendance || []);
  };
  useEffect(() => { reload(); }, [employeeId]);
  // If the parent re-renders with a fresh empProp (e.g. after Profile reloads
  // the employee), pull the new attendance in too.
  useEffect(() => {
    if (empProp?.attendance) setAttendance(empProp.attendance);
  }, [empProp?.attendance]);

  // Build a 42-cell grid that fully contains the pay period (start of week of
  // period.start through end of week of period.end), aligned Sunday-first.
  const grid = useMemo(() => {
    const start = period.start;
    const end = period.end;
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - start.getDay()); // back to Sunday
    const cells = [];
    let d = new Date(gridStart);
    while (cells.length < 42 || d <= end) {
      cells.push({ date: new Date(d), inPeriod: d >= start && d <= end });
      d.setDate(d.getDate() + 1);
      if (cells.length >= 42 && d > end) break;
    }
    // Pad to a multiple of 7
    while (cells.length % 7 !== 0) {
      cells.push({ date: new Date(d), inPeriod: false });
      d.setDate(d.getDate() + 1);
    }
    return cells;
  }, [period]);

  const findEntry = (date) => {
    const k = toISO(date);
    return attendance.find(a => a.date === k);
  };

  // Totals scoped to the pay period (not the calendar month).
  const totals = useMemo(() => {
    let normal = 0, overtime = 0, holiday = 0, publicHoliday = 0, sick = 0, leave = 0;
    let workDays = 0, totalDaily = 0;
    for (const a of attendance) {
      if (!isWithinPeriod(a.date, period)) continue;
      if (a.type === 'normal') {
        normal += a.hours || 0;
        overtime += a.overtime || 0;
        if ((a.hours || 0) > 0) { workDays++; totalDaily += a.hours; }
      } else if (a.type === 'sunday' || a.type === 'holiday' || a.type === 'holiday_worked') {
        holiday += a.hours || 0;
      } else if (a.type === 'holiday_paid' || a.type === 'public_holiday') {
        publicHoliday += a.hours || 0;
      } else if (a.type === 'sick') {
        sick += a.hours || 0;
      } else if (a.type === 'annual' || a.type === 'unpaid') {
        leave += a.hours || 0;
      }
    }
    const avgDaily = workDays > 0 ? totalDaily / workDays : 8;
    return { normal, overtime, holiday, publicHoliday, sick, leave, avgDaily };
  }, [attendance, period]);

  const today = new Date();
  const todayPeriod = payPeriodFor(today);

  const saveEntry = async (date, patch) => {
    const k = toISO(date);
    await api.upsertAttendance(employeeId, k, patch);
    await reload();
    onChange?.();
  };
  const deleteEntry = async (date) => {
    await api.deleteAttendance(employeeId, toISO(date));
    await reload();
    onChange?.();
  };

  const [downloadOpen, setDownloadOpen] = useState(false);

  if (!employee) return <div className={embedded ? '' : 'page'}><div className="empty"><h4>No employees yet</h4></div></div>;

  return (
    <div className={embedded ? '' : 'page fade-in'}>
      {!embedded && (
        <PageHeader title="Attendance"
          subtitle="Pay period runs from the 21st of one month to the 20th of the next"
          actions={
            <>
              <button className="btn" onClick={() => setDownloadOpen(true)}><I.Download size={14}/> Download attendance</button>
              <select className="select" style={{width:220}} value={employeeId || ''} onChange={e => setEmployeeId(e.target.value)}>
                {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
              </select>
            </>
          }/>
      )}

      {!embedded && downloadOpen && (
        <DownloadAttendanceModal
          employees={activeEmployees}
          defaultEmployeeId={employeeId}
          defaultPeriod={period}
          onClose={() => setDownloadOpen(false)}/>
      )}

      <div className="grid" style={{gridTemplateColumns:'minmax(0, 1fr) 280px', gap:16}}>
        <div className="card">
          <div className="card-head">
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setPeriod(shiftPayPeriod(period, -1))}><I.ChevronLeft size={14}/></button>
              <div style={{minWidth:240}}>
                <h3 style={{margin:0}}>{period.label}</h3>
                <div style={{fontSize:11.5, color:'var(--text-3)', fontFamily:'var(--font-mono)'}}>
                  {fmtDate(period.startISO, { day:'2-digit', month:'short' })} – {fmtDate(period.endISO, { day:'2-digit', month:'short', year:'numeric' })}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setPeriod(shiftPayPeriod(period, +1))}><I.ChevronRight size={14}/></button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(todayPeriod)}>This period</button>
            </div>
            <div style={{display:'flex', gap:12, fontSize:11.5, color:'var(--text-3)'}}>
              <span style={{display:'flex', alignItems:'center', gap:5}}><span style={{width:8, height:8, background:'var(--accent)', borderRadius:2}}/>Holiday</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><span style={{width:8, height:8, background:'oklch(72% 0.15 75)', borderRadius:2}}/>Overtime</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><span style={{width:8, height:8, background:'var(--danger)', borderRadius:2}}/>Sick</span>
              <span style={{display:'flex', alignItems:'center', gap:5}}><span style={{width:8, height:8, background:'var(--info)', borderRadius:2}}/>Leave</span>
            </div>
          </div>
          <div style={{padding:14}}>
            <div className="calendar">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="cal-head">{d}</div>)}
              {grid.map((cell, i) => {
                const entry = findEntry(cell.date);
                const isSunday = cell.date.getDay() === 0;
                const isToday = cell.date.toDateString() === today.toDateString();
                const isPeriodEdge = (
                  toISO(cell.date) === period.startISO ||
                  toISO(cell.date) === period.endISO
                );
                return (
                  <div key={i}
                    className={['cal-day', !cell.inPeriod ? 'is-other' : '', isSunday ? 'is-sunday' : '', isToday ? 'is-today' : ''].join(' ')}
                    style={isPeriodEdge ? { boxShadow:'inset 0 0 0 2px var(--accent)' } : undefined}
                    onClick={() => cell.inPeriod && setSelectedDay({ date: cell.date, entry })}>
                    <div className="dnum">{cell.date.getDate()}</div>
                    {entry && cell.inPeriod && (
                      <div className="pills">
                        {entry.type === 'normal'         && entry.hours    > 0 && <span className="cal-pill normal">{entry.hours}h std</span>}
                        {entry.type === 'normal'         && entry.overtime > 0 && <span className="cal-pill overtime">+{entry.overtime}h OT</span>}
                        {(entry.type === 'holiday' || entry.type === 'holiday_worked') && <span className="cal-pill holiday">Worked hol {entry.hours}h</span>}
                        {entry.type === 'holiday_paid'                          && <span className="cal-pill holiday">Public hol {entry.hours}h</span>}
                        {entry.type === 'sunday'         && entry.hours    > 0 && <span className="cal-pill holiday">Sun {entry.hours}h</span>}
                        {entry.type === 'sick'                                  && <span className="cal-pill sick">Sick {entry.hours}h</span>}
                        {entry.type === 'annual'                                && <span className="cal-pill leave">Annual {entry.hours}h</span>}
                        {entry.type === 'unpaid'                                && <span className="cal-pill leave">Unpaid</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col" style={{gap:16}}>
          <div className="card">
            <div className="card-head">
              <h3>Period totals</h3>
              <span className="badge badge-accent">{period.label}</span>
            </div>
            <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:10}}>
              <TotalRow label="Normal hours"      value={totals.normal}        unit="h"/>
              <TotalRow label="Overtime"          value={totals.overtime}      unit="h" warn/>
              <TotalRow label="Worked holiday/Sun" value={totals.holiday}      unit="h" accent/>
              <TotalRow label="Public holiday"    value={totals.publicHoliday} unit="h"/>
              <TotalRow label="Sick leave"        value={totals.sick}          unit="h"/>
              <TotalRow label="Annual/Unpaid"     value={totals.leave}         unit="h"/>
              <hr className="divider" style={{margin:'4px 0'}}/>
              <TotalRow label="Total billable" value={totals.normal + totals.overtime + totals.holiday + totals.publicHoliday + totals.sick} unit="h" bold/>
            </div>
          </div>
          <div style={{padding:12, fontSize:11.5, color:'var(--text-3)', lineHeight:1.5, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:10}}>
            <strong style={{color:'var(--text-2)', display:'block', marginBottom:4, fontSize:12}}>Pay cycle</strong>
            Days outside the highlighted period are shown faded. Click any day within the period to log hours.
            The "This period" button jumps to whichever 21→20 cycle contains today.
          </div>
        </div>
      </div>

      {selectedDay && (
        <DayEditor
          day={selectedDay}
          employee={employee}
          avgDaily={totals.avgDaily}
          readOnly={!canEdit}
          onClose={() => setSelectedDay(null)}
          // Await the save+reload before closing the modal, otherwise a fast
          // reopen reads stale attendance state and the lunch fields revert
          // to their 12:00/13:00 defaults.
          onSave={async (patch) => { await saveEntry(selectedDay.date, patch); setSelectedDay(null); }}
          onDelete={async () => { await deleteEntry(selectedDay.date); setSelectedDay(null); }}/>
      )}
    </div>
  );
}

const TotalRow = ({ label, value, unit, bold, warn, accent }) => (
  <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
    <span style={{fontSize:12.5, color: bold ? 'var(--text)' : 'var(--text-2)', fontWeight: bold ? 600 : 400}}>{label}</span>
    <span className="num" style={{
      fontSize: bold ? 16 : 14, fontWeight: bold || accent ? 600 : 500,
      color: warn ? 'oklch(45% 0.13 75)' : accent ? 'var(--accent-fg)' : 'var(--text)',
    }}>{NUM(value, 1)}<span className="muted-2" style={{fontSize:11, marginLeft:2}}>{unit}</span></span>
  </div>
);

function DayEditor({ day, employee, onClose, onSave, onDelete, readOnly, avgDaily }) {
  // Migrate legacy 'holiday' (assumed worked) → 'holiday_worked'.
  const rawType = day.entry?.type || 'normal';
  const initialType = rawType === 'holiday' ? 'holiday_worked' : rawType;
  const initial = day.entry || { type: 'normal', start_time: '08:00', end_time: '17:00', break_min: 0, hours: 8, overtime: 0 };
  const [type, setType] = useState(initialType);
  const [start, setStart] = useState(initial.start_time || initial.start || '08:00');
  const [end, setEnd] = useState(initial.end_time || initial.end || '17:00');
  const [breakMin, setBreakMin] = useState(initial.break_min ?? initial.breakMin ?? 0);
  const [hours, setHours] = useState(initial.hours || 0);
  const [overtime, setOvertime] = useState(initial.overtime || 0);

  // Lunch break — toggle + start/end pickers. Total minutes flows back into
  // breakMin which the hours auto-split already consumes.
  const [lunchTaken, setLunchTaken] = useState(
    !!(initial.lunch_start || initial.lunch_end || (initial.break_min ?? 0) > 0),
  );
  const [lunchStart, setLunchStart] = useState(initial.lunch_start || '12:00');
  const [lunchEnd, setLunchEnd] = useState(initial.lunch_end || '13:00');

  // Recompute break_min from the lunch times whenever the toggle / times move.
  useEffect(() => {
    if (!lunchTaken) { setBreakMin(0); return; }
    const [sh, sm] = (lunchStart || '0:0').split(':').map(Number);
    const [eh, em] = (lunchEnd   || '0:0').split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    setBreakMin(Number.isFinite(mins) && mins > 0 ? mins : 0);
  }, [lunchTaken, lunchStart, lunchEnd]);

  // When the user picks Public holiday, seed the hours field with the
  // employee's average daily normal hours (the same figure used for sick pay).
  useEffect(() => {
    if (type === 'holiday_paid') {
      const avg = Number(avgDaily) > 0 ? Number(avgDaily) : 8;
      setHours(Math.round(avg * 4) / 4);
      setOvertime(0);
    }
  }, [type, avgDaily]);

  // Auto-split worked time into normal / overtime whenever times, break, or
  // type change. Normal days cap normal hours at 8 and push the rest into
  // overtime. Worked holiday / Sunday: total hours go under `hours` (paid 2×).
  useEffect(() => {
    if (type === 'normal' || type === 'sunday' || type === 'holiday_worked') {
      const split = splitHoursFromTimes({ start, end, breakMin, type });
      if (split.hours > 0 || split.overtime > 0) {
        setHours(split.hours);
        setOvertime(split.overtime);
      }
    }
  }, [start, end, breakMin, type]);

  // `busy` keeps the modal open while the parent's onSave (which now awaits
  // the server PUT + the local reload) is in flight. Stops fast double-clicks
  // from beating the round-trip and reading stale attendance state.
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave({
        type,
        start_time: start, end_time: end,
        break_min:  Number(breakMin),
        lunch_start: lunchTaken ? lunchStart : null,
        lunch_end:   lunchTaken ? lunchEnd   : null,
        hours: Number(hours),
        overtime: Number(overtime),
      });
    } finally {
      setBusy(false);
    }
  };
  const deleteWithBusy = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  };

  const usesTimes = type === 'normal' || type === 'sunday' || type === 'holiday_worked';

  return (
    <Modal open onClose={busy ? () => {} : onClose}
      title={fmtDate(day.date.toISOString(), { weekday:'long' })}
      footer={
        <>
          {day.entry && !readOnly && (
            <button className="btn btn-danger" onClick={deleteWithBusy} disabled={busy}>
              <I.Trash/> Delete
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && (
            <button className="btn btn-accent" onClick={save} disabled={busy}>
              <I.Check/> {busy ? 'Saving…' : 'Save day'}
            </button>
          )}
        </>
      }>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <div>
          <label className="label">Day type</label>
          <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6}}>
            {[
              {v:'normal',         l:'Normal'},
              {v:'sunday',         l:'Sunday'},
              {v:'holiday_worked', l:'Working holiday'},
              {v:'holiday_paid',   l:'Public holiday'},
              {v:'sick',           l:'Sick leave'},
              {v:'annual',         l:'Annual leave'},
              {v:'unpaid',         l:'Unpaid'},
            ].map(o => (
              <button key={o.v} onClick={() => setType(o.v)}
                style={{
                  padding:'8px 8px', borderRadius:8, fontSize:12,
                  border:`1px solid ${type === o.v ? 'var(--accent)' : 'var(--border)'}`,
                  background: type === o.v ? 'var(--accent-soft)' : 'var(--surface)',
                  color: type === o.v ? 'var(--accent-fg)' : 'var(--text-2)',
                  fontWeight: type === o.v ? 600 : 500, cursor:'pointer',
                }}>{o.l}</button>
            ))}
          </div>
        </div>

        {usesTimes && (
          <>
            <div className="grid grid-2">
              <div><label className="label">Start</label><input className="input" type="time" value={start} onChange={e => setStart(e.target.value)}/></div>
              <div><label className="label">End</label><input className="input" type="time" value={end} onChange={e => setEnd(e.target.value)}/></div>
            </div>

            <div style={{padding:12, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:10}}>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:500}}>
                <input type="checkbox" checked={lunchTaken}
                  onChange={e => setLunchTaken(e.target.checked)}/>
                <span>Lunch break taken</span>
              </label>
              {lunchTaken ? (
                <div className="grid grid-3" style={{gap:10, marginTop:10}}>
                  <div>
                    <label className="label">Lunch start</label>
                    <input className="input" type="time" value={lunchStart}
                      onChange={e => setLunchStart(e.target.value)}/>
                  </div>
                  <div>
                    <label className="label">Lunch end</label>
                    <input className="input" type="time" value={lunchEnd}
                      onChange={e => setLunchEnd(e.target.value)}/>
                  </div>
                  <div>
                    <label className="label">Total break</label>
                    <input className="input num" type="text" readOnly
                      value={breakMin > 0 ? `${breakMin} min` : '—'}/>
                  </div>
                </div>
              ) : (
                <div style={{marginTop:6, fontSize:11.5, color:'var(--text-3)'}}>
                  No break — full shift counts as worked time.
                </div>
              )}
            </div>
          </>
        )}

        {!usesTimes && type !== 'holiday_paid' && (
          <div>
            <label className="label">Hours</label>
            <input className="input num" type="number" step="0.25" value={hours} onChange={e => setHours(Number(e.target.value))}/>
          </div>
        )}

        {usesTimes && (
          <div className="grid grid-2">
            <div>
              <label className="label">Normal hours {type === 'normal' && <span className="muted-2" style={{fontWeight:400}}>(capped at 8 / day)</span>}</label>
              <input className="input num" type="number" step="0.25" value={hours} onChange={e => setHours(Number(e.target.value))}/>
            </div>
            <div>
              <label className="label">Overtime hours {type === 'normal' && <span className="muted-2" style={{fontWeight:400}}>(everything past 8)</span>}</label>
              <input className="input num" type="number" step="0.25" value={overtime} onChange={e => setOvertime(Number(e.target.value))}/>
            </div>
          </div>
        )}

        {type === 'holiday_paid' && (
          <div>
            <label className="label">Hours <span className="muted-2" style={{fontWeight:400}}>(avg daily normal hours)</span></label>
            <input className="input num" type="number" step="0.25" value={hours} onChange={e => setHours(Number(e.target.value))}/>
          </div>
        )}

        <div style={{padding:12, background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-3)'}}>
          {type === 'normal' && (
            <>
              Auto-split from start/end: <strong className="num" style={{color:'var(--text)'}}>{hours}h</strong> standard
              {overtime > 0 && <> + <strong className="num" style={{color:'var(--text)'}}>{overtime}h</strong> overtime</>}
              {' · '}Pay: <strong className="num" style={{color:'var(--text)'}}>R{(Number(hours) * employee.hourly_wage).toFixed(2)}</strong> standard
              {overtime > 0 && <> + <strong className="num" style={{color:'var(--text)'}}>R{(Number(overtime) * employee.hourly_wage * 1.5).toFixed(2)}</strong> overtime (1.5×)</>}
            </>
          )}
          {type === 'sunday' && <>Pay: <strong className="num" style={{color:'var(--text)'}}>R{(Number(hours) * employee.hourly_wage * 2).toFixed(2)}</strong> at double rate (2×)</>}
          {type === 'holiday_worked' && (
            <>
              Worked public holiday: <strong className="num" style={{color:'var(--text)'}}>{hours}h</strong> at double rate (2×)
              {' · '}Pay: <strong className="num" style={{color:'var(--text)'}}>R{(Number(hours) * employee.hourly_wage * 2).toFixed(2)}</strong>
            </>
          )}
          {type === 'holiday_paid' && (
            <>
              Paid public holiday — <strong className="num" style={{color:'var(--text)'}}>{hours}h</strong> at normal rate (1×)
              {' · '}Pay: <strong className="num" style={{color:'var(--text)'}}>R{(Number(hours) * employee.hourly_wage).toFixed(2)}</strong>
            </>
          )}
          {type === 'sick' && <>Sick pay = monthly avg daily hours × hourly rate</>}
          {(type === 'annual' || type === 'unpaid') && <>Leave day — pay rules apply per policy</>}
        </div>
      </div>
    </Modal>
  );
}

// Download attendance as PDF — pick employee scope + period.
function DownloadAttendanceModal({ employees, defaultEmployeeId, defaultPeriod, onClose }) {
  const [scope, setScope] = useState(defaultEmployeeId || 'all');
  const [preset, setPreset] = useState('current'); // current | last | month | custom
  const [from, setFrom] = useState(defaultPeriod?.startISO || '');
  const [to, setTo] = useState(defaultPeriod?.endISO || '');

  useEffect(() => {
    // When the user changes the preset, seed the date inputs so "custom" picks
    // up where the dropdown left off without surprises.
    if (preset !== 'custom') {
      const p = preset === 'current' ? payPeriodFor(new Date())
              : preset === 'last'    ? shiftPayPeriod(payPeriodFor(new Date()), -1)
              : monthRange(new Date());
      setFrom(p.startISO); setTo(p.endISO);
    }
  }, [preset]);

  const download = () => {
    const params = { employeeId: scope, from, to };
    const url = api.attendancePdfUrl(params);
    window.open(url, '_blank');
  };

  return (
    <Modal open onClose={onClose}
      title="Download attendance"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={download} disabled={!from || !to}>
            <I.Download size={14}/> Download PDF
          </button>
        </>
      }>
      <div className="col" style={{gap:14}}>
        <div>
          <label className="label">Who</label>
          <select className="select" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="all">All employees (combined PDF)</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Period</label>
          <select className="select" value={preset} onChange={e => setPreset(e.target.value)}>
            <option value="current">Current pay period (21st → 20th)</option>
            <option value="last">Last pay period</option>
            <option value="month">This calendar month</option>
            <option value="custom">Custom range</option>
          </select>
        </div>
        <div className="grid grid-2" style={{gap:12}}>
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from} onChange={e => { setPreset('custom'); setFrom(e.target.value); }}/>
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to} onChange={e => { setPreset('custom'); setTo(e.target.value); }}/>
          </div>
        </div>
        <div style={{padding:12, background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-3)', lineHeight:1.55}}>
          <strong style={{color:'var(--text-2)', display:'block', marginBottom:4}}>What you'll get</strong>
          A4 PDF with one page per employee. Each page lists every day in the
          range — date, day, type, start, end, break, hours, OT — followed by
          a totals row grouped by category (normal, overtime, Sunday/worked
          holiday, public holiday, sick, leave, grand total).
        </div>
      </div>
    </Modal>
  );
}

function monthRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startISO = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const endISO  = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { startISO, endISO };
}
