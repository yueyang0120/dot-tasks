import type { Monitor, MonitorField } from '../components/workbench/types';

export const monitorFields: MonitorField[] = ['sources','freq','time','tz','until','notify'];
const populated = (v: unknown) => Array.isArray(v) ? v.length > 0 : typeof v === 'string' && !!v.trim();

/** Legacy rows stay readable; they are never relabelled as user instructions. */
export function validMonitorOrigins(m: Monitor): boolean {
  if (m.fieldOrigins === undefined) return true;
  if (typeof m.what !== 'string' || !Array.isArray(m.sources) || !Array.isArray(m.notify) || ![null,'每小时','每天','每周'].includes(m.freq) || ![m.time,m.tz,m.until].every(v=>typeof v==='string')) return false;
  if (!m.fieldOrigins || typeof m.fieldOrigins !== 'object' || Array.isArray(m.fieldOrigins)) return false;
  return Object.entries(m.fieldOrigins).every(([k,o]) => monitorFields.includes(k as MonitorField) && o &&
    ['user_selected','user_instruction','dot_suggestion'].includes(o.kind) &&
    (o.kind !== 'user_instruction' || (typeof o.quote === 'string' && !!o.quote.trim() && m.what.includes(o.quote)))) &&
    monitorFields.every(k => !populated(m[k]) || !!m.fieldOrigins?.[k]);
}

/** Agent writes must not invent a user's selection or an unsupported extraction. */
export function checkMonitorPatch(target: Monitor, patch: Partial<Monitor>) {
  const merged = {...target,...patch};
  for (const k of monitorFields) {
    if (!Object.hasOwn(patch,k) && !Object.hasOwn(patch.fieldOrigins ?? {},k)) continue;
    if (!populated(merged[k])) continue;
    const o=merged.fieldOrigins?.[k];
    if (!o) throw new Error('MONITOR_FIELD_ORIGIN_REQUIRED');
    if (o.kind==='user_selected' && (target.fieldOrigins?.[k]?.kind !== 'user_selected' || JSON.stringify(merged[k]) !== JSON.stringify(target[k]))) throw new Error('USER_SELECTION_REQUIRED');
    if (o.kind==='user_instruction' && (typeof o.quote!=='string'||!o.quote.trim()||!target.what.includes(o.quote))) throw new Error('USER_INSTRUCTION_QUOTE_REQUIRED');
    if (o.kind==='dot_suggestion' && merged.status==='active') throw new Error('MONITOR_SUGGESTION_NOT_CONFIRMED');
  }
  if (patch.status==='active' && monitorFields.some(k=>populated(merged[k]) && (!merged.fieldOrigins?.[k] || merged.fieldOrigins[k]?.kind==='dot_suggestion'))) throw new Error('MONITOR_PREFERENCES_UNCONFIRMED');
  if (!validMonitorOrigins(merged)) throw new Error('MONITOR_FIELD_ORIGIN_REQUIRED');
}
