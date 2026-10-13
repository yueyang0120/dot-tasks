import type { Review } from './types';

/** RFC 4122 v4 UUID for every new record id. */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** cyrb53 — small, synchronous, stable string hash (not a security primitive). */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Hash of exactly what the user reviews. Any change to these fields invalidates the approval. */
export function draftContentHash(d: Pick<Review, 'channel' | 'to' | 'cc' | 'subject' | 'body'>): string {
  return 'c53:' + cyrb53(JSON.stringify([d.channel, d.to, d.cc, d.subject, d.body]));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number) => String(n).padStart(2, '0');

function dayDiff(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((da - db) / 86400000);
}

export function isSameDay(iso: string, now: Date): boolean {
  return dayDiff(new Date(iso), now) === 0;
}

export function formatToday(now: Date): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
}

/** 今天 18:00 / 明天 12:00 / 周五 10月16日 / 10月14日前 / 已逾期 · … */
export function formatDeadline(at: string, allDay: boolean | undefined, now: Date): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '期限未知';
  const diff = dayDiff(d, now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  let label: string;
  if (allDay) label = diff === 0 ? '今天内' : diff === 1 ? '明天内' : `${md}前`;
  else if (diff === 0) label = `今天 ${hm}`;
  else if (diff === 1) label = `明天 ${hm}`;
  else if (diff > 1 && diff < 7) label = `${WEEK[d.getDay()]} ${md}`;
  else label = md;
  const end = allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) : d;
  return end.getTime() < now.getTime() ? `已逾期 · ${label}` : label;
}

/** Due within 24h or overdue. */
export function isDeadlineHot(at: string, allDay: boolean | undefined, now: Date): boolean {
  const d = new Date(at);
  const end = allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) : d;
  return end.getTime() - now.getTime() < 24 * 3600 * 1000;
}

/** Log timestamps: 刚刚 / 10-11 09:20 */
export function formatLogTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (Math.abs(now.getTime() - d.getTime()) < 60000) return '刚刚';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatClock(iso: string | number): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTimeShort(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  const hm = formatClock(iso);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  if (diff === -1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** `<input type="datetime-local">` value in local time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Non-authoritative preview of how many goals one sentence may contain.
 * Shown only as a hint in the compose sheet; DOT decides the real split after receipt.
 */
export function previewGoals(text: string): string[] {
  return text
    .split(/[。；;！!？?\n]|，?另外|，?还有|，?顺便|，?然后/)
    .map((x) => x.replace(/^[，,\s]+|[，,\s]+$/g, ''))
    .filter((x) => x.length >= 2);
}
