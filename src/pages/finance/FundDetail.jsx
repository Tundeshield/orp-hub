import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { updateDoc, serverTimestamp } from 'firebase/firestore';

import { useAuth } from '../../AuthContext.jsx';
import { col, query, where, useDoc, useLive } from '../../lib/db.js';
import { can, isFinanceViewer } from '../../lib/roles.js';
import { formatNGN } from '../../lib/money.js';
import { fundBalances, TX_TYPES } from '../../lib/finance.js';
import { fmtDate, toDate } from '../../lib/dates.js';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader, Stat, useAction } from '../../components/ui.jsx';
import { FundLedgerForm } from './forms.jsx';
import { RequestsTable, FundBar } from './Finance.jsx';
import { bdoc } from '../../lib/db.js';

export default function FundDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { data: fund, loading } = useDoc('funds', id);
  const viewer = isFinanceViewer(profile);
  const reqs = useLive(() => viewer ? query(col('requests'), where('fundId', '==', id)) : null, [viewer, id]);
  const txs = useLive(() => viewer ? query(col('transactions'), where('fundId', '==', id)) : null, [viewer, id]);
  const [modal, setModal] = useState(null);
  const archive = useAction();

  if (loading) return <Loading />;
  if (!fund) return <Empty title="Fund not found"><Link to="/finance">Back to Finance</Link></Empty>;
  const b = fundBalances(fund);
  const manager = can(profile, 'finance', 'pastor', 'admin');

  return (
    <>
      <p className="small"><Link to="/finance">← Finance</Link></p>
      <PageHeader title={fund.name} subtitle={fund.description}
        actions={manager && <>
          <Button onClick={() => setModal('allocation')} disabled={!fund.active}>Adjust budget</Button>
          {can(profile, 'finance') && <Button variant="secondary" onClick={() => setModal('receipt')} disabled={!fund.active}>Record income</Button>}
          <Button variant="ghost" busy={archive.busy} onClick={() => archive.run(() => updateDoc(bdoc('funds', id), { active: !fund.active, updatedAt: serverTimestamp() }), fund.active ? 'Fund archived' : 'Fund restored')}>
            {fund.active ? 'Archive' : 'Restore'}
          </Button>
        </>} />
      <ErrorNote error={archive.error} />
      <div className="grid grid-4">
        <Stat label="Budget" value={formatNGN(b.allocated)} />
        <Stat label="Spent" value={formatNGN(b.paid)} />
        <Stat label="Approved, unpaid" value={formatNGN(b.outstanding)} tone={b.outstanding ? 'amber' : ''} />
        <Stat label="Available" value={formatNGN(b.available)} tone="green" sub={`${b.usedPct}% committed`} />
      </div>
      <div style={{ margin: '14px 0' }}><FundBar fund={fund} /></div>
      {viewer && (
        <>
          <Card title="Requests from this fund" pad={false}>
            {reqs.loading ? <Loading /> : <RequestsTable rows={[...reqs.data].sort((x, y) => toDate(y.createdAt) - toDate(x.createdAt))} />}
          </Card>
          <Card title="Ledger" className="section-gap" pad={false}>
            {txs.loading ? <Loading /> : !txs.data.length ? <Empty title="No entries yet" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Entry</th><th className="num">Amount</th><th className="hide-sm">By</th></tr></thead>
                <tbody>{[...txs.data].sort((x, y) => toDate(y.createdAt) - toDate(x.createdAt)).map((t) => (
                  <tr key={t.id}><td>{fmtDate(t.date)}</td>
                    <td>{TX_TYPES[t.type]}{t.requestTitle && <div className="list-meta"><Link to={`/finance/requests/${t.requestId}`}>{t.requestTitle}</Link></div>}{t.note && <div className="list-meta">{t.note}</div>}</td>
                    <td className="num">{formatNGN(t.type === 'refund' ? -t.amount : t.amount)}</td><td className="hide-sm">{t.createdByName}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
      <FundLedgerForm open={modal === 'allocation'} type="allocation" fundId={id} funds={[fund]} onClose={() => setModal(null)} />
      <FundLedgerForm open={modal === 'receipt'} type="receipt" fundId={id} funds={[fund]} onClose={() => setModal(null)} />
    </>
  );
}
