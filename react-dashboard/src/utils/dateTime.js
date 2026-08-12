const DEFAULT_TIME_ZONE = 'Africa/Nairobi';
const TIME_ZONE_STORAGE_KEY = 'dashboard_timezone';

export function getDashboardTimeZone() {
  if (typeof window === 'undefined') return DEFAULT_TIME_ZONE;
  return localStorage.getItem(TIME_ZONE_STORAGE_KEY) || DEFAULT_TIME_ZONE;
}

export function setDashboardTimeZone(timeZone) {
  if (typeof window === 'undefined') return;
  if (timeZone === DEFAULT_TIME_ZONE) localStorage.removeItem(TIME_ZONE_STORAGE_KEY);
  else localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZone);
  window.dispatchEvent(new CustomEvent('dashboard-timezone-change', { detail: timeZone }));
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value);
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const formatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

export function formatDateTime(value, fallback = 'Unknown') {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    ...formatOptions,
    timeZone: getDashboardTimeZone(),
  }).format(date);
}

export function formatDate(value, fallback = 'Unknown') {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: getDashboardTimeZone(),
  }).format(date);
}

export function formatTime(value, fallback = 'Unknown') {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: getDashboardTimeZone(),
  }).format(date);
}

export { DEFAULT_TIME_ZONE, TIME_ZONE_STORAGE_KEY };