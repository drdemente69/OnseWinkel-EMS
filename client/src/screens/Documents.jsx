import React, { useEffect, useRef, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader, Modal } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, fmtDate, fmtBytes, initials } from '../api.js';
import { FileIcon } from './Employees.jsx';

const TAGS = ['Contract','Leave','Payroll','HR','Medical','Performance','Warning'];
const TAG_COLORS = {
  Contract:'badge-info', Leave:'badge-warning', Payroll:'badge-accent', HR:'badge',
  Medical:'badge-danger', Performance:'badge-success', Warning:'badge-warning',
};

export default function DocumentsAll({ go }) {
  const { refresh, can } = useStore();
  const [docs, setDocs] = useState([]);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);

  const reload = () => api.listDocuments({ q, tag: tagFilter }).then(setDocs);
  useEffect(() => { reload(); }, [q, tagFilter]);

  const remove = async (e, d) => {
    e.stopPropagation();
    if (!confirm(`Delete ${d.name}? This cannot be undone.`)) return;
    try { await api.deleteDocument(d.id); await reload(); refresh(); }
    catch (err) { alert(err.message); }
  };

  return (
    <div className="page fade-in">
      <PageHeader title="Document vault" subtitle={`${docs.length} documents`}
        actions={
          <>
            <a className="btn" href="/api/backup/export"><I.Download/> Export ZIP</a>
            {can('documents:upload') && <button className="btn btn-accent" onClick={() => setUploadOpen(true)}><I.Upload/> Upload</button>}
          </>
        }/>

      <div style={{display:'flex', gap:8, marginBottom:16, flexWrap:'wrap'}}>
        <div className="search" style={{margin:0, maxWidth:360}}>
          <I.Search/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by file, tag, employee…"/>
        </div>
        <div style={{display:'flex', gap:4, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:3, flexWrap:'wrap'}}>
          <button onClick={() => setTagFilter('all')} style={tagBtnStyle(tagFilter === 'all')}>All</button>
          {TAGS.map(t => <button key={t} onClick={() => setTagFilter(t)} style={tagBtnStyle(tagFilter === t)}>{t}</button>)}
        </div>
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="table">
          <thead>
            <tr><th>Document</th><th>Tag</th><th>Employee</th><th>Uploaded</th><th>Size</th><th>Version</th><th className="actions"></th></tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} onClick={() => go(`#/employees/${d.employee_id}/documents`)}>
                <td>
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <FileIcon name={d.name}/>
                    <strong style={{fontSize:13}}>{d.name}</strong>
                  </div>
                </td>
                <td><span className={`badge ${TAG_COLORS[d.tag] || 'badge'}`}>{d.tag}</span></td>
                <td>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <span className="avatar avatar-sm">{initials(d.first_name, d.last_name)}</span>
                    <span>{d.first_name} {d.last_name}</span>
                  </div>
                </td>
                <td className="muted">{fmtDate(d.uploaded_at)}</td>
                <td className="num muted">{fmtBytes(d.size)}</td>
                <td><span className="tag">v{d.version}</span></td>
                <td className="actions">
                  <a className="btn btn-ghost btn-icon-sm" href={api.documentUrl(d.id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="View"><I.Eye size={13}/></a>
                  <a className="btn btn-ghost btn-icon-sm" href={api.documentUrl(d.id)} download onClick={e => e.stopPropagation()} title="Download"><I.Download size={13}/></a>
                  {can('documents:delete') && <button className="btn btn-ghost btn-icon-sm" onClick={e => remove(e, d)} title="Delete document"><I.Trash size={13}/></button>}
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td colSpan={7}><div className="empty" style={{padding:32}}>
                <I.Folder size={28}/>
                <h4>No documents yet</h4>
                {can('documents:upload')
                  ? <>
                      <p>Upload to the vault and tag against any employee.</p>
                      <button className="btn btn-accent" onClick={() => setUploadOpen(true)}><I.Upload size={13}/> Upload</button>
                    </>
                  : <p>You don't have permission to upload documents.</p>}
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => { setUploadOpen(false); reload(); refresh(); }}/>
    </div>
  );
}

function UploadModal({ open, onClose, onUploaded }) {
  // Uploads are tagged to active employees only — archived/inactive profiles
  // are kept out of this picker on purpose.
  const { activeEmployees: employees } = useStore();
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [tag, setTag] = useState('HR');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setFiles([]); setError(null);
      setEmployeeId(employees[0]?.id || '');
      setTag('HR');
    }
  }, [open, employees]);

  const upload = async () => {
    setError(null);
    if (!employeeId) { setError('Pick an employee to tag these files against.'); return; }
    if (files.length === 0) { setError('Choose at least one file.'); return; }
    setBusy(true);
    try {
      for (const f of files) await api.uploadDocument(employeeId, f, tag);
      onUploaded?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} wide
      title="Upload to vault"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={upload} disabled={busy}>
            <I.Upload/> {busy ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
          </button>
        </>
      }>
      <div className="col" style={{gap:14}}>
        <div className="grid grid-2" style={{gap:14}}>
          <div>
            <label className="label">Employee</label>
            <select className="select" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">— choose employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · #{e.employee_no}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tag</label>
            <select className="select" value={tag} onChange={e => setTag(e.target.value)}>
              {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <input ref={fileRef} type="file" multiple style={{display:'none'}}
          onChange={e => setFiles(Array.from(e.target.files || []))}/>
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); setFiles(Array.from(e.dataTransfer.files || [])); }}>
          <I.Upload/>
          <h4>{files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} ready` : 'Drop files or click to browse'}</h4>
          <p>PDF, DOC, JPG, PNG up to 20 MB each</p>
        </div>

        {files.length > 0 && (
          <div className="card" style={{overflow:'hidden'}}>
            <table className="table" style={{fontSize:12.5}}>
              <thead><tr><th>File</th><th className="right">Size</th><th></th></tr></thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{display:'flex', alignItems:'center', gap:10}}>
                        <FileIcon name={f.name}/>
                        <span>{f.name}</span>
                      </div>
                    </td>
                    <td className="right num muted">{fmtBytes(f.size)}</td>
                    <td className="actions">
                      <button className="btn btn-ghost btn-icon-sm" onClick={() => setFiles(files.filter((_, j) => j !== i))}><I.X size={13}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div style={{padding:12, background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, fontSize:12.5}}>{error}</div>}
      </div>
    </Modal>
  );
}

const tagBtnStyle = (active) => ({
  padding:'5px 10px', borderRadius:6, border:'none', cursor:'pointer',
  background: active ? 'var(--surface-3)' : 'transparent',
  color: active ? 'var(--text)' : 'var(--text-3)',
  fontSize:11.5, fontWeight:500,
});
