import i18n from '../i18n';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatBirthdayCountdown(days: number): string {
  if (days === 0) return i18n.t('format.today');
  if (days === 1) return i18n.t('format.tomorrow');
  return i18n.t('format.inDays', { count: days });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Use the active UI language for month names / ordering.
  return d.toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return i18n.t('format.priceRange', { min, max });
  if (min != null) return i18n.t('format.priceFrom', { min });
  return i18n.t('format.priceUpTo', { max });
}
