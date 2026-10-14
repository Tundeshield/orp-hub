import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { orderBy } from 'firebase/firestore';
import { useAuth } from '../../AuthContext.jsx';
import { col, query, where, useLive } from '../../lib/db.js';
import { isFinanceViewer, can } from '../../lib/roles.js';
import { formatNGN } from '../../lib/money.js';
import { fundBalances, REQUEST_STATUS, TX_TYPES, summarizeLedger } from '../../lib/finance.js';
import { fmtDate, toDate, toInputDate, fromInputDate } from '../../lib/dates.js';
import { toCSV, download } from '../../lib/csv.js';
import { Badge, Button, Card, Empty, ErrorNote, Loading, PageHeader, Stat, Tabs } from '../../components/ui.jsx';
import { FundForm, FundLedgerForm, ReconcileForm, RequestForm } from './forms.jsx';

export function FundBar({ fund }) {
  const b = fundBalances(fund);
  const cls = b.usedPct >= 100 ? 'over' : b.usedPct >= 85 ? 'warn' : '';
  return <div className={`bar ${cls}`} title={`${b.usedPct}% committed`}><span style={{ width: `${b.usedPct}%` }} /></div>;
}

export function RequestsTable({ rows, showRequester = true, empty = 'No requests yet.' }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>Request</th>{showRequester && <th className="hide-sm">Requested by</th>}<th className="hide-sm">Fund</th>
          <th className="num">Amount</th><th className="num hide-sm">Paid</th><th>Status</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => nav(`/finance/requests/${r.id}`)}>
              <td><div className="list-title">{r.title}</div><div className="list-meta">{fmtDate(r.createdAt)}{r.ministry ? ` · ${r.ministry}` : ''}</div></td>
              {showRequester && <td className="hide-sm">{r.requestedByName}</td>}
              <td className="hide-sm">{r.fundName}</td>
              <td className="num">{formatNGN(r.amount)}</td>
              <td className="num hide-sm">{formatNGN(r.paid)}</td>
              <td><Badge status={r.status}>{REQUEST_STATUS[r.status]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_FILTERS = [
  { value: 'open', label: 'Open', match: ['pending', 'clarification', 'approved', 'partly_paid'] },
  { value: 'pending', label: 'Awaiting approval', match: ['pending', 'clarification'] },
  { value: 'unpaid', label: 'Approved — unpaid', match: ['approved', 'partly_paid'] },
  { value: 'done', label: 'Completed', match: ['paid', 'closed'] },
  { value: 'declined', label: 'Rejected / cancelled', match: ['rejected', 'cancelled'] },
  { value: 'all', label: 'All', match: null },
];

export default function Finance() {
  const { profile } = useAuth();
  const viewer = isFinanceViewer(profile);
  const fin = can(profile, 'finance');
  const manager = can(profile, 'finance', 'pastor', 'admin');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (viewer ? 'overview' : 'requests');
  const setTab = (t) => setParams({ tab: t });
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('open');
  const nav = useNavigate();

  const funds = useLive(() => col('funds'), []);
  const requests = useLive(() => viewer ? col('requests') : query(col('requests'), where('requestedBy', '==', profile.uid)), [viewer, profile.uid]);
  const txs = useLive(() => viewer ? query(col('transactions'), orderBy('createdAt', 'desc')) : null, [viewer]);
  const recs = useLive(() => viewer ? query(col('reconciliations'), orderBy('createdAt', 'desc')) : null, [viewer]);

  const fundList = useMemo(() => [...funds.data].sort((a, b) => a.name.localeCompare(b.name)), [funds.data]);
  const totals = useMemo(() => fundList.filter((f) => f.active).reduce((t, f) => {
    const b = fundBalances(f);
    Object.keys(t).forEach((k) => { t[k] += b[k]; });
    return t;
  }, { allocated: 0, committed: 0, paid: 0, available: 0, outstanding: 0 }), [fundList]);

  const reqRows = useMemo(() => {
    const m = STATUS_FILTERS.find((s) => s.value === filter)?.match;
    return requests.data.filter((r) => !m || m.includes(r.status))
      .sort((a, b) => (toDate(b.createdAt) || new Date()) - (toDate(a.createdAt) || new Date()));
  }, [requests.data, filter]);

  const tabs = viewer
    ? [{ value: 'overview', label: 'Overview' }, { value: 'requests', label: 'Requests', count: requests.data.filter((r) => ['pending', 'approved', 'partly_paid'].includes(r.status)).length },
      { value: 'ledger', label: 'Ledger' }, { value: 'reconcile', label: 'Reconciliations' }, { value: 'reports', label: 'Reports' }]
    : [{ value: 'requests', label: 'My requests' }, { value: 'funds', label: 'Funds' }];

  return (
    <>
      <PageHeader title="Finance" subtitle="All amounts in Nigerian naira (₦). Every request needs the pastor's approval."
        actions={<>
          <Button onClick={() => setModal('request')}>New request</Button>
          {manager && <Button variant="secondary" onClick={() => setModal('fund')}>New fund</Button>}
          {manager && <Button variant="secondary" onClick={() => setModal('allocation')} disabled={!fundList.length}>Allocate budget</Button>}
          {fin && <Button variant="secondary" onClick={() => setModal('receipt')} disabled={!fundList.length}>Record income</Button>}
        </>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ErrorNote error={funds.error || requests.error || txs.error} />

      {tab === 'overview' && viewer && (
        <>
          <div className="grid grid-4">
            <Stat label="Total budget" value={formatNGN(totals.allocated)} />
            <Stat label="Spent (paid)" value={formatNGN(totals.paid)} />
            <Stat label="Approved, unpaid" value={formatNGN(totals.outstanding)} tone={totals.outstanding ? 'amber' : ''} />
            <Stat label="Available to approve" value={formatNGN(totals.available)} tone="green" />
          </div>
          <Card title="Funds" className="section-gap" pad={false}>
            {funds.loading ? <Loading /> : !fundList.length ? (
              <Empty title="No funds yet" action={manager && <Button onClick={() => setModal('fund')}>Create the first fund</Button>}>
                Funds are budget lines like "Welfare" or "Youth ministry". Requests are paid from a fund.
              </Empty>
            ) : <FundsTable funds={fundList} onOpen={(id) => nav(`/finance/funds/${id}`)} />}
          </Card>
        </>
      )}

      {tab === 'funds' && !viewer && (
        <Card pad={false}>
          {funds.loading ? <Loading /> : <FundsTable funds={fundList.filter((f) => f.active)} simple />}
        </Card>
      )}

      {tab === 'requests' && (
        <Card pad={false}
          title={<select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filter requests">
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>}
          actions={viewer && <Button size="sm" variant="secondary" onClick={() => exportRequests(reqRows)}>Download CSV</Button>}>
          {requests.loading ? <Loading /> : <RequestsTable rows={reqRows} showRequester={viewer} empty="No requests match this filter." />}
        </Card>
      )}

      {tab === 'ledger' && viewer && <Ledger txs={txs} funds={fundList} />}
      {tab === 'reconcile' && viewer && (
        <Card title="Reconciliations" pad={false} actions={fin && <Button size="sm" onClick={() => setModal('reconcile')}>New reconciliation</Button>}>
          {recs.loading ? <Loading /> : !recs.data.length ? <Empty title="No reconciliations recorded">Compare your bank or cash balance with these records regularly (e.g. monthly).</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>As of</th><th>Scope</th><th className="num">Statement</th><th className="num">Records</th><th className="num">Difference</th><th className="hide-sm">Note</th><th className="hide-sm">By</th></tr></thead>
              <tbody>{recs.data.map((r) => (
                <tr key={r.id}><td>{fmtDate(r.asOf)}</td><td>{r.scope}{r.account ? <div className="list-meta">{r.account}</div> : null}</td>
                  <td className="num">{formatNGN(r.statementBalance)}</td><td className="num">{formatNGN(r.bookBalance)}</td>
                  <td className="num" style={{ color: r.difference ? 'var(--red)' : 'var(--green)' }}>{formatNGN(r.difference)}</td>
                  <td className="hide-sm pre">{r.note}</td><td className="hide-sm">{r.createdByName}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {tab === 'reports' && viewer && <FinanceReports funds={fundList} txs={txs.data} requests={requests.data} />}

      <RequestForm open={modal === 'request'} onClose={() => setModal(null)} funds={fundList} onSaved={(id) => nav(`/finance/requests/${id}`)} />
      <FundForm open={modal === 'fund'} onClose={() => setModal(null)} />
      <FundLedgerForm open={modal === 'allocation'} type="allocation" onClose={() => setModal(null)} funds={fundList} />
      <FundLedgerForm open={modal === 'receipt'} type="receipt" onClose={() => setModal(null)} funds={fundList} />
      <ReconcileForm open={modal === 'reconcile'} onClose={() => setModal(null)} funds={fundList.filter((f) => f.active)} />
    </>
  );
}

function FundsTable({ funds, onOpen, simple }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Fund</th>{!simple && <th className="num hide-sm">Budget</th>}{!simple && <th className="num hide-sm">Spent</th>}
        {!simple && <th className="num">Unpaid</th>}<th className="num">Available</th><th style={{ width: 120 }} className="hide-sm">Committed</th></tr></thead>
      <tbody>{funds.map((f) => {
        const b = fundBalances(f);
        return (
          <tr key={f.id} className={onOpen ? 'clickable' : ''} onClick={() => onOpen?.(f.id)}>
            <td><div className="list-title">{f.name} {!f.active && <Badge tone="grey">archived</Badge>}</div>{f.description && <div className="list-meta">{f.description}</div>}</td>
            {!simple && <td className="num hide-sm">{formatNGN(b.allocated)}</td>}
            {!simple && <td className="num hide-sm">{formatNGN(b.paid)}</td>}
            {!simple && <td className="num">{formatNGN(b.outstanding)}</td>}
            <td className="num"><strong>{formatNGN(b.available)}</strong></td>
            <td className="hide-sm"><FundBar fund={f} /><span className="list-meta">{b.usedPct}%</span></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

function Ledger({ txs, funds }) {
  const [fundId, setFundId] = useState('all');
  const [type, setType] = useState('all');
  const nav = useNavigate();
  const rows = txs.data.filter((t) => (fundId === 'all' || t.fundId === fundId) && (type === 'all' || t.type === type));
  const sign = (t) => (['refund'].includes(t.type) ? -1 : 1);
  return (
    <Card pad={false}
      title={<div className="row">
        <select value={fundId} onChange={(e) => setFundId(e.target.value)} style={{ width: 'auto' }} aria-label="Fund">
          <option value="all">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }} aria-label="Type">
          <option value="all">All entries</option>{Object.entries(TX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>}
      actions={<Button size="sm" variant="secondary" onClick={() => download(`orp-ledger-${toInputDate(new Date())}.csv`, toCSV(rows, [
        { label: 'Date', value: (t) => fmtDate(t.date) }, { label: 'Type', value: (t) => TX_TYPES[t.type] }, { label: 'Fund', value: 'fundName' },
        { label: 'Request', value: (t) => t.requestTitle || '' }, { label: 'Amount (NGN)', value: (t) => (t.amount / 100).toFixed(2) },
        { label: 'Method', value: 'method' }, { label: 'Reference', value: 'reference' }, { label: 'Note', value: 'note' },
        { label: 'Recorded by', value: 'createdByName' }, { label: 'Recorded at', value: (t) => toDate(t.createdAt)?.toISOString() || '' },
      ]))}>Download CSV</Button>}>
      <p className="muted small" style={{ padding: '10px 18px 0' }}>The ledger is permanent: entries can't be edited or deleted. Corrections are made with a new entry (e.g. a refund or a budget reduction).</p>
      {txs.loading ? <Loading /> : !rows.length ? <Empty title="No ledger entries" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Entry</th><th className="hide-sm">Fund</th><th className="num">Amount</th><th className="hide-sm">Reference</th><th className="hide-sm">By</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} className={t.requestId ? 'clickable' : ''} onClick={() => t.requestId && nav(`/finance/requests/${t.requestId}`)}>
              <td>{fmtDate(t.date)}</td>
              <td><Badge tone={{ payment: 'blue', advance: 'violet', refund: 'amber', receipt: 'green', allocation: 'grey', commit: 'grey', release: 'grey' }[t.type]}>{TX_TYPES[t.type]}</Badge>
                {t.requestTitle && <div className="list-meta">{t.requestTitle}</div>}{t.note && <div className="list-meta">{t.note}</div>}</td>
              <td className="hide-sm">{t.fundName}</td>
              <td className="num">{formatNGN(sign(t) * t.amount)}</td>
              <td className="hide-sm">{t.method ? `${t.method} · ` : ''}{t.reference}</td>
              <td className="hide-sm">{t.createdByName}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function exportRequests(rows) {
  download(`orp-requests-${toInputDate(new Date())}.csv`, toCSV(rows, [
    { label: 'Submitted', value: (r) => fmtDate(r.createdAt) }, { label: 'Title', value: 'title' }, { label: 'Requested by', value: 'requestedByName' },
    { label: 'Ministry', value: 'ministry' }, { label: 'Fund', value: 'fundName' }, { label: 'Category', value: 'category' },
    { label: 'Amount (NGN)', value: (r) => (r.amount / 100).toFixed(2) }, { label: 'Paid (NGN)', value: (r) => (r.paid / 100).toFixed(2) },
    { label: 'Status', value: (r) => REQUEST_STATUS[r.status] }, { label: 'Decided by', value: 'decidedByName' },
  ]));
}

function FinanceReports({ funds, txs, requests }) {
  const now = new Date();
  const [from, setFrom] = useState(toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toInputDate(now));
  const start = fromInputDate(from); const end = fromInputDate(to, true);
  const inRange = txs.filter((t) => { const d = toDate(t.date); return d && d >= start && d <= end; });
  const rows = summarizeLedger(inRange, funds);
  const tot = rows.reduce((a, r) => ({
    allocation: a.allocation + r.allocation, receipt: a.receipt + r.receipt, netCommitted: a.netCommitted + r.netCommitted, netSpent: a.netSpent + r.netSpent,
  }), { allocation: 0, receipt: 0, netCommitted: 0, netSpent: 0 });
  const byCategory = {};
  for (const r of requests) {
    if (!['approved', 'partly_paid', 'paid', 'closed'].includes(r.status)) continue;
    const d = toDate(r.decidedAt || r.createdAt);
    if (!d || d < start || d > end) continue;
    byCategory[r.category] = (byCategory[r.category] || 0) + (r.paid || 0);
  }

  function csv() {
    download(`orp-finance-summary-${from}-to-${to}.csv`, toCSV(rows, [
      { label: 'Fund', value: (r) => r.fund.name },
      { label: 'Budget added (NGN)', value: (r) => (r.allocation / 100).toFixed(2) },
      { label: 'Income received (NGN)', value: (r) => (r.receipt / 100).toFixed(2) },
      { label: 'Approved in period (NGN)', value: (r) => (r.netCommitted / 100).toFixed(2) },
      { label: 'Paid in period, net of refunds (NGN)', value: (r) => (r.netSpent / 100).toFixed(2) },
      { label: 'Current available (NGN)', value: (r) => (fundBalances(r.fund).available / 100).toFixed(2) },
      { label: 'Current unpaid commitments (NGN)', value: (r) => (fundBalances(r.fund).outstanding / 100).toFixed(2) },
    ]));
  }

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <label className="row small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="row small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
        <span className="spacer" />
        <Button variant="secondary" size="sm" onClick={csv}>Download CSV</Button>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Print / save as PDF</Button>
      </div>
      <div className="print-only"><h2>Financial summary</h2><p>{fmtDate(start)} – {fmtDate(end)}</p></div>
      <div className="grid grid-4">
        <Stat label="Budget added" value={formatNGN(tot.allocation)} />
        <Stat label="Income received" value={formatNGN(tot.receipt)} />
        <Stat label="Approved" value={formatNGN(tot.netCommitted)} />
        <Stat label="Paid (net)" value={formatNGN(tot.netSpent)} />
      </div>
      <Card title="By fund" className="section-gap" pad={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>Fund</th><th className="num">Budget added</th><th className="num">Income</th><th className="num">Approved</th><th className="num">Paid (net)</th><th className="num">Available now</th><th className="num">Unpaid now</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.fund.id}><td>{r.fund.name}</td><td className="num">{formatNGN(r.allocation)}</td><td className="num">{formatNGN(r.receipt)}</td>
              <td className="num">{formatNGN(r.netCommitted)}</td><td className="num">{formatNGN(r.netSpent)}</td>
              <td className="num">{formatNGN(fundBalances(r.fund).available)}</td><td className="num">{formatNGN(fundBalances(r.fund).outstanding)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{formatNGN(tot.allocation)}</td><td className="num">{formatNGN(tot.receipt)}</td>
            <td className="num">{formatNGN(tot.netCommitted)}</td><td className="num">{formatNGN(tot.netSpent)}</td><td /><td /></tr></tfoot>
        </table></div>
      </Card>
      <Card title="Paid by category (requests approved in period)" className="section-gap" pad={false}>
        {!Object.keys(byCategory).length ? <Empty title="Nothing in this period" /> : (
          <table><tbody>{Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <tr key={k}><td>{k}</td><td className="num">{formatNGN(v)}</td></tr>
          ))}</tbody></table>
        )}
      </Card>
    </>
  );
}
