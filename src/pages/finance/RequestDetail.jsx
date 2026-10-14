import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext.jsx';
import { col, query, where, useDoc, useLive } from '../../lib/db.js';
import { can, isFinanceViewer } from '../../lib/roles.js';
import { formatNGN } from '../../lib/money.js';
import { fundBalances, REQUEST_STATUS, TX_TYPES, requestOutstanding } from '../../lib/finance.js';
import { fmtDate, fmtDateTime, toDate } from '../../lib/dates.js';
import { postLedger, pastorDecision, updateRequestByRequester } from '../../lib/financeOps.js';
import { useUsers, usersWithRole } from '../../lib/users.js';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, Loading, Modal, PageHeader, useAction } from '../../components/ui.jsx';
import { PaymentForm, RequestForm } from './forms.jsx';
import { TaskForm } from '../Tasks.jsx';

export default function RequestDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const users = useUsers();
  const { data: req, loading, error } = useDoc('requests', id);
  const { data: fund } = useDoc('funds', req?.fundId);
  const viewer = isFinanceViewer(profile);
  const txs = useLive(() => viewer ? query(col('transactions'), where('requestId', '==', id)) : null, [viewer, id]);
  const funds = useLive(() => col('funds'), []);
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState('');
  const decision = useAction();

  if (loading) return <Loading />;
  if (error || !req) return <Empty title="Request not found">It may have been removed, or you may not have access to it. <Link to="/finance">Back to Finance</Link></Empty>;

  const isOwner = req.requestedBy === profile.uid;
  const pastor = can(profile, 'pastor');
  const fin = can(profile, 'finance');
  const outstanding = requestOutstanding(req);
  const avail = fund ? fundBalances(fund).available : 0;
  const insufficient = req.status === 'pending' && fund && req.amount > avail;
  const financeUids = usersWithRole(users, 'finance').map((u) => u.uid);

  async function approve() {
    const ok = await decision.run(() => postLedger(profile, 'commit', {
      fundId: req.fundId, requestId: req.id, amount: req.amount, note: note.trim(), notifyUids: financeUids,
    }), 'Request approved');
    if (ok) { setModal(null); setNote(''); }
  }
  async function decide(status) {
    if (!note.trim()) return decision.setError(status === 'rejected' ? 'Give a reason for the rejection.' : 'Say what needs clarifying.');
    const ok = await decision.run(() => pastorDecision(profile, req, status, note.trim()), status === 'rejected' ? 'Request rejected' : 'Clarification requested');
    if (ok) { setModal(null); setNote(''); }
    return ok;
  }
  const openDecision = (m) => { setNote(''); decision.setError(null); setModal(m); };

  return (
    <>
      <p className="small no-print"><Link to="/finance?tab=requests">← Finance</Link></p>
      <PageHeader title={req.title} subtitle={`${formatNGN(req.amount)} from ${req.fundName} · requested by ${req.requestedByName}`}
        actions={<>
          {pastor && req.status === 'pending' && <>
            <Button variant="success" onClick={() => openDecision('approve')} disabled={insufficient}>Approve</Button>
            <Button variant="secondary" onClick={() => openDecision('clarification')}>Ask for clarification</Button>
            <Button variant="danger" onClick={() => openDecision('rejected')}>Reject</Button>
          </>}
          {fin && ['approved', 'partly_paid'].includes(req.status) && <>
            <Button onClick={() => setModal('payment')}>Record payment</Button>
            <Button variant="secondary" onClick={() => setModal('advance')}>Pay advance</Button>
          </>}
          {fin && ['partly_paid', 'paid'].includes(req.status) && <Button variant="secondary" onClick={() => setModal('refund')}>Record refund</Button>}
          {can(profile, 'finance', 'pastor') && ['approved', 'partly_paid'].includes(req.status) && <Button variant="ghost" onClick={() => setModal('release')}>Close request</Button>}
          {isOwner && ['pending', 'clarification'].includes(req.status) && <>
            <Button variant={req.status === 'clarification' ? 'primary' : 'secondary'} onClick={() => setModal('edit')}>{req.status === 'clarification' ? 'Respond and resubmit' : 'Edit'}</Button>
            <Button variant="ghost" onClick={() => setModal('cancel')}>Withdraw</Button>
          </>}
          {can(profile, 'pastor', 'admin', 'assistant') && <Button variant="ghost" onClick={() => setModal('task')}>Create task</Button>}
        </>} />

      {insufficient && pastor && <div className="warn-note" style={{ marginBottom: 16 }}>
        This fund only has {formatNGN(avail)} available, so this request can't be approved as it stands. Ask the finance officer to add budget, or ask for clarification to reduce the amount.
      </div>}
      {req.status === 'clarification' && <div className="warn-note" style={{ marginBottom: 16 }}><strong>Clarification requested:</strong> {req.decisionNote}</div>}
      {req.status === 'rejected' && <div className="error-note" style={{ marginBottom: 16, marginTop: 0 }}><strong>Rejected:</strong> {req.decisionNote}</div>}

      <div className="grid grid-2">
        <Card title="Details">
          <dl className="kv">
            <dt>Status</dt><dd><Badge status={req.status}>{REQUEST_STATUS[req.status]}</Badge></dd>
            <dt>Amount</dt><dd className="mono">{formatNGN(req.amount)}</dd>
            <dt>Paid</dt><dd className="mono">{formatNGN(req.paid)}</dd>
            {['approved', 'partly_paid'].includes(req.status) && <><dt>Still owed</dt><dd className="mono">{formatNGN(outstanding)}</dd></>}
            {req.released > 0 && <><dt>Released</dt><dd className="mono">{formatNGN(req.released)}</dd></>}
            <dt>Fund</dt><dd>{req.fundName}{fund && req.status === 'pending' && <span className="muted small"> — {formatNGN(avail)} available</span>}</dd>
            <dt>Category</dt><dd>{req.category}</dd>
            {req.ministry && <><dt>Ministry</dt><dd>{req.ministry}</dd></>}
            <dt>Needed by</dt><dd>{fmtDate(req.neededBy)}</dd>
            <dt>Submitted</dt><dd>{fmtDateTime(req.createdAt)}</dd>
            {req.decidedByName && <><dt>Decision by</dt><dd>{req.decidedByName}, {fmtDateTime(req.decidedAt)}</dd></>}
          </dl>
          <h3 style={{ margin: '16px 0 6px' }}>Purpose</h3>
          <p className="pre">{req.description}</p>
        </Card>
        <Card title="History">
          <ul className="timeline">
            {(req.timeline || []).map((t, i) => (
              <li key={i}><strong>{t.action}</strong> <span className="muted">— {t.byName}, {fmtDateTime(t.at)}</span>{t.note && <div className="pre">{t.note}</div>}</li>
            ))}
          </ul>
        </Card>
      </div>

      {viewer && (
        <Card title="Ledger entries" className="section-gap" pad={false}>
          {txs.loading ? <Loading /> : !txs.data.length ? <Empty title="No money has moved on this request yet" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Entry</th><th className="num">Amount</th><th>Reference</th><th className="hide-sm">By</th></tr></thead>
              <tbody>{[...txs.data].sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt)).map((t) => (
                <tr key={t.id}><td>{fmtDate(t.date)}</td><td>{TX_TYPES[t.type]}{t.note && <div className="list-meta">{t.note}</div>}</td>
                  <td className="num">{formatNGN(t.type === 'refund' ? -t.amount : t.amount)}</td>
                  <td>{t.method ? `${t.method} · ` : ''}{/^https?:\/\//.test(t.reference) ? <a href={t.reference} target="_blank" rel="noreferrer">receipt link</a> : t.reference}</td>
                  <td className="hide-sm">{t.createdByName}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      <Modal open={modal === 'approve'} title="Approve request" onClose={() => setModal(null)}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Back</Button><Button variant="success" busy={decision.busy} onClick={approve}>Approve {formatNGN(req.amount)}</Button></>}>
        <p>This commits {formatNGN(req.amount)} from <strong>{req.fundName}</strong>, leaving {formatNGN(avail - req.amount)} available. The finance officer will be notified to pay it.</p>
        <Field label="Note (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorNote error={decision.error} />
      </Modal>
      <Modal open={modal === 'clarification' || modal === 'rejected'} title={modal === 'rejected' ? 'Reject request' : 'Ask for clarification'} onClose={() => setModal(null)}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Back</Button>
          <Button variant={modal === 'rejected' ? 'danger' : 'primary'} busy={decision.busy} onClick={() => decide(modal)}>{modal === 'rejected' ? 'Reject' : 'Send question'}</Button></>}>
        <Field label={modal === 'rejected' ? 'Reason' : 'What needs clarifying?'}><textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
        <ErrorNote error={decision.error} />
      </Modal>

      <PaymentForm open={['payment', 'advance', 'refund', 'release'].includes(modal)} type={modal} req={req} onClose={() => setModal(null)} />
      <RequestForm open={modal === 'edit'} existing={req} funds={funds.data} onClose={() => setModal(null)} />
      <Confirm open={modal === 'cancel'} title="Withdraw request" danger confirmLabel="Withdraw"
        message="The request will be marked as cancelled. You can submit a new one later."
        onClose={() => setModal(null)}
        onConfirm={() => updateRequestByRequester(profile, req, { status: 'cancelled' }, 'Withdrawn by requester')} />
      <TaskForm open={modal === 'task'} onClose={() => setModal(null)}
        preset={{ title: `Follow up: ${req.title}`, source: { type: 'request', id: req.id, label: req.title } }} />
    </>
  );
}
