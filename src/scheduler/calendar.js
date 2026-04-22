/**
 * US NYSE trading calendar.
 *
 * Provides:
 *   isTradingDay(dateStr)  — true if the given YYYY-MM-DD is a market-open day
 *   todayET()              — YYYY-MM-DD in Eastern Time
 *   nextTradingDay(dateStr) — next trading day after the given date
 *
 * Holiday list covers 2025–2027. Update NYSE_HOLIDAYS each year.
 */

// ─── NYSE Holiday List ────────────────────────────────────────────────────────
// All dates are YYYY-MM-DD. Observed dates used when the holiday falls on a
// weekend (e.g. Jul 4 on Saturday → exchange closed Friday Jul 3).

const NYSE_HOLIDAYS = new Set([
  // ── 2025 ──────────────────────────────────────────────────
  '2025-01-01', // New Year's Day
  '2025-01-20', // Martin Luther King Jr. Day
  '2025-02-17', // Presidents' Day
  '2025-04-18', // Good Friday  (Easter Apr 20)
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving Day
  '2025-12-25', // Christmas Day

  // ── 2026 ──────────────────────────────────────────────────
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday  (Easter Apr 5)
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day observed (Jul 4 = Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day

  // ── 2027 ──────────────────────────────────────────────────
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King Jr. Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Good Friday  (Easter Mar 28)
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth observed (Jun 19 = Saturday)
  '2027-07-05', // Independence Day observed (Jul 4 = Sunday)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving Day
  '2027-12-24', // Christmas observed (Dec 25 = Saturday)
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return today as YYYY-MM-DD in US Eastern Time. */
export function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Return true if the given YYYY-MM-DD string is a NYSE trading day:
 *   - Monday through Friday
 *   - Not a listed holiday
 */
export function isTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`); // noon UTC avoids DST edge cases
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return false;
  if (NYSE_HOLIDAYS.has(dateStr)) return false;
  return true;
}

/**
 * Return the next trading day after the given YYYY-MM-DD (exclusive).
 * Searches forward up to 14 days to skip long holiday breaks.
 */
export function nextTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 1; i <= 14; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const candidate = d.toISOString().slice(0, 10);
    if (isTradingDay(candidate)) return candidate;
  }
  return null;
}

/**
 * Return the previous trading day before the given YYYY-MM-DD (exclusive).
 */
export function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 1; i <= 14; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const candidate = d.toISOString().slice(0, 10);
    if (isTradingDay(candidate)) return candidate;
  }
  return null;
}
