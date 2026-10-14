// All money is stored as integer kobo (1 NGN = 100 kobo) to avoid rounding errors.
const fmt = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 });

export function formatNGN(kobo) {
  const n = Number(kobo) || 0;
  return fmt.format(n / 100).replace('NGN', '₦').replace(/^₦\s?/, '₦');
}

// Parse a user-typed naira amount ("15,000", "₦2,500.50") into integer kobo.
// Returns null when the input is not a valid positive amount.
export function parseNGN(input, { allowNegative = false } = {}) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₦,\s]/g, '').replace(/^NGN/i, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const kobo = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(kobo)) return null;
  if (kobo === 0) return null;
  if (negative && !allowNegative) return null;
  return negative ? -kobo : kobo;
}

export function koboToInput(kobo) {
  return ((Number(kobo) || 0) / 100).toFixed(2);
}
