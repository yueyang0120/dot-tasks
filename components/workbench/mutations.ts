/**
 * User intents as pure functions: (latest server state, now) => next state.
 * They run against the authoritative state at save time; on a 409 they are re-run only
 * after the user explicitly chooses to reapply. Each one checks its preconditions and
 * throws PreconditionError instead of guessing.
 *
 * The browser never writes receipts, runs, `acknowledged/running/...` statuses or evidence.
 */
import type {
  Actor, Approval, Command, DecisionRecord, Deadline, HistoryRecord, Monitor, MonitorFreq, Priority,
  Review, Step, Task, WorkbenchState,
} from './types';
import { currentMonitor, currentReview, effectiveNeed, hasReceipt, reviewPhase, taskStatus } from './model';
import { draftContentHash, newId } from './util';
import { validMonitorOrigins } from '../../lib/monitor-provenance';

export class PreconditionError extends Error {}

export type Mutation = (s: WorkbenchState, now: Date) => WorkbenchState;

const iso = (d: Date) => d.toISOString();

function getTask(s: WorkbenchState, id: string): Task {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new PreconditionError('这件事在服务器上已不存在。');
  return t;
}

function putTask(s: WorkbenchState, t: Task): WorkbenchState {
  return { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? t : x)) };
}

function history(s: WorkbenchState, now: Date, summary: string, ref: { taskId?: string; commandId?: string }, by: Actor = 'user'): WorkbenchState {
  const h: HistoryRecord = { id: newId(), ...ref, at: iso(now), by, summary };
  return { ...s, history: [...(s.history ?? []), h] };
}

function decision(s: WorkbenchState, now: Date, taskId: string, text: string, needId?: string): WorkbenchState {
  const d: DecisionRecord = { id: newId(), taskId, at: iso(now), by: 'user', text, ...(needId ? { needId } : {}) };
  return { ...s, decisions: [...(s.decisions ?? []), d] };
}

/** Mark the first not-done step done (the user's step that was just resolved). */
function advanceStep(steps: Step[], role?: Step['role']): Step[] {
  let idx = role ? steps.findIndex((x) => !x.done && x.role === role) : -1;
  if (idx < 0) idx = steps.findIndex((x) => !x.done);
  return idx < 0 ? steps : steps.map((x, i) => (i === idx ? { ...x, done: true } : x));
}

function handToDot(t: Task, now: Date, summary: string): Task {
  return {
    ...t, owner: 'dot', need: null, updatedAt: iso(now),
    dot: { handoffId: newId(), handoffAt: iso(now), status: 'queued', summary, waitingOn: null, promise: null, flag: null },
  };
}

function requireOpenNeed(t: Task, needId: string) {
  if (t.state !== 'open') throw new PreconditionError(t.state === 'paused' ? '这件事已暂停，先恢复再处理。' : '这件事已关闭。');
  const n = effectiveNeed(t);
  if (!n || n.id !== needId) throw new PreconditionError('这一步已经变化（可能已在别处处理），请查看最新状态。');
  return n;
}

/* ───────────── commands ───────────── */

export const addCommand = (text: string, id: string = newId()): Mutation => (s, now) => {
  const clean = text.trim();
  if (!clean) throw new PreconditionError('先说一句要办的事。');
  if (s.commands.some((c) => c.id === id)) return s; // already saved (idempotent reapply)
  const c: Command = { id, text: clean, status: 'queued', createdAt: iso(now) };
  return history({ ...s, commands: [...s.commands, c] }, now, '你交给 DOT 一条指令', { commandId: id });
};

export const acknowledgeSignal = (id: string): Mutation => (s) => {
  const v=s.signals?.find(x=>x.id===id);
  if(!v)throw new PreconditionError('这条更新已经变化，请刷新后再看。');
  return {...s,signals:s.signals!.map(x=>x.id===id?{...x,state:'seen' as const}:x)};
};

export const acceptOpportunity = (id: string, commandId: string = newId()): Mutation => (s,now) => {
  const v=s.signals?.find(x=>x.id===id);
  if(!v||v.kind!=='opportunity'||v.state!=='new')throw new PreconditionError('这个建议已经处理过，请查看最新状态。');
  const next=addCommand(`请继续了解这个建议：${v.title}\n${v.summary}${v.next?'\n'+v.next:''}`,commandId)(s,now);
  return acknowledgeSignal(id)(next,now);
};

/* ───────────── reviews ───────────── */

export const approveReview = (taskId: string, reviewId: string, seen: { version: number; contentHash: string }): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  const n = effectiveNeed(t);
  if (t.state !== 'open' || !n || n.kind !== 'review') throw new PreconditionError('这份草稿当前不在待审核状态。');
  const r = s.reviews.find((x) => x.id === reviewId && x.taskId === taskId);
  if (!r) throw new PreconditionError('草稿在服务器上已不存在。');
  if (currentReview(s, t)?.id !== r.id) throw new PreconditionError('已经有新版草稿，请看过新版后再批准。');
  if (r.version !== seen.version || r.contentHash !== seen.contentHash || draftContentHash(r) !== seen.contentHash) {
    throw new PreconditionError('草稿内容在你审核后有变化，请重新审核最新内容。');
  }
  if (reviewPhase(r) === 'executed') throw new PreconditionError('这份草稿已执行，不能再次批准。');
  const approval: Approval = { id: newId(), version: r.version, contentHash: r.contentHash, at: iso(now), by: 'user' };
  const nr: Review = { ...r, status: 'approved', approval, updatedAt: iso(now) };
  const nt = handToDot({ ...t, steps: advanceStep(t.steps, 'review') }, now, '草稿已批准，等待 DOT 接收并执行。尚未发送');
  let ns: WorkbenchState = { ...putTask(s, nt), reviews: s.reviews.map((x) => (x.id === r.id ? nr : x)) };
  ns = decision(ns, now, taskId, `批准草稿「${r.subject}」第 ${r.version} 版`, n.id);
  return history(ns, now, `你批准了草稿第 ${r.version} 版 · 等待执行，尚未发送`, { taskId });
};

export const editReview = (
  taskId: string, reviewId: string, seenVersion: number,
  patch: Partial<Pick<Review, 'to' | 'cc' | 'subject' | 'body'>>,
): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  const r = s.reviews.find((x) => x.id === reviewId && x.taskId === taskId);
  if (!r) throw new PreconditionError('草稿在服务器上已不存在。');
  if (currentReview(s, t)?.id !== r.id) throw new PreconditionError('已经有新版草稿。你的修改仍保留，请先对照新版。');
  if (t.state === 'completed') throw new PreconditionError('这件事已关闭，不能修改草稿。');
  if (reviewPhase(r) === 'executed') throw new PreconditionError('DOT 已回执执行这份草稿，不能再修改。');
  if (r.version !== seenVersion) throw new PreconditionError('草稿在你编辑期间被更新过。你的修改仍保留在编辑框里，请对照最新版本后再保存。');
  const next = { ...r, ...patch };
  const hash = draftContentHash(next);
  if (hash === r.contentHash) return s; // nothing changed
  const wasApproved = !!r.approval;
  const prior = r.approval ? [...(r.priorApprovals ?? []), { ...r.approval, invalidatedAt: iso(now), invalidReason: '内容已修改' }] : r.priorApprovals;
  const nr: Review = {
    ...next, version: r.version + 1, contentHash: hash, approval: null, updatedAt: iso(now),
    status: wasApproved || r.status === 'invalidated' ? 'invalidated' : 'pending',
    ...(prior ? { priorApprovals: prior } : {}),
  };
  // Reset the review gate and everything after it.
  const k = t.steps.findIndex((x) => x.role === 'review');
  const steps = k < 0 ? t.steps : t.steps.map((x, i) => (i >= k ? { ...x, done: false } : x));
  const needId = newId();
  const nt: Task = {
    ...t, steps, updatedAt: iso(now), owner: 'user', dot: null,
    need: {
      id: needId, kind: 'review', reviewId: r.id, requestedAt: iso(now),
      next: wasApproved ? '草稿已修改，之前的批准已失效，需要重新批准' : t.need?.next || '草稿已修改，等你批准',
      why: wasApproved ? '你修改了内容。之前的批准只对应修改前的版本，已经失效；批准新版本后 DOT 才会执行。' : t.need?.why || '批准前不会发出任何内容。',
    },
  };
  let ns: WorkbenchState = { ...putTask(s, nt), reviews: s.reviews.map((x) => (x.id === r.id ? nr : x)) };
  ns = history(ns, now, wasApproved ? `你修改了草稿（第 ${nr.version} 版），之前的批准已失效` : `你修改了草稿（第 ${nr.version} 版）`, { taskId });
  return ns;
};

/* ───────────── other user steps ───────────── */

/** Ask DOT to revise an exact draft; keep the user's words and revoke old approval. */
export const requestReviewChanges = (
  taskId: string, reviewId: string, seen: { version: number; contentHash: string },
  text: string, id: string = newId(),
): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  // A lost save response can be retried without creating a second handoff.
  if (t.reviewFeedback?.id === id) return s;
  const clean = text.trim();
  if (!clean || clean.length > 6000) throw new PreconditionError('请写下想怎么改，最多 6000 字。');
  const r = s.reviews.find(x => x.id === reviewId && x.taskId === taskId);
  if (!r || currentReview(s, t)?.id !== r.id || r.version !== seen.version || r.contentHash !== seen.contentHash || draftContentHash(r) !== seen.contentHash) {
    throw new PreconditionError('草稿已经更新。你的意见还在，请看过新版后再提交。');
  }
  if (t.state !== 'open' || reviewPhase(r) === 'executed') throw new PreconditionError('这份草稿已经处理或暂停，不能再交回修改。');
  const pending = t.owner === 'user' && t.need?.kind === 'review' && (!t.need.reviewId || t.need.reviewId === r.id);
  const notStarted = t.owner === 'dot' && reviewPhase(r) === 'approved' && ((t.dot?.status === 'queued' && !t.dot.receipt) || t.dot?.status === 'blocked');
  if (!pending && !notStarted) throw new PreconditionError('DOT 已接手或这一步已变化，请先查看最新进展。');
  if (t.lease && Date.parse(t.lease.expiresAt) > +now) throw new PreconditionError('DOT 正在处理这一步，请先查看最新进展。');
  const nr: Review = { ...r, approval: null, status: 'invalidated', updatedAt: iso(now),
    ...(r.approval ? { priorApprovals: [...(r.priorApprovals ?? []), { ...r.approval, invalidatedAt: iso(now), invalidReason: '你请 DOT 修改草稿，原批准已撤回' }] } : {}),
  };
  const k = t.steps.findIndex(x => x.role === 'review');
  const nt = handToDot({ ...t, activeReviewId: r.id, lease: null,
    steps: k < 0 ? t.steps : t.steps.map((x, i) => i >= k ? { ...x, done: false } : x),
    plan: { ...t.plan, dependsOn: t.plan?.dependsOn ?? [], prepareWhileWaiting: false,
      nextAction: '按你的意见改好草稿，再交给你看。', why: '你想先改内容，还没有批准发送。', nextCheckAt: undefined },
  }, now, '修改意见已保存，等 DOT 改好后再给你看。');
  nt.reviewFeedback = { id, reviewId: r.id, version: r.version, contentHash: r.contentHash, text: clean, createdAt: iso(now), handoffId: nt.dot!.handoffId };
  let ns = { ...putTask(s, nt), reviews: s.reviews.map(x => x.id === r.id ? nr : x) };
  ns = decision(ns, now, taskId, `请 DOT 修改草稿，再交给我看：\n${clean}`, t.need?.id);
  return history(ns, now, '你给了修改意见，交给 DOT 改稿后再给你看', { taskId });
};

export type Resolution =
  | { kind: 'choose'; optionId: string }
  | { kind: 'material' | 'login' | 'inperson'; note?: string }
  | { kind: 'clarify'; answer: string };

export const resolveNeed = (taskId: string, needId: string, res: Resolution): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  const n = requireOpenNeed(t, needId);
  if (n.kind !== res.kind) throw new PreconditionError('这一步的类型已变化，请查看最新状态。');
  let text: string, summary: string, log: string;
  if (res.kind === 'choose') {
    const o = n.options?.find((x) => x.id === res.optionId);
    if (!o) throw new PreconditionError('这个方案已不在可选列表里。');
    const short = o.name.split(' · ')[0];
    text = `选择了${o.name}${o.price ? `（${o.price}）` : ''}`;
    summary = `你选了${short}${o.price ? `（${o.price}）` : ''}，等待 DOT 接收后办理`;
    log = `你选择了${o.name}`;
  } else if (res.kind === 'clarify') {
    const a = res.answer.trim();
    if (!a) throw new PreconditionError('请先写下你的回答。');
    text = `回答：${a}`;
    summary = '你已补充说明，等待 DOT 接收后继续';
    log = '你补充了说明';
  } else {
    const note = res.note?.trim();
    const what = { material: '已补充资料', login: '已在自己的浏览器恢复登录', inperson: '已本人办理' }[res.kind];
    text = what + (note ? `：${note}` : '');
    summary = `你${what}，等待 DOT 接收后继续`;
    log = `你确认${what}`;
  }
  const nt = handToDot({ ...t, steps: advanceStep(t.steps, 'user') }, now, summary);
  return history(decision(putTask(s, nt), now, taskId, text, n.id), now, log + ' · 交回 DOT', { taskId });
};

export const confirmComplete = (taskId: string, note?: string): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if (t.state === 'completed' && t.completion?.by === 'user') return s;
  const nt: Task = {
    ...t, state: 'completed', updatedAt: iso(now), pause: null,
    completion: { at: iso(now), by: 'user', verification: 'user_confirmed', evidenceIds: (t.evidence ?? []).map((e) => e.id), ...(note ? { note } : {}) },
  };
  // A closed item must not keep being checked: ask DOT to stop any monitor.
  const monitors = s.monitors.map((m) => (m.taskId === taskId && (m.status === 'requested' || m.status === 'active')
    ? { ...m, status: 'stop_requested' as const, updatedAt: iso(now) } : m));
  return history({ ...putTask(s, nt), monitors }, now, '你确认已完成，事项关闭，停止提醒与检查', { taskId });
};

export const pauseTask = (taskId: string, note?: string): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if (t.state !== 'open') throw new PreconditionError(t.state === 'paused' ? '已经是暂停状态。' : '这件事已关闭。');
  const nt: Task = { ...t, state: 'paused', pause: { at: iso(now), ...(note ? { note } : {}) }, updatedAt: iso(now) };
  return history(putTask(s, nt), now, '你暂停了此事项', { taskId });
};

export const resumeTask = (taskId: string): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if (t.state !== 'paused') throw new PreconditionError('这件事不是暂停状态。');
  let nt: Task = { ...t, state: 'open', pause: null, updatedAt: iso(now) };
  if (nt.owner === 'dot') nt = handToDot(nt, now, '已恢复，等待 DOT 接收后从当前步骤继续');
  return history(putTask(s, nt), now, '你恢复了此事项', { taskId });
};

export const setPriority = (taskId: string, p: Priority | null): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if (t.priority === p) return s;
  return history(putTask(s, { ...t, priority: p, updatedAt: iso(now) }), now, `你把优先级改为 ${p ?? '未定'}`, { taskId });
};

export const setDeadline = (taskId: string, d: Deadline | null, label: string): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if ((t.deadline?.at ?? null) === (d?.at ?? null) && !!t.deadline?.allDay === !!d?.allDay) return s;
  return history(putTask(s, { ...t, deadline: d, updatedAt: iso(now) }), now, d ? `你把期限改为 ${label}` : '你清除了期限', { taskId });
};

/* ───────────── monitors ───────────── */

export interface MonitorConfig {
  sources: string[]; what: string; freq: MonitorFreq | null; time: string; tz: string; until: string; notify: string[];
  fieldOrigins?: Monitor['fieldOrigins'];
}

/** Every change creates a new request; DOT must schedule it and write scheduleReceipt. */
export const requestMonitor = (taskId: string, cfg: MonitorConfig): Mutation => (s, now) => {
  const t = getTask(s, taskId);
  if (t.state !== 'open') throw new PreconditionError('只有进行中的事项可以安排检查。');
  if (!cfg.what.trim()) throw new PreconditionError('请写明要检查什么变化。');
  const prev = currentMonitor(s, taskId);
  const m: Monitor = {
    id: newId(), taskId, sources: [...cfg.sources], what: cfg.what.trim(), freq: cfg.freq, time: cfg.time, tz: cfg.tz,
    until: cfg.until, notify: [...cfg.notify], status: 'requested', requestedAt: iso(now), updatedAt: iso(now),
    fieldOrigins: structuredClone(cfg.fieldOrigins ?? {}),
    ...(prev ? { supersedes: prev.id } : {}),
  };
  if (!validMonitorOrigins(m)) throw new PreconditionError('有些设置没有明确来源，请重新选择或清空后提交。');
  const monitors = s.monitors.map((x) => (prev && x.id === prev.id ? { ...x, status: 'stop_requested' as const, updatedAt: iso(now) } : x));
  return history({ ...s, monitors: [...monitors, m] }, now, '你提交了跟进要求，等待 DOT 确认安排；未填写的设置不代表你的要求', { taskId });
};

export const stopMonitor = (taskId: string, monitorId: string): Mutation => (s, now) => {
  const m = s.monitors.find((x) => x.id === monitorId && x.taskId === taskId);
  if (!m || m.status === 'stopped' || m.status === 'stop_requested') return s;
  const monitors = s.monitors.map((x) => (x.id === monitorId ? { ...x, status: 'stop_requested' as const, updatedAt: iso(now) } : x));
  return history({ ...s, monitors }, now, '你请求停止持续关注，等待 DOT 回执', { taskId });
};

/* re-exports used by UI preconditions */
export { currentReview, hasReceipt, taskStatus };

/** Explicit preference choices; preserve the old quote and write the new instruction. */
export const savePreference = (text: string, id: string = newId(), seenAt?: string, commandId: string = newId()): Mutation => (s,now) => {
  const clean=text.trim();if(!clean || clean.length>2000)throw new PreconditionError('用一两句话说清你的偏好。');
  const prior=s.preferences?.find(p=>p.id===id);
  if(seenAt && prior?.updatedAt!==seenAt)throw new PreconditionError('这条偏好已经变化，请看最新内容。');
  const next=addCommand(`请记住我的协作偏好：${clean}\n只保存为偏好，不创建待办。`,commandId)(s,now);
  const value={id,text:clean,basis:'user_instruction' as const,sourceId:commandId,quote:clean,status:'active' as const,updatedAt:iso(now),history:prior?[...(prior.history??[]),{text:prior.text,basis:prior.basis,sourceId:prior.sourceId,quote:prior.quote,at:prior.updatedAt}]:[]};
  return {...next,preferences:[...(next.preferences??[]).filter(p=>p.id!==id),value]};
};
export const disablePreference = (id: string, seenAt: string): Mutation => (s,now) => {
  const p=s.preferences?.find(p=>p.id===id);if(!p || p.updatedAt!==seenAt)throw new PreconditionError('这条偏好已经变化，请看最新内容。');
  return history({...s,preferences:s.preferences!.map(v=>v.id===id?{...v,status:'inactive' as const,updatedAt:iso(now)}:v)},now,`你停用了偏好：${p.text}`,{});
};
