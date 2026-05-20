import React, { useEffect, useMemo, useRef, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, fmtDate, NUM } from '../api.js';
import { payPeriodFor, periodFromLabel } from '../period.js';
import { splitHoursFromTimes } from '../time-utils.js';

const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const pad = n => String(n).padStart(2, '0');

function periodFromISO(startISO, endISO) {
  // Best-effort label + payDate derived from the ISO bounds.
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${ms[start.getUTCMonth()]}-${ms[end.getUTCMonth()]} ${String(end.getUTCFullYear()).slice(-2)}`;
  const next = new Date(end);
  next.setUTCDate(next.getUTCDate() + 1);
  const payDate = next.toISOString().slice(0, 10);
  return { startISO, endISO, label, payDate };
}

function buildSkeleton(period) {
  const start = new Date(period.startISO + 'T00:00:00Z');
  const end = new Date(period.endISO + 'T00:00:00Z');
  const rows = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    rows.push({
      date: iso,
      day: DAY_FULL[dow],
      type: dow === 0 ? 'sunday' : 'normal',
      start: null, end: null,
      breakMin: 0,
      hours: 0, overtime: 0,
      confidence: 0,
      _needsManualEntry: true,
      _source: null,
    });
  }
  return rows;
}

// Carry data from current rows over to a new period skeleton.
function realignToPeriod(currentRows, period) {
  const skeleton = buildSkeleton(period);
  const byDate = new Map(currentRows.filter(r => r.date).map(r => [r.date, r]));
  for (const row of skeleton) {
    const m = byDate.get(row.date);
    if (m && !m._needsManualEntry) {
      Object.assign(row, m, { _needsManualEntry: m._needsManualEntry || m.confidence < 0.6 });
    }
  }
  return skeleton;
}

export default function OCRFlow({ go }) {
  const { employees } = useStore();
  const [stage, setStage] = useState('upload'); // upload | processing | review | imported
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const fileRef = useRef(null);
  const [error, setError] = useState(null);

  // Pre-scan picks.
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const defaultPeriod = useMemo(() => payPeriodFor(new Date()), []);
  const [hintMode, setHintMode] = useState('auto'); // auto | manual
  const [hintStart, setHintStart] = useState(defaultPeriod.startISO);
  const [hintEnd, setHintEnd] = useState(defaultPeriod.endISO);
  const [hintLabel, setHintLabel] = useState('');

  const start = async (file, useSample = false) => {
    setError(null);
    setStage('processing');
    setProgress(8);
    if (file) {
      const reader = new FileReader();
      reader.onload = e => setImageDataUrl(e.target.result);
      reader.readAsDataURL(file);
    } else { setImageDataUrl(null); }

    const tick = setInterval(() => setProgress(p => Math.min(p + Math.random() * 14 + 4, 92)), 350);
    try {
      const opts = { employeeId: employeeId || null, useSample };
      if (hintMode === 'manual') {
        opts.periodStart = hintStart;
        opts.periodEnd = hintEnd;
      } else if (hintLabel) {
        opts.periodLabel = hintLabel;
      }
      const r = await api.scanTimesheet(file, opts);
      clearInterval(tick);
      setProgress(100);
      setTimeout(() => {
        setResult(r);
        setStage('review');
      }, 250);
    } catch (e) {
      clearInterval(tick);
      setError(e.message);
      setStage('upload');
    }
  };

  // Patch a row. If the user changes start/end/break/type, auto-split worked
  // time into normal / overtime per the 8-hour rule. Manually editing the
  // `hours` or `overtime` fields skips the recompute so an explicit override
  // sticks. Break time defaults to 0 — only deducted when the operator
  // explicitly enters it.
  const updateRow = (i, patch) => {
    setResult(r => ({
      ...r,
      rows: r.rows.map((row, idx) => {
        if (idx !== i) return row;
        const next = { ...row, ...patch };
        const triggersRecompute = ['start', 'end', 'breakMin', 'type'].some(k => k in patch);
        const userTouchedHours = 'hours' in patch || 'overtime' in patch;
        // For paid public holidays, reset the worked-time fields.
        if ('type' in patch && (patch.type === 'holiday_paid' || patch.type === 'public_holiday')) {
          next.start = null;
          next.end = null;
          next.breakMin = 0;
          next.overtime = 0;
        }
        if (triggersRecompute && !userTouchedHours) {
          const split = splitHoursFromTimes({
            start: next.start,
            end: next.end,
            breakMin: next.breakMin || 0,
            type: next.type,
          });
          if (split.hours > 0 || split.overtime > 0) {
            next.hours = split.hours;
            next.overtime = split.overtime;
          }
        }
        return { ...next, _needsManualEntry: false, confidence: Math.max(next.confidence, 0.95) };
      }),
    }));
  };

  const overridePeriod = (period) => {
    setResult(r => ({ ...r, period, rows: realignToPeriod(r.rows, period) }));
  };

  const commit = async () => {
    if (!employeeId) { alert('Pick an employee to import into.'); return; }
    if (!result?.id) return;
    const ready = result.rows.filter(r => !r._needsManualEntry && r.date);
    if (ready.length === 0) {
      if (!confirm('No rows are confirmed yet. Import anyway?')) return;
    }
    try {
      const resp = await api.commitOCR(result.id, employeeId, result.rows);
      setResult(r => ({ ...r, _imported: resp.imported, _skipped: resp.skipped }));
      setStage('imported');
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="page fade-in">
      <PageHeader title="Timesheet OCR"
        subtitle="Convert handwritten work-hour sheets into editable attendance data"
        actions={<button className="btn btn-ghost" onClick={() => go('#/attendance')}>Go to attendance →</button>}/>

      <Stepper step={stage === 'upload' ? 1 : stage === 'processing' ? 2 : stage === 'review' ? 3 : 4}
        steps={[
          {n:1, label:'Upload image'},
          {n:2, label:'Extract'},
          {n:3, label:'Review & correct'},
          {n:4, label:'Import'},
        ]}/>

      <div style={{marginTop:24}}>
        {stage === 'upload' && (
          <UploadStage
            employees={employees}
            employeeId={employeeId} setEmployeeId={setEmployeeId}
            hintMode={hintMode} setHintMode={setHintMode}
            hintStart={hintStart} setHintStart={setHintStart}
            hintEnd={hintEnd} setHintEnd={setHintEnd}
            hintLabel={hintLabel} setHintLabel={setHintLabel}
            defaultPeriod={defaultPeriod}
            fileRef={fileRef}
            start={start}
            error={error}/>
        )}

        {stage === 'processing' && <ProcessingStage progress={progress}/>}

        {stage === 'review' && result && (
          <ReviewStage
            result={result}
            imageDataUrl={imageDataUrl}
            employees={employees}
            employeeId={employeeId} setEmployeeId={setEmployeeId}
            updateRow={updateRow}
            overridePeriod={overridePeriod}
            onRestart={() => { setStage('upload'); setResult(null); }}
            onCommit={commit}/>
        )}

        {stage === 'imported' && (
          <div className="card card-pad" style={{maxWidth:560, margin:'0 auto', textAlign:'center', padding:48}}>
            <div style={{display:'inline-flex', width:64, height:64, borderRadius:16, background:'var(--success-soft)', color:'var(--success)', alignItems:'center', justifyContent:'center', marginBottom:16}}>
              <I.CheckCircle size={32}/>
            </div>
            <h2 style={{margin:0, fontSize:22, fontWeight:600}}>Timesheet imported</h2>
            <p style={{color:'var(--text-3)', marginTop:8, lineHeight:1.5}}>
              {result._imported} attendance entries written
              {result._skipped > 0 && <> · {result._skipped} skipped (still needed manual entry)</>}.<br/>
              {result.period && <>Period: <strong style={{color:'var(--text)'}}>{result.period.label}</strong> ({fmtDate(result.period.startISO)} – {fmtDate(result.period.endISO)})</>}
            </p>
            <div style={{display:'flex', gap:8, justifyContent:'center', marginTop:20}}>
              <button className="btn" onClick={() => go('#/attendance')}>View attendance</button>
              <button className="btn btn-accent" onClick={() => go('#/payslips/new')}><I.Receipt/> Generate payslip</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Upload stage ----------
function UploadStage({
  employees, employeeId, setEmployeeId,
  hintMode, setHintMode, hintStart, setHintStart, hintEnd, setHintEnd, hintLabel, setHintLabel,
  defaultPeriod, fileRef, start, error,
}) {
  // Live preview of the manually-entered label / range.
  const previewLabel = (() => {
    if (hintMode === 'manual') return periodFromISO(hintStart, hintEnd).label;
    if (hintLabel) {
      const p = periodFromLabel(hintLabel);
      return p?.label || '—';
    }
    return 'Auto-detect from the sheet';
  })();

  return (
    <div className="card card-pad" style={{maxWidth:760, margin:'0 auto'}}>
      <div style={{textAlign:'center', marginBottom:18}}>
        <div style={{display:'inline-flex', width:56, height:56, borderRadius:14, background:'var(--accent-soft)', color:'var(--accent-fg)', alignItems:'center', justifyContent:'center', marginBottom:14}}>
          <I.ScanText size={26}/>
        </div>
        <h2 style={{margin:0, fontSize:20, fontWeight:600}}>Upload a handwritten timesheet</h2>
        <p style={{color:'var(--text-3)', fontSize:13.5, marginTop:6, marginBottom:0}}>
          The OCR engine will preprocess the image, extract dates and hours, and let you fix anything before importing.
        </p>
      </div>

      <div className="grid grid-2" style={{gap:14, marginBottom:14}}>
        <div>
          <label className="label">Employee</label>
          <select className="select" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">— choose employee —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Pay period</label>
          <select className="select" value={hintMode} onChange={e => setHintMode(e.target.value)}>
            <option value="auto">Auto-detect from sheet</option>
            <option value="manual">Pick manually</option>
          </select>
        </div>
      </div>

      {hintMode === 'manual' ? (
        <div style={{padding:14, background:'var(--surface-2)', borderRadius:10, border:'1px solid var(--border)', marginBottom:14}}>
          <div className="grid grid-3" style={{gap:14}}>
            <div>
              <label className="label">Start (21st of month)</label>
              <input className="input" type="date" value={hintStart} onChange={e => setHintStart(e.target.value)}/>
            </div>
            <div>
              <label className="label">End (20th of next month)</label>
              <input className="input" type="date" value={hintEnd} onChange={e => setHintEnd(e.target.value)}/>
            </div>
            <div>
              <label className="label">Or quick-select</label>
              <select className="select" value={`${hintStart}|${hintEnd}`} onChange={e => {
                const [a, b] = e.target.value.split('|');
                setHintStart(a); setHintEnd(b);
              }}>
                {generateRecentPeriods().map(p => (
                  <option key={p.startISO} value={`${p.startISO}|${p.endISO}`}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{marginTop:10, fontSize:12.5, color:'var(--text-3)'}}>
            Selected: <strong className="num" style={{color:'var(--text-2)'}}>{previewLabel}</strong>
            {' · '}
            Payday <strong className="num" style={{color:'var(--text-2)'}}>{periodFromISO(hintStart, hintEnd).payDate}</strong>
          </div>
        </div>
      ) : (
        <div style={{padding:14, background:'var(--surface-2)', borderRadius:10, border:'1px solid var(--border)', marginBottom:14}}>
          <label className="label">Period hint (optional, e.g. "Mar-April 26")</label>
          <input className="input" placeholder="Leave blank to read from the sheet"
            value={hintLabel} onChange={e => setHintLabel(e.target.value)}/>
          <div style={{marginTop:8, fontSize:12.5, color:'var(--text-3)'}}>
            Resolves to: <strong className="num" style={{color:'var(--text-2)'}}>{previewLabel}</strong>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
        onChange={e => e.target.files[0] && start(e.target.files[0])}/>
      <div className="dropzone" onClick={() => fileRef.current.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) start(e.dataTransfer.files[0]); }}>
        <I.Upload/>
        <h4>Drop a photo or scan</h4>
        <p>JPG, PNG, HEIC up to 20 MB · Mobile photos work fine</p>
      </div>
      <div style={{textAlign:'center', marginTop:14}}>
        <button className="btn btn-ghost btn-sm" onClick={() => start(null, true)}>
          <I.Sparkles size={13}/> Use sample timesheet
        </button>
      </div>
      {error && <div style={{marginTop:14, padding:12, background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, fontSize:13}}>{error}</div>}

      <div style={{marginTop:18, padding:14, background:'var(--surface-2)', borderRadius:10, fontSize:12.5, color:'var(--text-3)', lineHeight:1.55}}>
        <strong style={{color:'var(--text-2)', display:'block', marginBottom:4}}>Tips for best results</strong>
        • Lay the sheet flat in good lighting; fill the frame with the timesheet only<br/>
        • Print neatly inside each cell; avoid heavy strikethroughs<br/>
        • Any row the OCR can't read is marked <strong style={{color:'var(--danger)'}}>Needs manual entry</strong> for you to fill in
      </div>
    </div>
  );
}

function generateRecentPeriods() {
  const out = [];
  const today = new Date();
  for (let i = -1; i <= 5; i++) {
    const anchor = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    const p = payPeriodFor(anchor);
    out.push({ startISO: p.startISO, endISO: p.endISO, label: p.label });
  }
  // Dedupe by startISO
  const seen = new Set();
  return out.filter(p => seen.has(p.startISO) ? false : seen.add(p.startISO));
}

// ---------- Processing stage ----------
function ProcessingStage({ progress }) {
  return (
    <div className="card card-pad" style={{maxWidth:720, margin:'0 auto', textAlign:'center', padding:48}}>
      <div style={{position:'relative', width:80, height:80, margin:'0 auto 18px'}}>
        <svg viewBox="0 0 80 80" width="80" height="80" style={{transform:'rotate(-90deg)'}}>
          <circle cx="40" cy="40" r="34" stroke="var(--surface-3)" strokeWidth="6" fill="none"/>
          <circle cx="40" cy="40" r="34" stroke="var(--accent)" strokeWidth="6" fill="none"
            strokeDasharray={2 * Math.PI * 34}
            strokeDashoffset={(1 - progress/100) * 2 * Math.PI * 34}
            strokeLinecap="round"
            style={{transition:'stroke-dashoffset 220ms ease'}}/>
        </svg>
        <div className="num" style={{position:'absolute', inset:0, display:'grid', placeItems:'center', fontSize:18, fontWeight:600}}>
          {Math.round(progress)}%
        </div>
      </div>
      <h2 style={{margin:0, fontSize:18, fontWeight:600}}>Reading your timesheet…</h2>
      <p style={{color:'var(--text-3)', fontSize:13, marginTop:6}}>
        {progress < 30 && 'Preprocessing the image'}
        {progress >= 30 && progress < 60 && 'Recognising handwritten digits'}
        {progress >= 60 && progress < 90 && 'Detecting period and parsing rows'}
        {progress >= 90 && 'Aligning to the pay period…'}
      </p>
    </div>
  );
}

// ---------- Review stage ----------
function ReviewStage({ result, imageDataUrl, employees, employeeId, setEmployeeId, updateRow, overridePeriod, onRestart, onCommit }) {
  const [periodEditOpen, setPeriodEditOpen] = useState(false);
  const period = result.period;
  const rows = result.rows;
  const needsManual = rows.filter(r => r._needsManualEntry).length;
  const lowConf = rows.filter(r => !r._needsManualEntry && r.confidence < 0.85).length;
  const totalHours = rows.reduce((a, r) => a + (Number(r.hours) || 0) + (Number(r.overtime) || 0), 0);
  const otHours = rows.reduce((a, r) => a + (Number(r.overtime) || 0), 0);

  return (
    <div className="grid" style={{gridTemplateColumns:'1fr 1.6fr', gap:16}}>
      <div className="card">
        <div className="card-head">
          <h3>Original image</h3>
          <span className="badge">Preserved with payslip</span>
        </div>
        <div style={{padding:14}}>
          <div style={{borderRadius:10, background:'var(--surface-2)', border:'1px solid var(--border)', overflow:'hidden', aspectRatio:'3/4', display:'grid', placeItems:'center'}}>
            {imageDataUrl ? <img src={imageDataUrl} style={{width:'100%', height:'100%', objectFit:'contain'}}/> : <FakeTimesheetSample/>}
          </div>
        </div>
        <div style={{padding:'0 14px 14px', display:'flex', flexDirection:'column', gap:10, fontSize:12.5}}>
          <RowStat label="Employee detected" value={result.employeeName || '—'}/>
          <RowStat label="Period" value={period?.label || 'Not detected'} action={
            <button className="btn btn-ghost btn-sm" onClick={() => setPeriodEditOpen(o => !o)}>
              <I.Edit size={12}/> Override
            </button>
          }/>
          {period && (
            <>
              <RowStat label="Range" value={`${fmtDate(period.startISO)} – ${fmtDate(period.endISO)}`}/>
              <RowStat label="Pay date" value={period.payDate ? fmtDate(period.payDate) : '—'}/>
            </>
          )}
          <RowStat label="OCR confidence" value={<strong style={{color: result.overallConfidence > 0.7 ? 'var(--success)' : 'var(--warning)'}}>{Math.round((result.overallConfidence || 0)*100)}%</strong>}/>
          {needsManual > 0 && (
            <div style={{padding:10, background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, display:'flex', gap:8, alignItems:'flex-start'}}>
              <I.AlertCircle size={14} style={{flexShrink:0, marginTop:2}}/>
              <span><strong>{needsManual}</strong> row{needsManual === 1 ? '' : 's'} couldn't be read — fill them in below.</span>
            </div>
          )}
        </div>

        {periodEditOpen && (
          <PeriodOverridePanel
            period={period}
            onApply={(p) => { overridePeriod(p); setPeriodEditOpen(false); }}
            onClose={() => setPeriodEditOpen(false)}/>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Extracted entries</h3>
            <span className="sub">
              {needsManual > 0 && <span style={{color:'var(--danger)'}}><strong>{needsManual}</strong> need manual entry</span>}
              {needsManual > 0 && lowConf > 0 && ' · '}
              {lowConf > 0 && <span style={{color:'oklch(45% 0.13 75)'}}><strong>{lowConf}</strong> need review</span>}
              {!needsManual && !lowConf && <span style={{color:'var(--success)'}}>All rows look good</span>}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onRestart}>
            <I.RefreshCw size={13}/> Restart
          </button>
        </div>
        <div style={{padding:'10px 14px', display:'flex', gap:10, alignItems:'center', borderBottom:'1px solid var(--border)', flexWrap:'wrap'}}>
          <span style={{fontSize:12, color:'var(--text-3)'}}>Import into:</span>
          <select className="select" style={{maxWidth:240}} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">— choose employee —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div style={{overflow:'auto', maxHeight:560}}>
          <table className="table" style={{fontSize:12}}>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Start</th><th>End</th>
                <th className="right">Break</th>
                <th className="right">Hrs</th><th className="right">OT</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => <Row key={r.date || i} row={r} index={i} updateRow={updateRow}/>)}
            </tbody>
          </table>
        </div>
        <div style={{padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:12.5, color:'var(--text-3)'}}>
            Total: <strong className="num" style={{color:'var(--text)'}}>{NUM(totalHours, 1)} h</strong>
            {' · '}OT: <strong className="num" style={{color:'var(--text)'}}>{NUM(otHours, 1)} h</strong>
            {' · '}{rows.filter(r => !r._needsManualEntry).length} / {rows.length} rows ready
          </div>
          <button className="btn btn-accent" onClick={onCommit}><I.Check/> Import to attendance</button>
        </div>
      </div>
    </div>
  );
}

function Row({ row, index, updateRow }) {
  const needs = row._needsManualEntry;
  const lowConf = !needs && row.confidence < 0.85;
  const bg = needs
    ? 'oklch(from var(--danger) 96% 0.03 25 / 0.55)'
    : lowConf ? 'oklch(from var(--warning) 96% 0.04 75 / 0.5)'
    : undefined;
  const usesTimes = row.type === 'normal' || row.type === 'sunday' || row.type === 'holiday' || row.type === 'holiday_worked';
  return (
    <tr style={{background:bg}}>
      <td>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          {needs && <I.AlertCircle size={12} color="var(--danger)"/>}
          <div>
            <div><strong>{row.day || '—'}</strong></div>
            <div className="muted" style={{fontSize:11}}>{row.date || '—'}</div>
          </div>
        </div>
      </td>
      <td>
        <select className="select" style={{height:28, fontSize:11.5, minWidth:140}} value={row.type === 'holiday' ? 'holiday_worked' : row.type} onChange={e => updateRow(index, { type: e.target.value })}>
          <option value="normal">Normal</option>
          <option value="sunday">Sunday</option>
          <option value="holiday_worked">Working holiday</option>
          <option value="holiday_paid">Public holiday</option>
          <option value="sick">Sick</option>
          <option value="annual">Annual</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </td>
      <td>
        <input className="input num" type="time" disabled={!usesTimes}
          style={{height:28, fontSize:11.5, opacity: usesTimes ? 1 : 0.5}}
          value={row.start || ''} onChange={e => updateRow(index, { start: e.target.value })}/>
      </td>
      <td>
        <input className="input num" type="time" disabled={!usesTimes}
          style={{height:28, fontSize:11.5, opacity: usesTimes ? 1 : 0.5}}
          value={row.end || ''} onChange={e => updateRow(index, { end: e.target.value })}/>
      </td>
      <td className="right">
        <input className="input num" type="number" min="0" step="5" disabled={!usesTimes}
          style={{height:28, fontSize:11.5, textAlign:'right', width:64, opacity: usesTimes ? 1 : 0.5}}
          value={row.breakMin ?? 0} onChange={e => updateRow(index, { breakMin: Number(e.target.value) })}/>
      </td>
      <td className="right">
        <input className="input num" type="number" step="0.25" style={{height:28, fontSize:11.5, textAlign:'right', width:64}} value={row.hours} onChange={e => updateRow(index, { hours: Number(e.target.value) })}/>
      </td>
      <td className="right">
        <input className="input num" type="number" step="0.25" disabled={!usesTimes && row.type !== 'normal'}
          style={{height:28, fontSize:11.5, textAlign:'right', width:64, opacity: usesTimes ? 1 : 0.5}}
          value={row.overtime} onChange={e => updateRow(index, { overtime: Number(e.target.value) })}/>
      </td>
      <td>
        {needs
          ? <span className="badge badge-danger" title="OCR could not read this row"><I.AlertCircle size={11}/> Manual</span>
          : lowConf
            ? <span className="badge badge-warning" title="Low confidence"><I.AlertCircle size={11}/> {Math.round(row.confidence * 100)}%</span>
            : <I.CheckCircle size={14} color="var(--success)"/>}
      </td>
    </tr>
  );
}

// ---------- Period override panel (inside review stage) ----------
function PeriodOverridePanel({ period, onApply, onClose }) {
  const [start, setStart] = useState(period?.startISO || '');
  const [end, setEnd] = useState(period?.endISO || '');
  const [label, setLabel] = useState('');

  const applyLabel = () => {
    const p = periodFromLabel(label);
    if (p) { setStart(p.startISO); setEnd(p.endISO); }
    else { alert(`Couldn't parse "${label}". Try a format like "Mar-April 26".`); }
  };
  const apply = () => {
    if (!start || !end) return;
    const next = periodFromISO(start, end);
    onApply(next);
  };

  return (
    <div style={{padding:14, borderTop:'1px solid var(--border)', background:'var(--surface-2)'}}>
      <div style={{fontSize:12.5, color:'var(--text-2)', fontWeight:600, marginBottom:8}}>Override pay period</div>
      <div style={{display:'flex', gap:6, marginBottom:10}}>
        <input className="input" placeholder='e.g. "Mar-April 26"' value={label} onChange={e => setLabel(e.target.value)} style={{flex:1, height:30, fontSize:12}}/>
        <button className="btn btn-sm" onClick={applyLabel}>Parse</button>
      </div>
      <div className="grid grid-2" style={{gap:8, marginBottom:10}}>
        <div><label className="label">Start</label><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)}/></div>
        <div><label className="label">End</label><input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)}/></div>
      </div>
      <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent btn-sm" onClick={apply}><I.Check size={13}/> Apply & re-align</button>
      </div>
    </div>
  );
}

// ---------- Small UI helpers ----------
const RowStat = ({ label, value, action }) => (
  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
    <span className="muted">{label}:</span>
    <div style={{display:'flex', alignItems:'center', gap:8}}>
      <strong style={{fontWeight:600, fontSize:12.5}}>{value}</strong>
      {action}
    </div>
  </div>
);

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

const FakeTimesheetSample = () => (
  <div style={{width:'100%', height:'100%', padding:20, background:'#faf6e8', color:'#3a3527', fontFamily:'Caveat, "Comic Sans MS", cursive', position:'relative'}}>
    <div style={{textAlign:'center', fontSize:18, fontWeight:600, marginBottom:12, borderBottom:'2px solid #3a3527', paddingBottom:6}}>
      WEEKLY TIMESHEET
    </div>
    <div style={{fontSize:12, marginBottom:10}}>Name: <u>Cedrick Fredericks</u> &nbsp; Period: <u>Mar-April 26</u></div>
    <table style={{width:'100%', fontSize:11, borderCollapse:'collapse'}}>
      <thead>
        <tr style={{borderBottom:'1.5px solid #3a3527'}}>
          <th style={{padding:4, textAlign:'left'}}>Day</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>OT</th>
        </tr>
      </thead>
      <tbody>
        {[['Mon','13/4','8:00','17:00','8','0'],['Tue','14/4','8:00','17:00','8','0'],
          ['Wed','15/4','7:30','18:00','8','1½'],['Thu','16/4','8:00','17:00','8','0'],
          ['Fri','17/4','8:00','17:30','8','½'],['Sat','18/4','8:00','13:00','5','0'],
          ['Sun','19/4','9:00','17:00','7','0'],['Mon','20/4','8:00','17:00','8','0']].map((r, i) => (
          <tr key={i} style={{borderBottom:'1px dotted #6a624a'}}>
            {r.map((c, j) => <td key={j} style={{padding:'5px 4px', fontSize:13, textAlign: j > 0 ? 'center' : 'left'}}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
    <div style={{position:'absolute', bottom:20, right:24, fontSize:14, transform:'rotate(-3deg)'}}>
      Signed: <span style={{borderBottom:'1px solid #3a3527', paddingBottom:2}}>C. Fredericks</span>
    </div>
  </div>
);
