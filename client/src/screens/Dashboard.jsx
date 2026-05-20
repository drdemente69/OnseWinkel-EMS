import React, { useEffect, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { api, ZAR, NUM, initials, fmtDate } from '../api.js';

const BarChart = ({ data, labels, height = 220, color = 'var(--accent)' }) => {
  const width = 600;
  const padL = 40, padR = 16, padT = 16, padB = 28;
  const w = width - padL - padR, h = height - padT - padB;
  const max = Math.max(...data, 1);
  const niceMax = Math.ceil(max / 1000) * 1000 || 1000;
  const bw = w / data.length * 0.65;
  const gap = w / data.length * 0.35;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <g className="chart-grid">
        {[0, 0.25, 0.5, 0.75, 1].map(t => <line key={t} x1={padL} x2={width-padR} y1={padT + h * (1-t)} y2={padT + h * (1-t)}/>)}
      </g>
      <g className="chart-axis">
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <text key={t} x={padL - 8} y={padT + h * (1-t) + 4} textAnchor="end">
            {Math.round(niceMax * t / 1000)}k
          </text>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={padL + (i + 0.5) * (w / data.length)} y={height - 10} textAnchor="middle">{l}</text>
        ))}
      </g>
      {data.map((v, i) => {
        const bh = (v / niceMax) * h;
        return <rect key={i}
          x={padL + i * (w / data.length) + gap/2}
          y={padT + h - bh}
          width={bw}
          height={Math.max(bh, 0)}
          rx="3"
          fill={color}/>;
      })}
    </svg>
  );
};

const HoursRow = ({ label, value, max, color }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12.5}}>
        <span style={{color:'var(--text-2)'}}>{label}</span>
        <span className="num" style={{fontWeight:500}}>{NUM(value)} h</span>
      </div>
      <div style={{height:6, borderRadius:99, background:'var(--surface-3)', overflow:'hidden'}}>
        <div style={{width:`${pct}%`, height:'100%', background:color, borderRadius:99}}/>
      </div>
    </div>
  );
};

const QuickAction = ({ icon, label, sub, onClick }) => (
  <button onClick={onClick} className="quick-action" style={{
    display:'flex', alignItems:'flex-start', gap:10, padding:14, borderRadius:10,
    border:'1px solid var(--border)', background:'var(--surface)', textAlign:'left', cursor:'pointer', color:'var(--text)',
  }}>
    <span style={{width:32, height:32, borderRadius:7, background:'var(--accent-soft)', color:'var(--accent-fg)', display:'grid', placeItems:'center'}}>{icon}</span>
    <div>
      <div style={{fontSize:13, fontWeight:600}}>{label}</div>
      <div style={{fontSize:11.5, color:'var(--text-3)', marginTop:2}}>{sub}</div>
    </div>
  </button>
);

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="page"><div className="empty"><h4>Loading…</h4></div></div>;

  const totalHours = Object.values(data.hoursBreakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="page fade-in">
      <PageHeader title="Dashboard"
        subtitle={new Date().toLocaleDateString('en-ZA', { month:'long', year:'numeric' }) + ' · Pay period in progress'}
        actions={
          <>
            <a className="btn" href="/api/backup/export"><I.Download/> Export</a>
            <button className="btn btn-accent" onClick={() => go('#/payslips/new')}><I.Plus/> New Payslip</button>
          </>
        }/>

      <div className="grid grid-4" style={{marginBottom:16}}>
        <div className="stat">
          <div className="stat-label"><I.Users size={14}/> Active employees</div>
          <div className="stat-value num">{data.stats.activeCount}</div>
          <div className="stat-meta">{data.stats.totalCount} total profiles</div>
        </div>
        <div className="stat">
          <div className="stat-label"><I.DollarSign size={14}/> Latest period payroll</div>
          <div className="stat-value num">{ZAR(data.stats.currentPeriod)}</div>
          <div className="stat-meta">Most recent payslip per employee</div>
        </div>
        <div className="stat">
          <div className="stat-label"><I.TrendingUp size={14}/> YTD payroll</div>
          <div className="stat-value num">{ZAR(data.stats.totalYTD)}</div>
          <div className="stat-meta">Tax year 2025/26</div>
        </div>
        <div className="stat">
          <div className="stat-label"><I.AlertCircle size={14}/> Awaiting approval</div>
          <div className="stat-value num">0</div>
          <div className="stat-meta">All payslips finalised</div>
        </div>
      </div>

      <div className="grid" style={{gridTemplateColumns:'2fr 1fr', marginBottom:16}}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Payroll trend</h3>
              <div className="sub">Gross payroll · last 8 months</div>
            </div>
          </div>
          <div className="card-pad" style={{paddingTop:8}}>
            <BarChart data={data.months.map(m => m.value)} labels={data.months.map(m => m.label)}/>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Hours breakdown</h3><span className="badge">This month</span></div>
          <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:14}}>
            <HoursRow label="Standard"             value={data.hoursBreakdown.normal}        max={Math.max(totalHours,1)} color="var(--text)"/>
            <HoursRow label="Overtime"             value={data.hoursBreakdown.overtime}      max={Math.max(totalHours,1)} color="oklch(72% 0.15 75)"/>
            <HoursRow label="Sunday & worked hol." value={data.hoursBreakdown.holiday}       max={Math.max(totalHours,1)} color="var(--accent)"/>
            <HoursRow label="Public holiday"       value={data.hoursBreakdown.publicHoliday || 0} max={Math.max(totalHours,1)} color="oklch(60% 0.16 270)"/>
            <HoursRow label="Sick"                 value={data.hoursBreakdown.sick}          max={Math.max(totalHours,1)} color="var(--danger)"/>
            <HoursRow label="Annual leave"         value={data.hoursBreakdown.leave}         max={Math.max(totalHours,1)} color="var(--info)"/>
            <hr className="divider" style={{margin:'2px 0'}}/>
            <div style={{display:'flex', justifyContent:'space-between'}}>
              <span style={{fontSize:13, color:'var(--text-2)'}}>Total billed hours</span>
              <strong className="num" style={{fontSize:14}}>{NUM(totalHours)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{marginBottom:16}}>
        <div className="card">
          <div className="card-head">
            <h3>Recent payslips</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => go('#/payslips')}>View all <I.ArrowRight size={12}/></button>
          </div>
          <table className="table">
            <thead><tr><th>Employee</th><th>Period</th><th className="right">Gross</th><th className="right">Net</th></tr></thead>
            <tbody>
              {data.recentPayslips.map(p => (
                <tr key={p.id} onClick={() => go(`#/payslips/view/${p.employee_id}/${p.id}`)}>
                  <td>
                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                      <span className="avatar avatar-sm">{initials(p.first_name, p.last_name)}</span>
                      <div style={{lineHeight:1.25}}>
                        <div style={{fontWeight:500}}>{p.first_name} {p.last_name}</div>
                        <div style={{fontSize:11.5, color:'var(--text-3)'}}>{p.position}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="muted">{p.period_label}</span></td>
                  <td className="right num">{ZAR(p.gross)}</td>
                  <td className="right num">{ZAR(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent documents</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => go('#/documents')}>View all <I.ArrowRight size={12}/></button>
          </div>
          <div style={{padding:'4px 0'}}>
            {data.recentDocs.map(d => (
              <div key={d.id} onClick={() => go(`#/employees/${d.employee_id}/documents`)}
                style={{display:'flex', alignItems:'center', gap:12, padding:'10px 18px', borderBottom:'1px solid var(--border)', cursor:'pointer'}}>
                <div style={{width:32, height:32, borderRadius:6, background:'var(--surface-3)', display:'grid', placeItems:'center', color:'var(--text-3)'}}>
                  <I.FileText size={14}/>
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.name}</div>
                  <div style={{fontSize:11.5, color:'var(--text-3)'}}>{d.first_name} {d.last_name} · {fmtDate(d.uploaded_at)}</div>
                </div>
                <span className="tag">{d.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Upcoming anniversaries</h3></div>
          <div className="card-pad" style={{display:'flex', flexDirection:'column', gap:12}}>
            {data.anniversaries.map(a => (
              <div key={a.employee_id} style={{display:'flex', alignItems:'center', gap:12}}>
                <span className="avatar">{initials(a.first_name, a.last_name)}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:500}}>{a.first_name} {a.last_name}</div>
                  <div style={{fontSize:11.5, color:'var(--text-3)'}}>{a.yearsAtCompany}-year mark · {fmtDate(a.next)}</div>
                </div>
                <span className="badge badge-accent"><I.Cake size={12}/> {a.daysAway}d away</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Quick actions</h3></div>
          <div className="card-pad">
            <div className="grid grid-2" style={{gap:10}}>
              <QuickAction icon={<I.Plus/>}    label="Add employee"    sub="New profile + contract" onClick={() => go('#/employees/new')}/>
              <QuickAction icon={<I.Receipt/>} label="Generate payslip" sub="Auto-calc from hours"   onClick={() => go('#/payslips/new')}/>
              <QuickAction icon={<I.ScanText/>}label="Scan timesheet"   sub="OCR handwritten hours"  onClick={() => go('#/ocr')}/>
              <QuickAction icon={<I.Database/>}label="Backup database"  sub="Export to .json"        onClick={() => go('#/settings')}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
