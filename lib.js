/**
 * Shared helpers for the Bullfrog Salutes veterans program.
 *
 * The free-pint rule is ONE per calendar month. We anchor "the month" to the
 * brewery's local timezone (Florida = America/New_York) so a pint redeemed at
 * 11pm on the 31st and a pint at 1am on the 1st land in different months
 * correctly, regardless of where the server runs (Railway is UTC).
 */

const TZ = process.env.BREWERY_TZ || 'America/New_York';

// Returns 'YYYY-MM' for "now" (or a given Date) in the brewery's timezone.
function currentMonth(date = new Date()) {
  // en-CA gives YYYY-MM-DD; slice to YYYY-MM
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  return ymd.slice(0, 7);
}

// Is this member eligible for a free pint right now?
// Eligible only if verified AND they have not already redeemed this calendar month.
function isPintAvailable(member) {
  if (!member || !member.verified) return false;
  return member.last_pint_month !== currentMonth();
}

// Human label for when the next pint unlocks (the 1st of next month).
function nextPintLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric',
  }).formatToParts(date);
  let y = Number(parts.find(p => p.type === 'year').value);
  let m = Number(parts.find(p => p.type === 'month').value); // 1-12
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long' });
  return `${monthName} 1`;
}

// Pretty month name for the current month, e.g. "June"
function currentMonthName(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(date);
}

module.exports = { TZ, currentMonth, isPintAvailable, nextPintLabel, currentMonthName };
