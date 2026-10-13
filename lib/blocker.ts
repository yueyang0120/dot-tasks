export function validBlocker(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000;
  if (!['step', 'reason', 'next'].every(k => text(b[k]))) return false;
  if (b.sharedKey !== undefined && (typeof b.sharedKey !== 'string' || !b.sharedKey.trim() || b.sharedKey.length > 150)) return false;
  if (!['current_check', 'last_record', 'not_checked'].includes(b.basis as string)) return false;
  if (b.observedAt !== undefined && (typeof b.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(b.observedAt) || !Number.isFinite(Date.parse(b.observedAt)))) return false;
  return b.basis !== 'current_check' || b.observedAt !== undefined;
}

export function checkBlockedReport(dot: any) {
  if (dot?.status === 'blocked' && !validBlocker(dot.blocker)) throw new Error('BLOCKER_DETAILS_REQUIRED');
}
