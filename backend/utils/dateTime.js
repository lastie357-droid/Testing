const DEFAULT_TIME_ZONE = 'Africa/Nairobi';

function formatDateTime(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
    ? Number(value)
    : null;
  const date = numeric === null
    ? new Date(value)
    : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  if (Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
    timeZone: DEFAULT_TIME_ZONE,
  }).format(date);
}

module.exports = { DEFAULT_TIME_ZONE, formatDateTime };