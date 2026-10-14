import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, serverTimestamp, Timestamp, writeBatch, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { col, query, where, useLive, addNotify, addAudit, timelineEntry } from '../../lib/db.js';
import { isReviewer } from '../../lib/roles.js';
import { useUsers } from '../../lib/users.js';
import { fmtDate, fromInputDate, isOverdue, toDate, toInputDate, relative } from '../../lib/dates.js';
import { consolidate, STANDARD_TEMPLATES } from '../../lib/reportTemplates.js';
import { toCSV, download } from '../../lib/csv.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Stat, Tabs, useAction } from '../../components/ui.jsx';
import { bcol, bdoc } from '../../lib/db.js';

export function reportState(r) {
  if (['pending', 'revision'].includes(r.status) && isOverdue(r.dueDate)) return 'overdue';
  return r.status;
}
const STATE_LABEL = { pending: 'Pending', revision: 'Revision requested', submitted: 'Submitted', reviewed: 'Reviewed', overdue: 'Overdue' };

export function ReportList({ rows, showLeader = true, empty }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty title={empty || 'No reports'} />;
  return (
    <ul className="list">{rows.map((r) => {
      const st = reportState(r);
      return (
        <li key={r.id} className="list-item clickable" onClick={() => nav(`/reports/${r.id}`)}>
          <div className="list-main">
            <div className="list-title">{r.templateName} — {r.period}</div>
            <div className="list-meta">{r.ministryName}{showLeader ? ` · ${r.leaderName}` : ''} · due {fmtDate(r.dueDate)} ({relative(r.dueDate)})</div>
          </div>
          <Badge status={st}>{STATE_LABEL[st]}</Badge>
        </li>
      );
    })}</ul>
  );
}

const byDue = (a, b) => (toDate(a.dueDate) || 0) - (toDate(b.dueDate) || 0);

export default function Reports() {
  const { profile } = useAuth();
  const reviewer = isReviewer(profile);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (reviewer ? 'all' : 'mine');
  const setTab = (t) => setParams({ tab: t });
  const mine = useLive(() => query(col('reports'), where('leaderUid', '==', profile.uid)), [profile.uid]);
  const all = useLive(() => reviewer ? col('reports') : null, [reviewer]);
  const templates = useLive(() => col('reportTemplates'), []);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState('attention');

  const allRows = useMemo(() => all.data.filter((r) => {
    const st = reportState(r);
    if (status === 'attention') return ['submitted', 'overdue'].includes(st);
    if (status === 'all') return true;
    return st === status;
  }).sort(byDue), [all.data, status]);

  const counts = useMemo(() => {
    const c = { pending: 0, submitted: 0, overdue: 0, reviewed: 0, revision: 0 };
    all.data.forEach((r) => { c[reportState(r)] += 1; });
    return c;
  }, [all.data]);

  const tabs = [
    { value: 'mine', label: 'My reports', count: mine.data.filter((r) => ['pending', 'revision'].includes(r.status)).length },
    ...(reviewer ? [{ value: 'all', label: 'All ministry reports', count: counts.submitted }, { value: 'summary', label: 'Consolidated summary' }, { value: 'templates', label: 'Templates' }] : []),
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle="Ministry reporting: request, submit, review and consolidate."
        actions={reviewer && <Button onClick={() => setModal('request')} disabled={!templates.data.length}>Request reports</Button>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ErrorNote error={mine.error || all.error} />

      {tab === 'mine' && (
        <Card pad={false}>
          {mine.loading ? <Loading /> : <ReportList rows={[...mine.data].sort((a, b) => {
            const o = { revision: 0, pending: 1, submitted: 2, reviewed: 3 };
            return o[a.status] - o[b.status] || byDue(a, b);
          })} showLeader={false} empty="No reports have been requested from you." />}
        </Card>
      )}

      {tab === 'all' && reviewer && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Stat label="Awaiting review" value={counts.submitted} tone={counts.submitted ? 'amber' : ''} />
            <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? 'red' : ''} />
            <Stat label="Pending" value={counts.pending + counts.revision} />
            <Stat label="Reviewed" value={counts.reviewed} tone="green" />
          </div>
          {!templates.loading && !templates.data.length && (
            <div className="info-note" style={{ marginBottom: 16 }}>No report templates yet. Open the <button className="linkish" onClick={() => setTab('templates')}>Templates</button> tab to install the standard ones.</div>
          )}
          <Card pad={false} title={<select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Filter">
            <option value="attention">Needs attention</option><option value="submitted">Submitted</option><option value="overdue">Overdue</option>
            <option value="pending">Pending</option><option value="revision">Revision requested</option><option value="reviewed">Reviewed</option><option value="all">All</option>
          </select>}>
            {all.loading ? <Loading /> : <ReportList rows={allRows} empty="Nothing in this view." />}
          </Card>
        </>
      )}

      {tab === 'summary' && reviewer && <Summary reports={all.data} templates={templates.data} />}
      {tab === 'templates' && reviewer && <Templates templates={templates} />}

      <RequestReportsModal open={modal === 'request'} onClose={() => setModal(null)} templates={templates.data} />
    </>
  );
}

function RequestReportsModal({ open, onClose, templates }) {
  const { profile } = useAuth();
  const users = useUsers();
  const ministries = useLive(() => col('ministries'), []);
  const { busy, error, setError, run } = useAction();
  const now = new Date();
  const [f, setF] = useState({});
  const withLeader = ministries.data.filter((m) => m.leaderUid).sort((a, b) => a.name.localeCompare(b.name));
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF({
      templateId: templates[0]?.id || '', period: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      dueDate: toInputDate(new Date(now.getFullYear(), now.getMonth() + 1, 5)), selected: {},
    });
     
  }, [open]);
  const selectedIds = Object.keys(f.selected || {}).filter((k) => f.selected[k]);

  async function send() {
    const t = templates.find((x) => x.id === f.templateId);
    if (!t) return setError('Choose a template.');
    if (!f.period.trim()) return setError('Name the reporting period, e.g. "October 2026".');
    if (!selectedIds.length) return setError('Choose at least one ministry.');
    const due = Timestamp.fromDate(fromInputDate(f.dueDate, true));
    const ok = await run(async () => {
      const batch = writeBatch(db);
      for (const mid of selectedIds) {
        const m = withLeader.find((x) => x.id === mid);
        const leader = users.find((u) => u.uid === m.leaderUid);
        const ref = doc(bcol('reports'));
        batch.set(ref, {
          templateId: t.id, templateName: t.name, fields: t.fields, period: f.period.trim(), dueDate: due,
          ministryId: m.id, ministryName: m.name, leaderUid: m.leaderUid, leaderName: leader?.name || '',
          status: 'pending', answers: {}, reviewerNote: '', timeline: [timelineEntry(profile, 'Requested')],
          createdBy: profile.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        addNotify(batch, profile, m.leaderUid, `Report requested: ${t.name}`, `${m.name} · ${f.period} · due ${fmtDate(due)}`, `/reports/${ref.id}`);
      }
      addAudit(batch, profile, 'reports.requested', 'reports', t.id, `${t.name} — ${f.period} — ${selectedIds.length} ministries`);
      await batch.commit();
    }, `Requested from ${selectedIds.length} ministr${selectedIds.length === 1 ? 'y' : 'ies'}`);
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Request reports" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={send}>Send requests</Button></>}>
      <div className="form">
        <Field label="Template"><select value={f.templateId || ''} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
          {templates.filter((t) => t.active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Period"><input value={f.period || ''} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Due date"><input type="date" value={f.dueDate || ''} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <div className="full">
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="field-label">Ministries</span>
            <button className="linkish small" onClick={() => setF({ ...f, selected: Object.fromEntries(withLeader.map((m) => [m.id, true])) })}>Select all</button>
          </div>
          {!withLeader.length ? <div className="warn-note">No ministries with a leader yet. Add them in Admin → Ministries.</div> : (
            <div className="grid grid-2" style={{ gap: 6 }}>
              {withLeader.map((m) => (
                <label key={m.id} className="check"><input type="checkbox" checked={!!f.selected?.[m.id]} onChange={(e) => setF({ ...f, selected: { ...f.selected, [m.id]: e.target.checked } })} />
                  {m.name} <span className="muted small">({users.find((u) => u.uid === m.leaderUid)?.name || 'leader'})</span></label>
              ))}
            </div>
          )}
        </div>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Summary({ reports, templates }) {
  // Default to the most recent template/period that has submitted reports.
  const byRecent = [...reports].sort((a, b) => (toDate(b.dueDate) || 0) - (toDate(a.dueDate) || 0));
  const latestDone = byRecent.find((r) => ['submitted', 'reviewed'].includes(r.status)) || byRecent[0];
  const [templateId, setTemplateId] = useState('');
  const [period, setPeriod] = useState('');
  useEffect(() => {
    if (!templateId && latestDone) { setTemplateId(latestDone.templateId); setPeriod(latestDone.period); }
    else if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [latestDone, templates, templateId]);
  const periods = [...new Set(byRecent.filter((r) => r.templateId === templateId).map((r) => r.period))];
  useEffect(() => { if (periods.length && !periods.includes(period)) setPeriod(periods[0]); }, [periods, period]);
  const t = templates.find((x) => x.id === templateId);
  const scoped = reports.filter((r) => r.templateId === templateId && r.period === period);
  const fields = scoped[0]?.fields || t?.fields || [];
  const c = consolidate(scoped, fields);
  const missing = scoped.filter((r) => !['submitted', 'reviewed'].includes(r.status));

  function csv() {
    const cols = [{ label: 'Ministry', value: 'ministryName' }, { label: 'Leader', value: 'leaderName' }, { label: 'Status', value: 'status' },
      ...fields.map((f) => ({ label: f.label, value: (r) => r.answers?.[f.key] ?? '' }))];
    download(`orp-${(t?.name || 'report').replace(/\W+/g, '-').toLowerCase()}-${period.replace(/\W+/g, '-')}.csv`, toCSV(scoped, cols));
  }

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: 'auto' }} aria-label="Template">
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 'auto' }} aria-label="Period">
          {periods.map((p) => <option key={p}>{p}</option>)}
        </select>
        <span className="spacer" />
        <Button size="sm" variant="secondary" onClick={csv} disabled={!scoped.length}>Download CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => window.print()} disabled={!scoped.length}>Print / save as PDF</Button>
      </div>
      <div className="print-only"><h2>{t?.name} — {period}</h2></div>
      {!scoped.length ? <Card><Empty title="No reports for this template and period" /></Card> : (
        <>
          <p className="muted">{c.rows.length} of {scoped.length} ministries have submitted.{missing.length ? ` Outstanding: ${missing.map((r) => r.ministryName).join(', ')}.` : ''}</p>
          {c.numeric.length > 0 && (
            <Card title="Totals" pad={false}>
              <table><thead><tr><th>Measure</th><th className="num">Total</th><th className="num">Average</th><th className="num">Reports</th></tr></thead>
                <tbody>{c.numeric.map((n) => <tr key={n.key}><td>{n.label}</td><td className="num">{n.total.toLocaleString()}</td><td className="num">{n.average}</td><td className="num">{n.count}</td></tr>)}</tbody></table>
            </Card>
          )}
          {c.text.map((tf) => (
            <Card key={tf.key} title={tf.label} className="section-gap">
              {!tf.answers.length ? <p className="muted">No responses.</p> : (
                <dl className="kv">{tf.answers.map((a, i) => <Fragment key={i}><dt>{a.ministry}</dt><dd className="pre">{a.value}</dd></Fragment>)}</dl>
              )}
            </Card>
          ))}
        </>
      )}
    </>
  );
}

function Templates({ templates }) {
  const { profile } = useAuth();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(null);
  const missing = STANDARD_TEMPLATES.filter((s) => !templates.data.some((t) => t.name === s.name));

  async function install() {
    await run(async () => {
      const batch = writeBatch(db);
      missing.forEach((t) => batch.set(doc(bcol('reportTemplates')), { ...t, active: true, createdBy: profile.uid, createdAt: serverTimestamp() }));
      await batch.commit();
    }, 'Standard templates installed');
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {missing.length > 0 && <Button busy={busy} onClick={install}>Install {missing.length} standard template{missing.length > 1 ? 's' : ''}</Button>}
        <Button variant="secondary" onClick={() => setEditing({ name: '', description: '', frequency: 'monthly', fields: [{ key: 'f1', label: '', type: 'textarea' }], active: true })}>New template</Button>
      </div>
      <ErrorNote error={error || templates.error} />
      {templates.loading ? <Loading /> : (
        <div className="stack">{templates.data.map((t) => (
          <Card key={t.id} title={<>{t.name} {t.active === false && <Badge tone="grey">inactive</Badge>}</>} actions={<Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>}>
            <p className="muted small">{t.description} · {t.frequency}</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{t.fields.map((f) => <li key={f.key}>{f.label} <span className="muted small">({f.type})</span></li>)}</ul>
          </Card>
        ))}</div>
      )}
      <TemplateModal t={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateModal({ t, onClose }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState(null);
  useEffect(() => { setF(t ? JSON.parse(JSON.stringify({ ...t, createdAt: undefined })) : null); setError(null); }, [t, setError]);
  if (!t || !f) return null;
  const setField = (i, patch) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  async function save() {
    const fields = f.fields.filter((x) => x.label.trim()).map((x, i) => ({ key: x.key || `f${i}_${Date.now()}`, label: x.label.trim(), type: x.type }));
    if (!f.name.trim() || !fields.length) return setError('A template needs a name and at least one question.');
    const data = { name: f.name.trim(), description: (f.description || '').trim(), frequency: f.frequency, fields, active: f.active !== false, updatedAt: serverTimestamp() };
    const ok = await run(() => (t.id ? updateDoc(bdoc('reportTemplates', t.id), data)
      : writeBatch(db).set(doc(bcol('reportTemplates')), { ...data, createdBy: profile.uid, createdAt: serverTimestamp() }).commit()), 'Template saved');
    if (ok) onClose();
  }

  return (
    <Modal open title={t.id ? 'Edit template' : 'New template'} onClose={onClose} wide
      footer={<>{t.id && <Button variant="ghost" onClick={() => run(() => deleteDoc(bdoc('reportTemplates', t.id))).then((ok) => ok && onClose())}>Delete</Button>}
        <span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <p className="muted small">Changes apply to future requests. Reports already requested keep the questions they were sent with.</p>
      <div className="form">
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Frequency"><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
          {['weekly', 'monthly', 'quarterly', 'adhoc'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Description" full><input value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <div className="full stack">
          <span className="field-label">Questions</span>
          {f.fields.map((x, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={x.label} placeholder="Question" onChange={(e) => setField(i, { label: e.target.value })} />
              <select value={x.type} onChange={(e) => setField(i, { type: e.target.value })} style={{ width: 130 }}>
                <option value="number">Number</option><option value="text">Short text</option><option value="textarea">Long text</option>
              </select>
              <button className="icon-btn" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} aria-label="Remove question">✕</button>
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => setF({ ...f, fields: [...f.fields, { key: `f${Date.now()}`, label: '', type: 'textarea' }] })}>Add question</Button></div>
        </div>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
