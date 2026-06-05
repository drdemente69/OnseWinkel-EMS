import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../components/Icons.jsx';
import { PageHeader } from '../components/Shell.jsx';
import { useStore } from '../store.jsx';
import { api, ZAR, fmtDate } from '../api.js';

// ---------------------------------------------------------------------------
// Shared helpers
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const uid = () => Math.random().toString(36).slice(2, 9);

const TYPE_META = {
  quotation: { label: 'Quotation', badge: 'badge-info' },
  invoice:   { label: 'Invoice',   badge: 'badge-accent' },
};

// Pre-made Transportation services template (services mode, no per-line price).
const TRANSPORT_TEMPLATE = {
  mode: 'services',
  itemsHeading: 'Services Included',
  scopeDescription: 'Transportation of household furniture and related items, including the secure handling of fragile goods, professionally packed, loaded, transported and off-loaded by a dedicated removals crew.',
  routeFrom: 'Alexander Bay', routeFromSub: 'Northern Cape',
  routeTo: '', routeToSub: '',
  items: [
    { id: uid(), title: 'Heavy-Duty Transport Truck', description: 'Primary haulage of household furniture & general items (single trip)' },
    { id: uid(), title: 'Bakkie with Dedicated Trailer', description: 'Separate vehicle reserved exclusively for fragile items, secured for safe transit' },
    { id: uid(), title: 'Loading & Off-Loading Personnel', description: 'Skilled removals crew for careful loading at origin and off-loading at destination' },
  ],
  terms: [
    'Quotation valid for 30 days from the date of issue.',
    '50% deposit required to confirm booking; balance on delivery.',
    'Fragile items transported separately to ensure safe handling.',
    'Dates subject to mutual confirmation and weather conditions.',
  ],
};

const VAT_RATE = 0.15;

// =========================================================================
// LIST
// =========================================================================
export function InvoicingList({ go }) {
  const { can } = useStore();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    api.listInvoices().then(r => { setRows(r); setLoading(false); });
  };
  useEffect(() => { reload(); }, []);

  const shown = rows.filter(r => filter === 'all' || r.doc_type === filter);

  const remove = async (e, r) => {
    e.stopPropagation();
    if (!confirm(`Delete ${TYPE_META[r.doc_type]?.label || 'document'} ${r.number}? This cannot be undone.`)) return;
    try { await api.deleteInvoice(r.id); reload(); }
    catch (err) { alert(err.message); }
  };

  return (
    <div className="page fade-in">
      <PageHeader title="Quotations & Invoices" subtitle={`${rows.length} document${rows.length === 1 ? '' : 's'}`}
        actions={
          can('invoices:manage') && (
            <>
              <button className="btn" onClick={() => go('#/invoices/new/quotation')}><I.Plus/> New quotation</button>
              <button className="btn btn-accent" onClick={() => go('#/invoices/new/invoice')}><I.Plus/> New invoice</button>
            </>
          )
        }/>

      <div style={{display:'flex', gap:4, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:3, marginBottom:16, width:'fit-content'}}>
        {[['all','All'],['quotation','Quotations'],['invoice','Invoices']].map(([id, lbl]) => (
          <button key={id} onClick={() => setFilter(id)} style={segBtn(filter === id)}>{lbl}</button>
        ))}
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="table">
          <thead>
            <tr><th>Number</th><th>Type</th><th>Client</th><th>Date</th><th className="right">Total</th><th className="actions"></th></tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} onClick={() => go(`#/invoices/edit/${r.id}`)} style={{cursor:'pointer'}}>
                <td><strong style={{fontSize:13}} className="num">{r.number}</strong></td>
                <td>
                  <span className={`badge ${TYPE_META[r.doc_type]?.badge || 'badge'}`}>{TYPE_META[r.doc_type]?.label || r.doc_type}</span>
                  <span className="tag" style={{marginLeft:6, textTransform:'capitalize'}}>{r.mode}</span>
                </td>
                <td>{r.client_name || <span className="muted">—</span>}</td>
                <td className="muted">{fmtDate(r.doc_date)}</td>
                <td className="right num"><strong>{ZAR(r.grand_total)}</strong></td>
                <td className="actions" onClick={e => e.stopPropagation()}>
                  <a className="btn btn-ghost btn-icon-sm" href={api.invoicePdfUrl(r.id)} target="_blank" rel="noreferrer" title="View PDF"><I.Eye size={13}/></a>
                  <a className="btn btn-ghost btn-icon-sm" href={api.invoicePdfUrl(r.id)} download title="Download"><I.Download size={13}/></a>
                  {can('invoices:manage') && <button className="btn btn-ghost btn-icon-sm" onClick={() => go(`#/invoices/edit/${r.id}`)} title="Edit"><I.Edit size={13}/></button>}
                  {can('invoices:manage') && <button className="btn btn-ghost btn-icon-sm" onClick={e => remove(e, r)} title="Delete"><I.Trash size={13}/></button>}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={6}><div className="empty" style={{padding:32}}>
                <I.Invoice size={28}/>
                <h4>No documents yet</h4>
                {can('invoices:manage')
                  ? <p>Create a quotation or invoice to get started.</p>
                  : <p>You don't have permission to create quotes or invoices.</p>}
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =========================================================================
// EDITOR
// =========================================================================
export function InvoiceEditor({ go, mode: editorMode, invoiceId, newType }) {
  const isEdit = editorMode === 'edit';
  // initial doc type from the route segment (#/invoices/new/<type>)
  const initialType = newType === 'invoice' ? 'invoice' : 'quotation';

  const [form, setForm] = useState(null);   // null until loaded
  const [items, setItems] = useState([]);
  const [terms, setTerms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedId, setSavedId] = useState(isEdit ? invoiceId : null);

  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  // ---- load (edit) or seed defaults (new) ----
  useEffect(() => {
    (async () => {
      if (isEdit && invoiceId) {
        const r = await api.getInvoice(invoiceId);
        setForm({
          docType: r.doc_type, mode: r.mode, number: r.number,
          docDate: r.doc_date, secondaryDate: r.secondary_date || '',
          clientName: r.client_name || '', clientAddress: r.client_address || '',
          includeScope: !!(r.scope_description || r.route_from || r.route_to),
          scopeDescription: r.scope_description || '',
          routeFrom: r.route_from || '', routeFromSub: r.route_from_sub || '',
          routeTo: r.route_to || '', routeToSub: r.route_to_sub || '',
          itemsHeading: r.items_heading || '',
          vatEnabled: !!r.vat_enabled,
          servicesTotal: r.mode === 'services' ? String(r.grand_total ?? '') : '',
          bankName: r.bank_name || '', bankAccountName: r.bank_account_name || '',
          bankAccountNo: r.bank_account_no || '', bankBranch: r.bank_branch || '',
          thanksTitle: r.thanks_title || '', thanksSub: r.thanks_sub || '',
        });
        setItems((r.items || []).map(it => ({ id: uid(), title: it.title || '', description: it.description || '',
          qty: it.qty != null ? String(it.qty) : '', unitPrice: it.unitPrice != null ? String(it.unitPrice) : '' })));
        setTerms((r.terms || []).slice());
      } else {
        const [num, defs] = await Promise.all([
          api.nextInvoiceNumber(initialType).catch(() => ({ number: '' })),
          api.invoiceDefaults().catch(() => ({ bank: {} })),
        ]);
        const b = defs.bank || {};
        setForm({
          docType: initialType, mode: 'services', number: num.number || '',
          docDate: today(), secondaryDate: addDays(today(), 30),
          clientName: '', clientAddress: '',
          includeScope: false,
          scopeDescription: '', routeFrom: '', routeFromSub: '', routeTo: '', routeToSub: '',
          itemsHeading: 'Services Included',
          vatEnabled: true, servicesTotal: '',
          bankName: b.bank_name || '', bankAccountName: b.bank_account_name || '',
          bankAccountNo: b.bank_account_no || '', bankBranch: b.bank_branch || '',
          thanksTitle: 'Thank you for your business', thanksSub: 'We look forward to working with you',
        });
        setItems([{ id: uid(), title: '', description: '', qty: '1', unitPrice: '' }]);
        setTerms([]);
      }
    })();
  }, [isEdit, invoiceId]);

  // When the doc type changes for a NEW doc, refresh the suggested number + secondary label default.
  const switchType = async (t) => {
    set({ docType: t });
    if (!isEdit) {
      try { const n = await api.nextInvoiceNumber(t); set({ number: n.number }); } catch {}
      // default the secondary date sensibly: quote = +30d valid, invoice = +14d due
      set({ secondaryDate: addDays(form.docDate || today(), t === 'invoice' ? 14 : 30) });
    }
  };

  const switchMode = (m) => {
    set({ mode: m, itemsHeading: m === 'products' ? 'Description' : 'Services Included' });
  };

  const applyTransportTemplate = () => {
    setForm(f => ({
      ...f,
      mode: 'services',
      itemsHeading: TRANSPORT_TEMPLATE.itemsHeading,
      includeScope: true,
      scopeDescription: TRANSPORT_TEMPLATE.scopeDescription,
      routeFrom: TRANSPORT_TEMPLATE.routeFrom, routeFromSub: TRANSPORT_TEMPLATE.routeFromSub,
      routeTo: f.routeTo || TRANSPORT_TEMPLATE.routeTo, routeToSub: f.routeToSub || TRANSPORT_TEMPLATE.routeToSub,
    }));
    setItems(TRANSPORT_TEMPLATE.items.map(it => ({ ...it, id: uid(), qty: '1', unitPrice: '' })));
    setTerms(TRANSPORT_TEMPLATE.terms.slice());
  };

  // ---- line item helpers ----
  const addItem = () => setItems(list => [...list, { id: uid(), title: '', description: '', qty: '1', unitPrice: '' }]);
  const removeItem = (id) => setItems(list => list.filter(it => it.id !== id));
  const setItem = (id, patch) => setItems(list => list.map(it => it.id === id ? { ...it, ...patch } : it));

  const addTerm = () => setTerms(t => [...t, '']);
  const setTerm = (i, v) => setTerms(t => t.map((x, j) => j === i ? v : x));
  const removeTerm = (i) => setTerms(t => t.filter((_, j) => j !== i));

  // ---- totals (live) ----
  const productsTotal = useMemo(() => {
    if (!form || form.mode !== 'products') return 0;
    return items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  }, [form, items]);

  const grand = form?.mode === 'products' ? productsTotal : (Number(form?.servicesTotal) || 0);
  const vat = form?.vatEnabled ? grand - grand / (1 + VAT_RATE) : 0;

  // ---- save ----
  const save = async (openPdf) => {
    setError(null);
    if (!form.clientName.trim()) { setError('Enter a client name.'); return; }
    if (items.filter(it => it.title.trim()).length === 0) { setError('Add at least one line item.'); return; }
    setBusy(true);
    const body = {
      docType: form.docType, mode: form.mode, number: form.number,
      docDate: form.docDate, secondaryDate: form.secondaryDate || null,
      clientName: form.clientName, clientAddress: form.clientAddress,
      scopeDescription: form.includeScope ? form.scopeDescription : '',
      routeFrom: form.includeScope ? form.routeFrom : '',
      routeFromSub: form.includeScope ? form.routeFromSub : '',
      routeTo: form.includeScope ? form.routeTo : '',
      routeToSub: form.includeScope ? form.routeToSub : '',
      itemsHeading: form.itemsHeading,
      items: items.filter(it => it.title.trim()).map(it => ({
        title: it.title, description: it.description,
        qty: it.qty, unitPrice: it.unitPrice,
      })),
      servicesTotal: form.servicesTotal,
      vatEnabled: form.vatEnabled,
      bankName: form.bankName, bankAccountName: form.bankAccountName,
      bankAccountNo: form.bankAccountNo, bankBranch: form.bankBranch,
      terms,
      thanksTitle: form.thanksTitle, thanksSub: form.thanksSub,
    };
    try {
      const saved = isEdit
        ? await api.updateInvoice(invoiceId, body)
        : await api.createInvoice(body);
      setSavedId(saved.id);
      if (openPdf) window.open(api.invoicePdfUrl(saved.id), '_blank');
      else go('#/invoices');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (!form) return <div className="page"><div className="empty"><h4>Loading…</h4></div></div>;

  const isInvoice = form.docType === 'invoice';
  const secondaryLabel = isInvoice ? 'Due date' : 'Valid until';

  return (
    <div className="page fade-in">
      <PageHeader
        title={isEdit ? `Edit ${TYPE_META[form.docType]?.label}` : `New ${TYPE_META[form.docType]?.label}`}
        subtitle={form.number}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => go('#/invoices')}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => save(true)}><I.Eye/> Save & view PDF</button>
            <button className="btn btn-accent" disabled={busy} onClick={() => save(false)}><I.Save/> {busy ? 'Saving…' : 'Save'}</button>
          </>
        }/>

      <div className="col" style={{gap:16, maxWidth:900}}>

        {/* Document */}
        <div className="card" style={{padding:18}}>
          <div className="col" style={{gap:14}}>
            <div className="grid grid-2" style={{gap:14}}>
              <Field label="Document type">
                <Segmented value={form.docType} onChange={switchType}
                  options={[['quotation','Quotation'],['invoice','Invoice']]}/>
              </Field>
              <Field label="Line-item mode" hint={form.mode === 'services' ? 'No per-line price — single total' : 'Qty × unit price per line'}>
                <Segmented value={form.mode} onChange={switchMode}
                  options={[['services','Services'],['products','Products']]}/>
              </Field>
            </div>
            <div className="grid grid-3" style={{gap:14}}>
              <Field label="Number"><input className="input" value={form.number} onChange={e => set({ number: e.target.value })}/></Field>
              <Field label="Date"><input className="input" type="date" value={form.docDate} onChange={e => set({ docDate: e.target.value })}/></Field>
              <Field label={secondaryLabel}><input className="input" type="date" value={form.secondaryDate || ''} onChange={e => set({ secondaryDate: e.target.value })}/></Field>
            </div>
          </div>
        </div>

        {/* Client */}
        <div className="card" style={{padding:18}}>
          <SectionTitle>{isInvoice ? 'Bill to' : 'Prepared for'}</SectionTitle>
          <div className="grid grid-2" style={{gap:14}}>
            <Field label="Client name"><input className="input" value={form.clientName} onChange={e => set({ clientName: e.target.value })} placeholder="Client Company (Pty) Ltd"/></Field>
            <Field label="Client address"><textarea className="textarea" rows={2} value={form.clientAddress} onChange={e => set({ clientAddress: e.target.value })} placeholder={'123 Example Street, Town\nProvince, South Africa'}/></Field>
          </div>
        </div>

        {/* Scope (optional) */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: form.includeScope ? 12 : 0}}>
            <SectionTitle style={{margin:0}}>Scope of work <span className="muted" style={{fontWeight:400, fontSize:12}}>(optional)</span></SectionTitle>
            <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer'}}>
              <input type="checkbox" checked={form.includeScope} onChange={e => set({ includeScope: e.target.checked })}/>
              Include
            </label>
          </div>
          {form.includeScope && (
            <div className="col" style={{gap:14}}>
              <Field label="Description">
                <textarea className="textarea" rows={3} value={form.scopeDescription} onChange={e => set({ scopeDescription: e.target.value })} placeholder="Summary of the work / service being quoted…"/>
              </Field>
              <div className="grid grid-4" style={{gap:12}}>
                <Field label="Route from"><input className="input" value={form.routeFrom} onChange={e => set({ routeFrom: e.target.value })} placeholder="Alexander Bay"/></Field>
                <Field label="From (sub)"><input className="input" value={form.routeFromSub} onChange={e => set({ routeFromSub: e.target.value })} placeholder="Northern Cape"/></Field>
                <Field label="Route to"><input className="input" value={form.routeTo} onChange={e => set({ routeTo: e.target.value })} placeholder="Caledon"/></Field>
                <Field label="To (sub)"><input className="input" value={form.routeToSub} onChange={e => set({ routeToSub: e.target.value })} placeholder="Western Cape"/></Field>
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <SectionTitle style={{margin:0}}>{form.mode === 'products' ? 'Products' : 'Services'}</SectionTitle>
            <div style={{display:'flex', gap:8}}>
              {form.mode === 'services' && (
                <button className="btn btn-sm" onClick={applyTransportTemplate} title="Fill with the Transportation services template">
                  <I.Sparkles size={13}/> Transportation template
                </button>
              )}
              <button className="btn btn-sm" onClick={addItem}><I.Plus size={13}/> Add {form.mode === 'products' ? 'product' : 'service'}</button>
            </div>
          </div>

          <Field label="Column heading">
            <input className="input" value={form.itemsHeading} onChange={e => set({ itemsHeading: e.target.value })} placeholder={form.mode === 'products' ? 'Description' : 'Services Included'}/>
          </Field>

          <div className="col" style={{gap:10, marginTop:14}}>
            {items.map((it, idx) => (
              <div key={it.id} style={{border:'1px solid var(--border)', borderRadius:8, padding:12, background:'var(--surface-2)'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                  <span className="muted" style={{fontSize:11.5, fontWeight:600}}>#{idx + 1}</span>
                  <button className="btn btn-ghost btn-icon-sm" onClick={() => removeItem(it.id)} title="Remove" disabled={items.length === 1}><I.X size={13}/></button>
                </div>
                <div className="col" style={{gap:8}}>
                  <input className="input" value={it.title} onChange={e => setItem(it.id, { title: e.target.value })}
                    placeholder={form.mode === 'products' ? 'Product name' : 'Service name'}/>
                  <input className="input" value={it.description} onChange={e => setItem(it.id, { description: e.target.value })}
                    placeholder="Description (optional)"/>
                  {form.mode === 'products' && (
                    <div className="grid grid-3" style={{gap:10}}>
                      <Field label="Quantity"><input className="input num" type="number" min="0" step="any" value={it.qty} onChange={e => setItem(it.id, { qty: e.target.value })}/></Field>
                      <Field label="Unit price (R)"><input className="input num" type="number" min="0" step="any" value={it.unitPrice} onChange={e => setItem(it.id, { unitPrice: e.target.value })}/></Field>
                      <Field label="Line total">
                        <div className="input num" style={{background:'var(--surface-3)', display:'flex', alignItems:'center'}}>
                          {ZAR((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="card" style={{padding:18}}>
          <SectionTitle>Totals</SectionTitle>
          <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginBottom:14}}>
            <input type="checkbox" checked={form.vatEnabled} onChange={e => set({ vatEnabled: e.target.checked })}/>
            Show VAT @ 15% (included) line
          </label>
          {form.mode === 'services' ? (
            <Field label="Total amount (VAT inclusive)" hint="Services are quoted as a single total — enter it here.">
              <input className="input num" type="number" min="0" step="any" value={form.servicesTotal}
                onChange={e => set({ servicesTotal: e.target.value })} placeholder="0.00" style={{maxWidth:240}}/>
            </Field>
          ) : (
            <div className="muted" style={{fontSize:12.5}}>Total is calculated automatically from the product lines.</div>
          )}
          <div style={{marginTop:14, borderTop:'1px solid var(--border)', paddingTop:14, display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end'}}>
            {form.vatEnabled && (
              <div style={{display:'flex', gap:24, fontSize:12.5, color:'var(--text-3)'}}>
                <span>VAT @ 15% (included)</span><span className="num" style={{minWidth:120, textAlign:'right'}}>{ZAR(vat)}</span>
              </div>
            )}
            <div style={{display:'flex', gap:24, fontSize:16, fontWeight:700, color:'var(--text)'}}>
              <span>{isInvoice ? 'Amount due' : 'Total due'}</span>
              <span className="num" style={{minWidth:120, textAlign:'right', color:'var(--accent)'}}>{ZAR(grand)}</span>
            </div>
          </div>
        </div>

        {/* Banking */}
        <div className="card" style={{padding:18}}>
          <SectionTitle>Banking details</SectionTitle>
          <div className="grid grid-2" style={{gap:14}}>
            <Field label="Bank"><input className="input" value={form.bankName} onChange={e => set({ bankName: e.target.value })}/></Field>
            <Field label="Account name"><input className="input" value={form.bankAccountName} onChange={e => set({ bankAccountName: e.target.value })}/></Field>
            <Field label="Account number"><input className="input num" value={form.bankAccountNo} onChange={e => set({ bankAccountNo: e.target.value })}/></Field>
            <Field label="Branch code"><input className="input num" value={form.bankBranch} onChange={e => set({ bankBranch: e.target.value })}/></Field>
          </div>
        </div>

        {/* Terms */}
        <div className="card" style={{padding:18}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <SectionTitle style={{margin:0}}>Terms &amp; conditions</SectionTitle>
            <button className="btn btn-sm" onClick={addTerm}><I.Plus size={13}/> Add term</button>
          </div>
          <div className="col" style={{gap:8}}>
            {terms.length === 0 && <div className="muted" style={{fontSize:12.5}}>No terms added.</div>}
            {terms.map((t, i) => (
              <div key={i} style={{display:'flex', gap:8, alignItems:'center'}}>
                <input className="input" value={t} onChange={e => setTerm(i, e.target.value)} placeholder="e.g. Quotation valid for 30 days from the date of issue."/>
                <button className="btn btn-ghost btn-icon-sm" onClick={() => removeTerm(i)}><I.X size={13}/></button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="card" style={{padding:18}}>
          <SectionTitle>Footer note</SectionTitle>
          <div className="grid grid-2" style={{gap:14}}>
            <Field label="Thanks title"><input className="input" value={form.thanksTitle} onChange={e => set({ thanksTitle: e.target.value })}/></Field>
            <Field label="Thanks subtitle"><input className="input" value={form.thanksSub} onChange={e => set({ thanksSub: e.target.value })}/></Field>
          </div>
        </div>

        {error && <div style={{padding:12, background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, fontSize:12.5}}>{error}</div>}

        <div style={{display:'flex', justifyContent:'flex-end', gap:8, paddingBottom:24}}>
          <button className="btn btn-ghost" onClick={() => go('#/invoices')}>Cancel</button>
          <button className="btn" disabled={busy} onClick={() => save(true)}><I.Eye/> Save & view PDF</button>
          <button className="btn btn-accent" disabled={busy} onClick={() => save(false)}><I.Save/> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="muted" style={{fontSize:11, marginTop:4}}>{hint}</div>}
    </div>
  );
}

function SectionTitle({ children, style }) {
  return <h3 style={{fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:12, ...style}}>{children}</h3>;
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{display:'flex', gap:4, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:8, padding:3}}>
      {options.map(([id, lbl]) => (
        <button key={id} onClick={() => onChange(id)} style={{...segBtn(value === id), flex:1}}>{lbl}</button>
      ))}
    </div>
  );
}

const segBtn = (active) => ({
  padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer',
  background: active ? 'var(--surface)' : 'transparent',
  color: active ? 'var(--text)' : 'var(--text-3)',
  fontSize:12.5, fontWeight:500,
  boxShadow: active ? 'var(--shadow-xs)' : 'none',
});
