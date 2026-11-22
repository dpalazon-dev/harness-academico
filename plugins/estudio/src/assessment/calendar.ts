import { AssessmentError } from './types.ts';

const DAY_MS = 86_400_000;

function invalid(message: string): never {
  throw new AssessmentError('INVALID_INPUT', message);
}

/** Canonical UTC instants, with millisecond precision and a four-digit CE year. */
export function instantMillis(instant: string): number {
  if (typeof instant !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    invalid('Expected a canonical UTC ISO timestamp');
  }
  const value = Date.parse(instant);
  if (!Number.isFinite(value) || new Date(value).toISOString() !== instant) {
    invalid('Invalid UTC timestamp');
  }
  return value;
}

function dateMillis(date: string): number {
  if (typeof date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) {
    invalid('Expected a Gregorian YYYY-MM-DD date');
  }
  return instantMillis(`${date}T00:00:00.000Z`);
}

export function localDate(instant: string, timeZone: string): string {
  const value = instantMillis(instant);
  if (typeof timeZone !== 'string' || !timeZone) invalid('A time zone is required');
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
    }).formatToParts(value);
    const read = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    if (read('era') !== 'AD') invalid('Local date is outside the supported CE range');
    const date = `${read('year').padStart(4, '0')}-${read('month')}-${read('day')}`;
    dateMillis(date);
    return date;
  } catch (error) {
    if (error instanceof AssessmentError) throw error;
    invalid('Unsupported time zone');
  }
}

/** UTC is an arithmetic coordinate for Gregorian dates, never a local 24h shift. */
export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) invalid('Days must be a safe integer');
  const value = dateMillis(date) + days * DAY_MS;
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) invalid('Date is outside the supported range');
  const result = new Date(value).toISOString().slice(0, 10);
  dateMillis(result);
  return result;
}

export function daysBetween(first: string, last: string): number {
  return (dateMillis(last) - dateMillis(first)) / DAY_MS;
}
