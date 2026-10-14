import { describe, it, expect } from 'vitest';
import { applyLedger, fundBalances, requestOutstanding, summarizeLedger } from './finance.js';
import { parseNGN, formatNGN } from './money.js';

const fund = (allocated, committed = 0, paid = 0) => ({ allocated, committed, paid });
const req = (o) => ({ amount: 100000, paid: 0, released: 0, status: 'pending', ...o });

describe('money', () => {
  it('parses naira into integer kobo without float error', () => {
    expect(parseNGN('15,000')).toBe(1500000);
    expect(parseNGN('₦2,500.50')).toBe(250050);
    expect(parseNGN('0.1')).toBe(10);
    expect(parseNGN('19.99')).toBe(1999);
    expect(parseNGN('abc')).toBeNull();
    expect(parseNGN('-5')).toBeNull();
    expect(parseNGN('-5', { allowNegative: true })).toBe(-500);
    expect(parseNGN('1.234')).toBeNull();
    expect(parseNGN('0')).toBeNull();
  });
  it('formats kobo as naira', () => {
    expect(formatNGN(1500000)).toBe('₦15,000.00');
    expect(formatNGN(250050)).toBe('₦2,500.50');
  });
});

describe('fund balances', () => {
  it('computes available, outstanding and spent', () => {
    const b = fundBalances(fund(1_000_000, 600_000, 250_000));
    expect(b.available).toBe(400_000);
    expect(b.outstanding).toBe(350_000);
    expect(b.cashRemaining).toBe(750_000);
    expect(b.usedPct).toBe(60);
  });
});

describe('ledger rules (overspending prevention)', () => {
  it('approves within available budget', () => {
    const r = applyLedger('commit', 100000, fund(500000, 300000), req());
    expect(r.fundPatch.committed).toBe(400000);
    expect(r.requestPatch.status).toBe('approved');
  });
  it('refuses approval that exceeds available budget', () => {
    expect(() => applyLedger('commit', 100000, fund(350000, 300000), req())).toThrow(/Insufficient funds/);
  });
  it('allows approval that uses the budget exactly', () => {
    expect(applyLedger('commit', 100000, fund(400000, 300000), req()).fundPatch.committed).toBe(400000);
  });
  it('refuses approval amount different from request', () => {
    expect(() => applyLedger('commit', 50000, fund(500000), req())).toThrow();
  });
  it('refuses approving non-pending requests', () => {
    expect(() => applyLedger('commit', 100000, fund(500000), req({ status: 'approved' }))).toThrow();
  });
  it('partial then full payment', () => {
    const f = fund(500000, 100000, 0);
    const r1 = applyLedger('payment', 40000, f, req({ status: 'approved' }));
    expect(r1.requestPatch).toEqual({ paid: 40000, status: 'partly_paid' });
    expect(r1.fundPatch.paid).toBe(40000);
    const r2 = applyLedger('payment', 60000, { ...f, paid: 40000 }, req({ status: 'partly_paid', paid: 40000 }));
    expect(r2.requestPatch).toEqual({ paid: 100000, status: 'paid' });
  });
  it('refuses overpayment', () => {
    expect(() => applyLedger('payment', 100001, fund(500000, 100000), req({ status: 'approved' }))).toThrow(/more than/);
  });
  it('refuses paying an unapproved request', () => {
    expect(() => applyLedger('payment', 1000, fund(500000), req())).toThrow();
  });
  it('advance behaves like payment', () => {
    expect(applyLedger('advance', 100000, fund(500000, 100000), req({ status: 'approved' })).requestPatch.status).toBe('paid');
  });
  it('refund reduces paid and reopens the request', () => {
    const r = applyLedger('refund', 30000, fund(500000, 100000, 100000), req({ status: 'paid', paid: 100000 }));
    expect(r.requestPatch).toEqual({ paid: 70000, status: 'partly_paid' });
    expect(r.fundPatch.paid).toBe(70000);
  });
  it('refuses refund above amount paid', () => {
    expect(() => applyLedger('refund', 50000, fund(500000, 100000, 40000), req({ status: 'partly_paid', paid: 40000 }))).toThrow();
  });
  it('release frees the unpaid commitment and closes', () => {
    const r = applyLedger('release', 30000, fund(500000, 100000, 70000), req({ status: 'partly_paid', paid: 70000 }));
    expect(r.fundPatch.committed).toBe(70000);
    expect(r.requestPatch).toEqual({ released: 30000, status: 'closed' });
  });
  it('release must equal outstanding', () => {
    expect(() => applyLedger('release', 10000, fund(500000, 100000, 70000), req({ status: 'partly_paid', paid: 70000 }))).toThrow();
  });
  it('budget cannot be reduced below commitments', () => {
    expect(() => applyLedger('allocation', -300000, fund(500000, 300000), null)).toThrow(/below/);
    expect(applyLedger('allocation', -200000, fund(500000, 300000), null).fundPatch.allocated).toBe(300000);
  });
  it('income adds to the budget', () => {
    expect(applyLedger('receipt', 5000, fund(0), null).fundPatch.allocated).toBe(5000);
  });
  it('rejects non-integer amounts', () => {
    expect(() => applyLedger('receipt', 10.5, fund(0), null)).toThrow();
  });
  it('full lifecycle keeps the fund consistent', () => {
    let f = fund(0); let r = req({ amount: 250000 });
    const step = (type, amt) => { const o = applyLedger(type, amt, f, r); f = { ...f, ...o.fundPatch }; if (o.requestPatch) r = { ...r, ...o.requestPatch }; };
    step('allocation', 1000000);
    step('commit', 250000);
    step('advance', 200000);
    step('refund', 20000);
    step('release', requestOutstanding(r));
    expect(r.status).toBe('closed');
    expect(f).toEqual({ allocated: 1000000, committed: 180000, paid: 180000 });
    expect(fundBalances(f).outstanding).toBe(0);
    expect(fundBalances(f).available).toBe(820000);
  });
});

describe('summaries', () => {
  it('totals ledger entries per fund', () => {
    const funds = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const txs = [
      { fundId: 'a', type: 'allocation', amount: 1000 }, { fundId: 'a', type: 'payment', amount: 300 },
      { fundId: 'a', type: 'refund', amount: 100 }, { fundId: 'b', type: 'commit', amount: 50 }, { fundId: 'b', type: 'release', amount: 20 },
    ];
    const s = summarizeLedger(txs, funds);
    expect(s[0].netSpent).toBe(200);
    expect(s[1].netCommitted).toBe(30);
  });
});
