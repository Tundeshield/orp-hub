import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext.jsx';
import { Button, ErrorNote, Field, Modal, useAction } from '../../components/ui.jsx';
import { formatNGN, parseNGN, koboToInput } from '../../lib/money.js';
import { fundBalances, requestOutstanding } from '../../lib/finance.js';
import { createFund, postLedger, submitRequest, updateRequestByRequester, recordReconciliation } from '../../lib/financeOps.js';
import { useUsers, usersWithRole } from '../../lib/users.js';
import { toInputDate, fromInputDate } from '../../lib/dates.js';

export const CATEGORIES = ['Ministry programme', 'Welfare', 'Logistics & transport', 'Maintenance & repairs', 'Equipment', 'Honorarium', 'Hospitality', 'Outreach', 'Administrative', 'Other'];

export function FundForm({ open, onClose }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({ name: '', description: '', initial: '' });
  useEffect(() => { if (open) { setF({ name: '', description: '', initial: '' }); setError(null); } }, [open, setError]);

  async function save() {
    const initial = f.initial ? parseNGN(f.initial) : 0;
    if (!f.name.trim()) return setError('Give the fund a name.');
    if (f.initial && !initial) return setError('Enter a valid opening budget in naira.');
    const ok = await run(async () => {
      const id = await createFund(profile, f);
      if (initial) await postLedger(profile, 'allocation', { fundId: id, amount: initial, note: 'Opening budget' });
    }, 'Fund created');
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New fund / budget line"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Create fund</Button></>}>
      <div className="form">
        <Field label="Name" full><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Welfare 2026" /></Field>
        <Field label="Description" full><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Opening budget (₦)" hint="Optional. You can add allocations later." full>
          <input inputMode="decimal" value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value })} placeholder="0.00" />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

// Budget allocation (+/-) or income received into a fund.
export function FundLedgerForm({ open, onClose, funds, type, fundId: presetFund }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (open) { setF({ fundId: presetFund || funds.find((x) => x.active)?.id || '', amount: '', date: toInputDate(new Date()), reference: '', note: '', method: 'Bank transfer', direction: 'add' }); setError(null); }
   
  }, [open, presetFund]);
  const fund = funds.find((x) => x.id === f.fundId);
  const isAlloc = type === 'allocation';

  async function save() {
    let amount = parseNGN(f.amount);
    if (!f.fundId) return setError('Choose a fund.');
    if (!amount) return setError('Enter a valid amount in naira.');
    if (isAlloc && f.direction === 'reduce') amount = -amount;
    const ok = await run(() => postLedger(profile, type, {
      fundId: f.fundId, amount, date: fromInputDate(f.date), method: isAlloc ? '' : f.method, reference: f.reference.trim(), note: f.note.trim(),
    }), isAlloc ? 'Allocation recorded' : 'Income recorded');
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={isAlloc ? 'Budget allocation' : 'Record income received'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Fund" full>
          <select value={f.fundId} onChange={(e) => setF({ ...f, fundId: e.target.value })}>
            {funds.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        {fund && <p className="muted small full">Budget {formatNGN(fund.allocated)} · committed {formatNGN(fund.committed)} · available {formatNGN(fundBalances(fund).available)}</p>}
        {isAlloc && (
          <Field label="Change">
            <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="add">Increase budget</option>
              <option value="reduce">Reduce budget</option>
            </select>
          </Field>
        )}
        <Field label="Amount (₦)"><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {!isAlloc && (
          <Field label="Method">
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {['Bank transfer', 'Cash', 'POS', 'Cheque', 'Other'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        )}
        <Field label="Reference" hint={isAlloc ? 'e.g. board minute no.' : 'Receipt or teller number, or a link to the document'} full>
          <input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <Field label="Note" full><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function RequestForm({ open, onClose, funds, existing, onSaved }) {
  const { profile } = useAuth();
  const users = useUsers();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(existing ? {
      title: existing.title, description: existing.description, category: existing.category, fundId: existing.fundId,
      amount: koboToInput(existing.amount), neededBy: toInputDate(existing.neededBy), ministry: existing.ministry || '', note: '',
    } : { title: '', description: '', category: CATEGORIES[0], fundId: funds.find((x) => x.active)?.id || '', amount: '', neededBy: '', ministry: profile.ministryName || '', note: '' });
   
  }, [open, existing?.id]);
  const fund = funds.find((x) => x.id === f.fundId);
  const amount = parseNGN(f.amount);
  const avail = fund ? fundBalances(fund).available : 0;

  async function save() {
    if (!f.title?.trim()) return setError('Add a short title.');
    if (!f.fundId) return setError('Choose the fund this should come from.');
    if (!amount) return setError('Enter a valid amount in naira.');
    if (!f.description?.trim()) return setError('Explain what the money is for.');
    const pastors = usersWithRole(users, 'pastor').map((u) => u.uid);
    const data = {
      title: f.title, description: f.description, category: f.category, fundId: f.fundId, fundName: fund?.name || '',
      amount, neededBy: fromInputDate(f.neededBy), ministry: f.ministry,
    };
    const ok = await run(async () => {
      if (existing) {
        await updateRequestByRequester(profile, existing, {
          title: data.title.trim(), description: data.description.trim(), category: data.category, fundId: data.fundId,
          fundName: data.fundName, amount, neededBy: data.neededBy, status: 'pending', note: f.note,
        }, existing.status === 'clarification' ? 'Resubmitted with clarification' : 'Edited', pastors);
        return existing.id;
      }
      return submitRequest(profile, data, pastors);
    }, existing ? 'Request updated' : 'Request submitted for approval');
    if (ok) { onClose(); onSaved?.(ok); }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit request' : 'New financial request'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>{existing ? 'Save and resubmit' : 'Submit for approval'}</Button></>}>
      {existing?.status === 'clarification' && existing.decisionNote && (
        <div className="warn-note" style={{ marginBottom: 14 }}><strong>Pastor asked:</strong> {existing.decisionNote}</div>
      )}
      <div className="form">
        <Field label="Title" full><input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Youth retreat transport" /></Field>
        <Field label="Fund">
          <select value={f.fundId || ''} onChange={(e) => setF({ ...f, fundId: e.target.value })}>
            <option value="">Choose…</option>
            {funds.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (₦)" error={amount && fund && amount > avail ? `Only ${formatNGN(avail)} is currently available in this fund — the pastor will not be able to approve more than that.` : ''}>
          <input inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label="Category">
          <select value={f.category || ''} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Needed by"><input type="date" value={f.neededBy || ''} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></Field>
        {!existing && <Field label="Ministry / department" full><input value={f.ministry || ''} onChange={(e) => setF({ ...f, ministry: e.target.value })} /></Field>}
        <Field label="Purpose and breakdown" full>
          <textarea rows={5} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What it's for, who benefits, cost breakdown, vendor details…" />
        </Field>
        {existing && <Field label="Note for the pastor" full><input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>}
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

// Finance officer actions on an approved request.
export function PaymentForm({ open, onClose, req, type }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const outstanding = req ? requestOutstanding(req) : 0;
  const [f, setF] = useState({});
  useEffect(() => {
    if (open && req) {
      setError(null);
      const def = type === 'refund' ? '' : koboToInput(outstanding);
      setF({ amount: def, date: toInputDate(new Date()), method: 'Bank transfer', reference: '', note: '' });
    }
   
  }, [open, type, req?.id]);

  const titles = { payment: 'Record payment', advance: 'Pay an advance', refund: 'Record refund', release: 'Close request' };
  async function save() {
    const amount = type === 'release' ? outstanding : parseNGN(f.amount);
    if (!amount) return setError('Enter a valid amount.');
    const ok = await run(() => postLedger(profile, type, {
      fundId: req.fundId, requestId: req.id, amount, date: fromInputDate(f.date), method: type === 'release' ? '' : f.method,
      reference: (f.reference || '').trim(), note: (f.note || '').trim(),
    }), `${titles[type]} — saved`);
    if (ok) onClose();
  }
  if (!req) return null;
  return (
    <Modal open={open} onClose={onClose} title={titles[type]}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} variant={type === 'release' ? 'danger' : 'primary'} onClick={save}>{titles[type]}</Button></>}>
      <p className="muted small">Approved {formatNGN(req.amount)} · paid {formatNGN(req.paid)} · still owed {formatNGN(outstanding)}</p>
      {type === 'release' ? (
        <div className="warn-note">This closes the request and returns the unpaid {formatNGN(outstanding)} to the fund's available balance. It can't be undone.</div>
      ) : null}
      {type === 'advance' && <div className="info-note" style={{ marginBottom: 12 }}>An advance is paid before receipts. When the person accounts for it, record a refund for any unspent cash, then close the request.</div>}
      <div className="form" style={{ marginTop: 12 }}>
        {type !== 'release' && (
          <Field label="Amount (₦)" hint={type === 'refund' ? `Up to ${formatNGN(req.paid)}` : `Up to ${formatNGN(outstanding)}`}>
            <input inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        )}
        {type !== 'release' && <Field label="Date"><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
        {type !== 'release' && (
          <Field label="Method">
            <select value={f.method || ''} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {['Bank transfer', 'Cash', 'POS', 'Cheque', 'Other'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        )}
        {type !== 'release' && (
          <Field label="Receipt / reference" hint="Receipt or transfer reference, or a link to the scanned receipt">
            <input value={f.reference || ''} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
        )}
        <Field label="Note" full><textarea value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function ReconcileForm({ open, onClose, funds }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setError(null); setF({ fundId: 'all', date: toInputDate(new Date()), statement: '', note: '', account: '' }); } }, [open, setError]);
  const scoped = f.fundId === 'all' ? funds : funds.filter((x) => x.id === f.fundId);
  const book = scoped.reduce((s, x) => s + fundBalances(x).cashRemaining, 0);
  const statement = parseNGN(f.statement, { allowNegative: true });
  const diff = statement !== null ? statement - book : null;

  async function save() {
    if (statement === null && f.statement !== '0') return setError('Enter the statement balance.');
    const ok = await run(() => recordReconciliation(profile, {
      fundId: f.fundId === 'all' ? null : f.fundId,
      scope: f.fundId === 'all' ? 'All funds' : scoped[0]?.name,
      account: f.account.trim(), asOf: fromInputDate(f.date),
      statementBalance: statement || 0, bookBalance: book, difference: (statement || 0) - book, note: f.note.trim(),
    }), 'Reconciliation saved');
    if (ok) onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Reconcile with bank / cash"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save reconciliation</Button></>}>
      <div className="form">
        <Field label="Scope">
          <select value={f.fundId || 'all'} onChange={(e) => setF({ ...f, fundId: e.target.value })}>
            <option value="all">All funds</option>
            {funds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="As of"><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Account" hint="e.g. GTBank current, petty cash"><input value={f.account || ''} onChange={(e) => setF({ ...f, account: e.target.value })} /></Field>
        <Field label="Statement balance (₦)"><input inputMode="decimal" value={f.statement || ''} onChange={(e) => setF({ ...f, statement: e.target.value })} /></Field>
        <div className="full">
          <dl className="kv">
            <dt>Per records</dt><dd className="mono">{formatNGN(book)} <span className="muted small">(budget received minus payments)</span></dd>
            <dt>Difference</dt><dd className="mono" style={{ color: diff ? 'var(--red)' : 'var(--green)' }}>{diff === null ? '—' : formatNGN(diff)}</dd>
          </dl>
        </div>
        <Field label="Explanation" full hint="Explain any difference (unpresented cheques, bank charges, etc.)">
          <textarea value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
