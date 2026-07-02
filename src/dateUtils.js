// Parses a 'YYYY-MM-DD' date string as a local-time Date, avoiding the classic
// bug where `new Date('2026-07-01')` parses as UTC midnight, then reading
// .getMonth()/.getDate() (local-time getters) silently shifts the date back
// a day in any timezone behind UTC.
export function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
