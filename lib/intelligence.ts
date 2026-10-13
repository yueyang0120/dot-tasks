import { validateCollaboration } from './collaboration';
import type { Signal, Task, TaskPlan, WorkbenchState, WorkPreference } from '../components/workbench/types';

const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
export const hasResult = (t: Task) => t.state === 'completed' || (t.dot?.status === 'completed' && text(t.dot.receipt) && !!t.evidence?.length);

export function relatedTasks(s: WorkbenchState, query: string) {
  const q = query.trim().toLocaleLowerCase();
  const words = [...new Set([...(q.match(/[a-z0-9][a-z0-9_-]+/g) ?? []), ...(q.match(/[\u4e00-\u9fff]{2,}/g) ?? []).flatMap(part => Array.from({length: part.length-1}, (_, i) => part.slice(i,i+2)))])].filter(w => !['这个','一下','帮我','我们','然后','可以','事情','请你','怎么','什么','需要','工作','今天','时候'].includes(w)).slice(0,60);
  if (!words.length) throw new Error('QUERY_REQUIRED');
  return s.tasks.map(t => {
    const body = [t.title,t.goal,t.briefing?.background,t.briefing?.latest,t.sourceKey,...(s.contexts??[]).filter(c=>c.taskId===t.id).map(c=>c.summary||c.label)].join(' ').toLocaleLowerCase();
    return {id:t.id,title:t.title,state:t.state,owner:t.owner,score:words.filter(w=>body.includes(w)).length,background:t.briefing?.background};
  }).filter(t=>t.score>0).sort((a,b)=>b.score-a.score).slice(0,8);
}

export function validPlan(p: unknown): p is TaskPlan {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const v = p as TaskPlan;
  return text(v.nextAction) && text(v.why) && Array.isArray(v.dependsOn) && v.dependsOn.length <= 20 && v.dependsOn.every(x => text(x, 150)) && new Set(v.dependsOn).size === v.dependsOn.length
    && (v.prepareWhileWaiting === undefined || typeof v.prepareWhileWaiting === 'boolean')
    && (v.sharedBlockerKey === undefined || text(v.sharedBlockerKey, 150))
    && (v.checkpoint === undefined || text(v.checkpoint))
    && (v.lastCheckedAt === undefined || iso(v.lastCheckedAt)) && (v.nextCheckAt === undefined || iso(v.nextCheckAt));
}

export function validateIntelligence(s: WorkbenchState) {
  validateCollaboration(s);
  for (const t of s.tasks) {
    if(t.activeReviewId !== undefined && (!text(t.activeReviewId) || !s.reviews.some(r=>r.id===t.activeReviewId&&r.taskId===t.id)))throw new Error('INVALID_ACTIVE_REVIEW');
    if (t.sourceKey !== undefined && !text(t.sourceKey,200)) throw new Error('INVALID_SOURCE_KEY');
    if (t.plan != null && !validPlan(t.plan)) throw new Error('INVALID_TASK_PLAN');
    if (t.plan?.dependsOn.some(id => id === t.id || !s.tasks.some(x => x.id === id))) throw new Error('INVALID_DEPENDENCY');
    if (t.lease != null && (!text(t.lease.id) || !text(t.lease.handoffId) || !iso(t.lease.expiresAt))) throw new Error('INVALID_LEASE');
  }
  const done = new Set<string>(), visiting = new Set<string>();
  function visit(t: Task) {
    if (visiting.has(t.id)) throw new Error('DEPENDENCY_CYCLE');
    if (done.has(t.id)) return;
    visiting.add(t.id);
    for (const id of t.plan?.dependsOn ?? []) visit(s.tasks.find(x => x.id === id)!);
    visiting.delete(t.id); done.add(t.id);
  }
  s.tasks.forEach(visit);
  for (const key of ['signals', 'preferences'] as const) {
    const rows = s[key];
    if (rows !== undefined && (!Array.isArray(rows) || rows.length > 1000 || new Set(rows.map(x => x?.id)).size !== rows.length)) throw new Error('INVALID_INTELLIGENCE_RECORDS');
  }
  if (s.signals?.some(v => !validSignal(v) || !text(v.id) || !iso(v.recordedAt) || !['new','seen','dismissed'].includes(v.state) || (v.taskId && !s.tasks.some(t => t.id === v.taskId)) || (v.delivery && (!text(v.delivery.id) || !iso(v.delivery.at) || !['reserved','delivered'].includes(v.delivery.status) || (v.delivery.status === 'delivered' && !text(v.delivery.receipt)))))) throw new Error('INVALID_SIGNAL');
  if (s.preferences?.some(v => !text(v.id) || !text(v.text) || !text(v.sourceId) || !text(v.quote) || !iso(v.updatedAt) || !['user_instruction','dot_suggestion'].includes(v.basis))) throw new Error('INVALID_PREFERENCE');
}

export function sharedBlockers(s: WorkbenchState) {
  const groups = new Map<string, Task[]>();
  for (const t of s.tasks.filter(t => t.state === 'open')) {
    const key = t.dot?.status === 'blocked' ? t.dot.blocker?.sharedKey || t.plan?.sharedBlockerKey : t.owner === 'user' ? t.plan?.sharedBlockerKey : undefined;
    if (key) groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups].map(([key, tasks]) => ({key, tasks, next: tasks.find(t => t.dot?.blocker)?.dot?.blocker?.next || tasks[0].plan?.nextAction || ''}));
}

/** This is a work queue, not a scheduler, source check, or permission grant. */
export function planPull(s: WorkbenchState, now: Date) {
  const ready: {id:string;title:string;nextAction:string;reason:string;score:number;handoffId:string;purpose:'task'|'preparation'}[] = [];
  const deferred: {id:string;title:string;reason:string}[] = [];
  const groups = sharedBlockers(s);
  for (const t of s.tasks) {
    if (t.state !== 'open' || hasResult(t)) continue;
    let reason = '';
    const preparing = t.owner === 'user' && t.plan?.prepareWhileWaiting === true && !!t.need && ['material','clarify','choose'].includes(t.need.kind);
    const handoffId = preparing ? t.need!.id : t.dot?.handoffId;
    if (t.owner === 'user' && !preparing) reason = '有一步需要本人回答或办理';
    else if (t.lease && t.lease.handoffId === handoffId && Date.parse(t.lease.expiresAt) > +now) reason = '已有一轮正在处理，避免重复';
    else if (t.plan?.dependsOn.some(id => !hasResult(s.tasks.find(x => x.id === id)!))) reason = '先等相关事项推进';
    else if (t.dot?.status !== 'queued' && t.plan?.nextCheckAt && Date.parse(t.plan.nextCheckAt) > +now) reason = '还没到计划再看的时间';
    if (reason) { deferred.push({id:t.id,title:t.title,reason}); continue; }
    const waitAge = Math.min(200, Math.max(0, (+now - Date.parse(t.plan?.lastCheckedAt || t.createdAt)) / 3600000));
    const deadline = t.deadline && Date.parse(t.deadline.at) - +now <= 86400000 ? 250 : 0;
    ready.push({id:t.id,title:t.title,nextAction:t.plan?.nextAction || t.dot?.blocker?.next || t.dot?.summary || '先核对来源，再确定下一步',reason:t.plan?.why || '尚有可以核对或推进的步骤',score:(t.dot?.status === 'queued' ? 1000 : 0) + ({P0:600,P1:300,P2:100}[t.priority!] ?? 50) + waitAge + deadline,handoffId:handoffId!,purpose:preparing?'preparation':'task'});
  }
  ready.sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = new Set<string>();
  const candidates = ready.filter(t => {
    const group = groups.find(g => g.tasks.some(x => x.id === t.id));
    if (!group) return true;
    if (selected.has(group.key)) { deferred.push({id:t.id,title:t.title,reason:'与另一件事共用同一个阻塞，这轮只核对一次'}); return false; }
    selected.add(group.key); return true;
  });
  return {budget:{maxTasks:5,maxStepsPerTask:3,maxMinutes:5},candidates:candidates.slice(0,5),deferred,sharedBlockers:groups.map(g => ({key:g.key,taskIds:g.tasks.map(t => t.id),titles:g.tasks.map(t => t.title),next:g.next})),pendingSignals:(s.signals ?? []).filter(v => v.state === 'new' && v.attention !== 'quiet' && !v.delivery),preferences:(s.preferences ?? []).filter(p => p.basis === 'user_instruction' && p.status !== 'inactive')};
}

export function claimTask(s: WorkbenchState, id: string, handoffId: string, now: Date, leaseId: string, purpose: 'task'|'preparation' = 'task') {
  const t = s.tasks.find(t => t.id === id);
  if (!t || t.state !== 'open') throw new Error('TASK_CLOSED_OR_PAUSED');
  if (purpose === 'preparation' ? t.owner !== 'user' || t.need?.id !== handoffId : t.owner !== 'dot' || t.dot?.handoffId !== handoffId) throw new Error('HANDOFF_CHANGED');
  if (!planPull(s,now).candidates.some(c => c.id === id && c.purpose === purpose)) throw new Error('TASK_NOT_READY');
  t.lease = {id:leaseId,handoffId,purpose,expiresAt:new Date(+now + 10*60000).toISOString()};
  return t.lease;
}

export function checkLease(t: Task, leaseId: unknown, now: Date) {
  if (t.lease && t.lease.handoffId === (t.lease.purpose === 'preparation' ? t.need?.id : t.dot?.handoffId) && Date.parse(t.lease.expiresAt) > +now && leaseId !== t.lease.id) throw new Error('LEASE_REQUIRED');
}

export function validSignal(v: unknown): v is Signal {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const x = v as Signal;
  return text(x.key,200) && text(x.title,200) && text(x.summary) && text(x.receipt,8000) && iso(x.observedAt)
    && ['change','blocker','opportunity'].includes(x.kind) && ['now','digest','quiet'].includes(x.attention) && (x.next === undefined || text(x.next)) && (x.taskId === undefined || text(x.taskId));
}

export function recordSignal(s: WorkbenchState, input: unknown, now: Date, id: string) {
  if (!validSignal(input) || Date.parse(input.observedAt) > +now + 60000) throw new Error('SIGNAL_EVIDENCE_REQUIRED');
  if (input.taskId && !s.tasks.some(t => t.id === input.taskId && t.state === 'open')) throw new Error('TASK_CLOSED_OR_PAUSED');
  const rows = s.signals ??= [];
  const existing = rows.find(v => v.key === input.key);
  if (existing) {
    if (existing.taskId !== input.taskId) throw new Error('SIGNAL_SOURCE_CHANGED');
    return {signal:existing,deduplicated:true};
  }
  const signal: Signal = {id,key:input.key,taskId:input.taskId,kind:input.kind,title:input.title,summary:input.summary,next:input.next,observedAt:input.observedAt,receipt:input.receipt,attention:input.attention,state:'new',recordedAt:now.toISOString()};
  rows.push(signal); return {signal,deduplicated:false};
}

export function reserveNotification(s: WorkbenchState, id: string, now: Date, deliveryId: string) {
  const signal = s.signals?.find(v => v.id === id);
  if (!signal) throw new Error('NOT_FOUND');
  if (signal.state !== 'new' || signal.attention === 'quiet') throw new Error('NOTIFICATION_NOT_NEEDED');
  if (signal.taskId && !s.tasks.some(t => t.id === signal.taskId && t.state === 'open')) throw new Error('TASK_CLOSED_OR_PAUSED');
  if (signal.delivery) return {send:false,reason:signal.delivery.status === 'delivered' ? 'already_delivered' : 'delivery_uncertain_reconcile_first',delivery:signal.delivery};
  signal.delivery = {id:deliveryId,status:'reserved',at:now.toISOString()};
  return {send:true,delivery:signal.delivery};
}

export function recordPreference(s: WorkbenchState, input: WorkPreference, now: Date) {
  if (!input || !text(input.id,150) || !text(input.text) || !text(input.sourceId) || !text(input.quote) || !['user_instruction','dot_suggestion'].includes(input.basis)) throw new Error('PREFERENCE_SOURCE_REQUIRED');
  const source = [...s.commands, ...(s.contexts ?? []), ...(s.decisions ?? []), ...(s.requirements ?? [])].find(v => v.id === input.sourceId);
  const sourceText = source && [source.text,source.label].filter(v => typeof v === 'string').join('\n');
  if (!sourceText?.includes(input.quote)) throw new Error('PREFERENCE_QUOTE_REQUIRED');
  if (input.basis === 'user_instruction' && !('by' in source! && source!.by === 'user') && !s.commands.some(c => c.id === input.sourceId)) throw new Error('USER_PREFERENCE_SOURCE_REQUIRED');
  const rows = s.preferences ??= [];
  const old = rows.findIndex(v => v.id === input.id);
  const prior = rows[old];
  if(prior?.basis === 'user_instruction' && input.basis === 'dot_suggestion') throw new Error('USER_PREFERENCE_CANNOT_BE_REPLACED_BY_SUGGESTION');
  if (prior?.status === 'inactive' && prior.sourceId === input.sourceId) throw new Error('PREFERENCE_DISABLED_BY_USER');
  const preference = {...input,status:'active' as const,history:prior ? [...(prior.history ?? []),{text:prior.text,sourceId:prior.sourceId,quote:prior.quote,basis:prior.basis,at:prior.updatedAt}] : [],updatedAt:now.toISOString()};
  if (old < 0) rows.push(preference); else rows[old] = preference;
  return preference;
}
