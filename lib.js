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

// ── Branch birthdays (free beer that day) ──────────────────────────────────
// Keyed by 'MM-DD'. Aliases cover the exact strings the signup form can store.
const BRANCH_BIRTHDAYS = {
  'Army': '06-14',
  'Navy': '10-13',
  'Marine Corps': '11-10',
  'Marines': '11-10',
  'Air Force': '09-18',
  'Coast Guard': '08-04',
  'Space Force': '12-20',
};
const VETERANS_DAY = '11-11'; // everyone, regardless of branch

// 'MM-DD' / 'YYYY-MM-DD' for "now" in the brewery's timezone
function todayMMDD(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: '2-digit', day: '2-digit' }).format(date);
}
function todayYMD(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Is today a free-beer occasion for this member? Returns { date, label, kind } or null.
// kind: 'branch' (their branch's birthday) or 'veterans' (Nov 11, everyone).
function birthdayOccasion(member, date = new Date()) {
  const mmdd = todayMMDD(date);
  const branchDay = member && member.branch ? BRANCH_BIRTHDAYS[member.branch] : null;
  if (branchDay && branchDay === mmdd) {
    return { date: todayYMD(date), label: `${member.branch} Birthday`, kind: 'branch' };
  }
  if (mmdd === VETERANS_DAY) {
    return { date: todayYMD(date), label: 'Veterans Day', kind: 'veterans' };
  }
  return null;
}

// Human label for a member's branch birthday, e.g. "Oct 14" (for the pass back).
function branchBirthdayLabel(branch) {
  const d = BRANCH_BIRTHDAYS[branch];
  if (!d) return null;
  const [m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(2000, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

module.exports = {
  TZ, currentMonth, isPintAvailable, nextPintLabel, currentMonthName,
  BRANCH_BIRTHDAYS, VETERANS_DAY, todayMMDD, todayYMD, birthdayOccasion, branchBirthdayLabel,
};
