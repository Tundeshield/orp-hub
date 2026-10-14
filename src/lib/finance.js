// Pure finance logic shared by the UI and unit tests. Mirrors firestore.rules.

export const REQUEST_STATUS = {
  pending: 'Awaiting approval',
  clarification: 'Clarification requested',
  approved: 'Approved — unpaid',
  partly_paid: 'Partly paid',
  paid: 'Paid — completed',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const TX_TYPES = {
  allocation: 'Budget allocation',
  receipt: 'Income received',
  commit: 'Approval (commitment)',
  payment: 'Payment',
  advance: 'Advance',
  refund: 'Refund',
  release: 'Commitment released',
};

export function fundBalances(fund) {
  const allocated = fund?.allocated || 0;
  const committed = fund?.committed || 0;
  const paid = fund?.paid || 0;
  return {
    allocated,
    committed,
    paid,
    available: allocated - committed,      // can still be approved
    outstanding: committed - paid,          // approved but not yet paid
    cashRemaining: allocated - paid,        // budget minus money actually spent
    usedPct: allocated > 0 ? Math.min(100, Math.round((committed / allocated) * 100)) : 0,
  };
}

export function requestOutstanding(req) {
  return (req.amount || 0) - (req.paid || 0) - (req.released || 0);
}

// Returns { fundPatch, requestPatch } describing the effect of a ledger entry,
// or throws an Error with a user-readable message when the entry is not allowed.
export function applyLedger(type, amount, fund, req) {
  if (!Number.isInteger(amount)) throw new Error('Amount must be a whole number of kobo.');
  const f = { allocated: fund.allocated || 0, committed: fund.committed || 0, paid: fund.paid || 0 };
  switch (type) {
    case 'allocation': {
      if (amount === 0) throw new Error('Enter an amount.');
      const allocated = f.allocated + amount;
      if (allocated < f.committed) throw new Error('This would reduce the budget below what is already committed.');
      return { fundPatch: { allocated }, requestPatch: null };
    }
    case 'receipt': {
      if (amount <= 0) throw new Error('Enter a positive amount.');
      return { fundPatch: { allocated: f.allocated + amount }, requestPatch: null };
    }
    case 'commit': {
      if (!req || req.status !== 'pending') throw new Error('Only pending requests can be approved.');
      if (amount !== req.amount) throw new Error('Approval amount must equal the requested amount.');
      const committed = f.committed + amount;
      if (committed > f.allocated) {
        throw new Error('Insufficient funds: approving this would exceed the fund\'s available balance.');
      }
      return { fundPatch: { committed }, requestPatch: { status: 'approved' } };
    }
    case 'payment':
    case 'advance': {
      if (!req || !['approved', 'partly_paid'].includes(req.status)) throw new Error('Only approved, unpaid requests can be paid.');
      if (amount <= 0) throw new Error('Enter a positive amount.');
      const remaining = requestOutstanding(req);
      if (amount > remaining) throw new Error('Payment is more than the amount still owed on this request.');
      const paid = (req.paid || 0) + amount;
      const status = paid + (req.released || 0) === req.amount ? 'paid' : 'partly_paid';
      return { fundPatch: { paid: f.paid + amount }, requestPatch: { paid, status } };
    }
    case 'refund': {
      if (!req || !['partly_paid', 'paid'].includes(req.status)) throw new Error('Refunds apply to requests that have been paid.');
      if (amount <= 0) throw new Error('Enter a positive amount.');
      if (amount > (req.paid || 0)) throw new Error('Refund is more than what was paid.');
      const paid = req.paid - amount;
      return { fundPatch: { paid: f.paid - amount }, requestPatch: { paid, status: paid === 0 ? 'approved' : 'partly_paid' } };
    }
    case 'release': {
      if (!req || !['approved', 'partly_paid'].includes(req.status)) throw new Error('Only open approved requests can be closed.');
      const remaining = requestOutstanding(req);
      if (amount !== remaining || remaining <= 0) throw new Error('Release amount must equal the unpaid balance.');
      return {
        fundPatch: { committed: f.committed - amount },
        requestPatch: { released: (req.released || 0) + amount, status: 'closed' },
      };
    }
    default:
      throw new Error('Unknown transaction type.');
  }
}

// Summaries for reports: totals per fund and per type from ledger entries.
export function summarizeLedger(transactions, funds) {
  const byFund = {};
  for (const fund of funds) {
    byFund[fund.id] = { fund, allocation: 0, receipt: 0, commit: 0, payment: 0, advance: 0, refund: 0, release: 0 };
  }
  for (const tx of transactions) {
    const row = byFund[tx.fundId];
    if (row && row[tx.type] !== undefined) row[tx.type] += tx.amount;
  }
  return Object.values(byFund).map((r) => ({
    ...r,
    netSpent: r.payment + r.advance - r.refund,
    netCommitted: r.commit - r.release,
  }));
}
