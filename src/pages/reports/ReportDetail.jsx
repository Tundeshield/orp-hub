import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { useDoc, addNotify, addAudit, timelineEntry } from '../../lib/db.js';
import { isReviewer } from '../../lib/roles.js';
import { useUsers, usersWithRole } from '../../lib/users.js';
import { fmtDate, fmtDateTime, relative } from '../../lib/dates.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, useAction } from '../../components/ui.jsx';
import { TaskForm } from '../Tasks.jsx';
import { reportState } from './Reports.jsx';

export default function ReportDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const users = useUsers();
  const { data: r, loading } = useDoc('reports', id);
  const [answers, setAnswers] = useState({});
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState('');
  const [taskPreset, setTaskPreset] = useState(null);
  const save = useAction();
  const review = useAction();

  useEffect(() => { if (r && !dirty) setAnswers(r.answers || {}); }, [r, dirty]);

  if (loading) return <Loading />;
  if (!r) return <Empty title="Report not found"><Link to="/reports">Back to Reports</Link></Empty>;

  const isLeader = r.leaderUid === profile.uid;
  const reviewer = isReviewer(profile);
  const editable = isLeader && ['pending', 'revision'].includes(r.status);
  const st = reportState(r);
  const reviewerUids = [...new Set([...usersWithRole(users, 'pastor'), ...usersWithRole(users, 'assistant')].map((u) => u.uid))];

  function clean() {
    const out = {};
    for (const f of r.fields) {
      const v = answers[f.key];
      if (v === undefined || v === '') continue;
      out[f.key] = f.type === 'number' ? Number(v) : String(v);
    }
    return out;
  }

  async function persist(submit) {
    const data = clean();
    if (submit) {
      const missing = r.fields.filter((f) => data[f.key] === undefined || (f.type === 'number' && !Number.isFinite(data[f.key])));
      if (missing.length) return save.setError(`Please answer: ${missing.map((f) => f.label).join(', ')}. Write "None" or 0 if not applicable.`);
    }
    const ok = await save.run(async () => {
      const batch = writeBatch(db);
      const patch = { answers: data, updatedAt: serverTimestamp() };
      if (submit) {
        Object.assign(patch, { status: 'submitted', submittedAt: serverTimestamp(), timeline: [...(r.timeline || []), timelineEntry(profile, r.status === 'revision' ? 'Resubmitted' : 'Submitted')] });
        for (const u of reviewerUids) addNotify(batch, profile, u, `Report submitted: ${r.ministryName}`, `${r.templateName} · ${r.period}`, `/reports/${r.id}`);
        addAudit(batch, profile, 'report.submitted', 'report', r.id, `${r.templateName} — ${r.ministryName} — ${r.period}`);
      }
      batch.update(doc(db, 'reports', r.id), patch);
      await batch.commit();
    }, submit ? 'Report submitted' : 'Draft saved');
    if (ok) setDirty(false);
  }

  async function decide(status) {
    if (status === 'revision' && !note.trim()) return review.setError('Say what needs to be revised.');
    const ok = await review.run(async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'reports', r.id), {
        status, reviewerNote: note.trim(), reviewedAt: serverTimestamp(), reviewedBy: profile.uid, reviewedByName: profile.name,
        updatedAt: serverTimestamp(), timeline: [...(r.timeline || []), timelineEntry(profile, status === 'reviewed' ? 'Reviewed' : 'Revision requested', note.trim())],
      });
      addNotify(batch, profile, r.leaderUid, status === 'reviewed' ? `Report reviewed: ${r.period}` : `Revision requested: ${r.templateName}`, note.trim(), `/reports/${r.id}`);
      addAudit(batch, profile, `report.${status}`, 'report', r.id, `${r.ministryName} — ${r.period}`);
      await batch.commit();
    }, status === 'reviewed' ? 'Marked as reviewed' : 'Revision requested');
    if (ok) { setModal(null); setNote(''); }
  }

  return (
    <>
      <p className="small no-print"><Link to="/reports">← Reports</Link></p>
      <PageHeader title={`${r.templateName} — ${r.period}`} subtitle={`${r.ministryName} · ${r.leaderName} · due ${fmtDate(r.dueDate)} (${relative(r.dueDate)})`}
        actions={<>
          <Badge status={st}>{st}</Badge>
          {reviewer && r.status === 'submitted' && <>
            <Button variant="success" onClick={() => { setNote(''); review.setError(null); setModal('reviewed'); }}>Mark reviewed</Button>
            <Button variant="secondary" onClick={() => { setNote(''); review.setError(null); setModal('revision'); }}>Request revision</Button>
          </>}
          {reviewer && <Button variant="ghost" onClick={() => setTaskPreset({ title: `${r.ministryName}: `, source: { type: 'report', id: r.id, label: `${r.ministryName} report (${r.period})` }, assigneeUid: r.leaderUid })}>Create task</Button>}
          <Button variant="ghost" onClick={() => window.print()}>Print</Button>
        </>} />

      {r.status === 'revision' && r.reviewerNote && <div className="warn-note" style={{ marginBottom: 16 }}><strong>Revision requested by {r.reviewedByName}:</strong> {r.reviewerNote}</div>}
      {r.status === 'reviewed' && r.reviewerNote && <div className="info-note" style={{ marginBottom: 16 }}><strong>Reviewer's note:</strong> {r.reviewerNote}</div>}

      <div className="grid detail-grid">
        <Card title={editable ? 'Your report' : 'Report'}>
          <div className="stack">
            {r.fields.map((f) => (
              <Field key={f.key} label={f.label} as={editable ? 'label' : 'div'}>
                {editable ? (
                  f.type === 'textarea'
                    ? <textarea value={answers[f.key] ?? ''} onChange={(e) => { setDirty(true); setAnswers({ ...answers, [f.key]: e.target.value }); }} />
                    : <input type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} value={answers[f.key] ?? ''}
                      onChange={(e) => { setDirty(true); setAnswers({ ...answers, [f.key]: e.target.value }); }} />
                ) : (
                  <div className="pre" style={{ padding: '4px 0' }}>
                    {r.answers?.[f.key] !== undefined && r.answers?.[f.key] !== '' ? String(r.answers[f.key]) : <span className="muted">—</span>}
                    {reviewer && f.type !== 'number' && r.answers?.[f.key] && (
                      <button className="linkish small no-print" style={{ marginLeft: 8 }} onClick={() => setTaskPreset({
                        title: `${r.ministryName}: ${f.label}`, description: String(r.answers[f.key]).slice(0, 500), assigneeUid: r.leaderUid,
                        source: { type: 'report', id: r.id, label: `${r.ministryName} report (${r.period})` },
                      })}>→ make task</button>
                    )}
                  </div>
                )}
              </Field>
            ))}
          </div>
          {editable && (
            <div className="row" style={{ marginTop: 16 }}>
              <Button busy={save.busy} onClick={() => persist(true)}>Submit report</Button>
              <Button variant="secondary" busy={save.busy} onClick={() => persist(false)} disabled={!dirty}>Save draft</Button>
            </div>
          )}
          <ErrorNote error={save.error} />
        </Card>
        <Card title="History">
          <ul className="timeline">{(r.timeline || []).map((t, i) => (
            <li key={i}><strong>{t.action}</strong> <span className="muted">— {t.byName}, {fmtDateTime(t.at)}</span>{t.note && <div className="pre">{t.note}</div>}</li>
          ))}</ul>
        </Card>
      </div>

      <Modal open={modal === 'reviewed' || modal === 'revision'} title={modal === 'reviewed' ? 'Mark as reviewed' : 'Request revision'} onClose={() => setModal(null)}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Back</Button><Button busy={review.busy} onClick={() => decide(modal)}>{modal === 'reviewed' ? 'Mark reviewed' : 'Send back'}</Button></>}>
        <Field label={modal === 'reviewed' ? 'Note to the leader (optional)' : 'What needs revising?'}><textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
        <ErrorNote error={review.error} />
      </Modal>
      <TaskForm open={!!taskPreset} onClose={() => setTaskPreset(null)} preset={taskPreset || {}} />
    </>
  );
}
