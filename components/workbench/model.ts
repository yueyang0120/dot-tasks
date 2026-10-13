/**
 * Pure derivations from WorkbenchState to what the UI shows.
 * Nothing here writes state. "Received / running / sent / scheduled" is shown only when a
 * non-empty receipt exists; otherwise the UI falls back to the honest waiting state.
 */
import type {
  Command, CommandStatus, ContextRecord, DecisionRecord, HistoryRecord, Monitor, MonitorField, Need, NeedKind,
  RequirementRecord, Review, Run, Task, WorkbenchState,
} from './types';
import { draftContentHash, formatDeadline, isDeadlineHot, isSameDay } from './util';

export const hasReceipt = (r: unknown): r is string => typeof r === 'string' && r.trim().length > 0;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Fill required arrays; keep every unknown/additive field. */
export function normalizeState(raw: unknown): WorkbenchState {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    ...s,
    tasks: arr(s.tasks),
    commands: arr(s.commands),
    monitors: arr(s.monitors),
    reviews: arr(s.reviews),
    runs: arr(s.runs),
    workspaces: arr<string>(s.workspaces),
  } as WorkbenchState;
}

export function emptyState(): WorkbenchState {
  return { tasks: [], commands: [], monitors: [], reviews: [], runs: [], workspaces: [] };
}

/* ───────────── commands ───────────── */

/** Status as displayed: anything beyond 'queued' without a receipt is shown as queued. */
export function effectiveCommandStatus(c: Command): CommandStatus {
  return c.status !== 'queued' && hasReceipt(c.receipt) ? c.status : 'queued';
}

/** Commands still shown as their own row (no task yet represents them). */
export function openCommands(s: WorkbenchState): Command[] {
  const taskIds = new Set(s.tasks.map((t) => t.id));
  const byCommand = new Set(s.tasks.map((t) => t.commandId).filter(Boolean));
  return s.commands
    .filter((c) => {
      const st = effectiveCommandStatus(c);
      if (st === 'completed') return false;
      if (byCommand.has(c.id)) return false;
      if (c.taskIds && c.taskIds.some((id) => taskIds.has(id))) return false;
      return true;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/* ───────────── tasks ───────────── */

export type TaskStatus =
  | 'need' | 'handoff' | 'accepted' | 'running' | 'waiting' | 'preparation' | 'blocked' | 'done' | 'paused';

export function currentReview(s: WorkbenchState, t: Task): Review | undefined {
  const rs = s.reviews.filter((r) => r.taskId === t.id);
  if (t.need?.reviewId) {
    const r = rs.find((x) => x.id === t.need!.reviewId);
    if (r) return r;
  }
  if(t.activeReviewId){const r=rs.find(x=>x.id===t.activeReviewId);if(r)return r;}
  return rs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}

export type ReviewPhase = 'pending' | 'approved' | 'invalidated' | 'executed';

/** An approval counts only if it matches the exact current content and version. */
export function reviewPhase(r: Review): ReviewPhase {
  if (r.status === 'executed' && hasReceipt(r.executionReceipt)) return 'executed';
  const a = r.approval;
  if (a && !a.invalidatedAt && a.version === r.version && a.contentHash === draftContentHash(r)) return 'approved';
  if (a || r.status === 'invalidated' || (r.priorApprovals && r.priorApprovals.length)) return 'invalidated';
  return 'pending';
}

/** The need the UI shows: the stored one, or a synthesized one when DOT reports completion. */
export function effectiveNeed(t: Task): Need | null {
  if (t.state === 'paused') return null;
  if (t.state === 'completed' && t.completion?.by !== 'user') {
    return { id: `verify:${t.id}`, kind: 'verify', next: 'DOT 报告已完成，等你确认', why: 'DOT 说这件事已经处理好了。你看过相关消息后，可以确认并收起。', requestedAt: t.updatedAt };
  }
  if (t.state !== 'open') return null;
  if (t.owner === 'user') {
    return t.need ?? { id: `need:${t.id}`, kind: 'clarify', next: '需要你查看', why: '这条记录需要你处理，但没有写明具体请求。', requestedAt: t.updatedAt };
  }
  const d = t.dot;
  if (d && d.status === 'completed' && hasReceipt(d.receipt) && (t.evidence?.length ?? 0) > 0) {
    return { id: `verify:${t.id}`, kind: 'verify', next: 'DOT 报告已完成，等你确认', why: 'DOT 说这件事已经处理好了。你看过相关消息后，可以确认并收起。', requestedAt: d.receiptAt || t.updatedAt };
  }
  return null;
}

export function taskStatus(t: Task): TaskStatus {
  if (t.state === 'completed' && t.completion?.by === 'user') return 'done';
  if (t.state === 'paused') return 'paused';
  if (effectiveNeed(t)) return 'need';
  const d = t.dot;
  if (!d || !hasReceipt(d.receipt) || d.status === 'queued') return 'handoff';
  if (d.status === 'acknowledged') return 'accepted';
  if (d.status === 'running') return 'running';
  if (d.status === 'waiting' && t.preparation && t.preparation.handoffId === d.handoffId) return 'preparation';
  if (d.status === 'waiting') return 'waiting';
  // blocked, or "completed" without evidence: DOT is stuck, user should notice.
  return 'blocked';
}

export const isClosed = (st: TaskStatus) => st === 'done' || st === 'paused';
export const isDotSide = (st: TaskStatus) => st === 'handoff' || st === 'accepted' || st === 'running' || st === 'waiting' || st === 'preparation' || st === 'blocked';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  need: '需要你', handoff: '等待 DOT 接收', accepted: 'DOT 已接收', running: 'DOT 执行中',
  preparation: '草稿已准备', waiting: '等待外部', blocked: 'DOT 受阻', done: '已完成', paused: '已暂停',
};
export const ACTOR_LABEL: Record<TaskStatus, string> = {
  need: '你', handoff: 'DOT', accepted: 'DOT', running: 'DOT', preparation: 'DOT', waiting: '外部', blocked: 'DOT', done: '—', paused: '—',
};
/** [chip label, button label, glyph, row CTA] */
export const NEED_META: Record<NeedKind, { label: string; glyph: string; cta: string }> = {
  review: { label: '审核草稿', glyph: '审', cta: '审核' },
  choose: { label: '选一个回答', glyph: '选', cta: '回答' },
  material: { label: '补资料', glyph: '补', cta: '补资料' },
  login: { label: '恢复登录', glyph: '登', cta: '去登录' },
  inperson: { label: '亲自办理', glyph: '办', cta: '去办理' },
  clarify: { label: '补充说明', glyph: '问', cta: '回答' },
  verify: { label: '确认完成', glyph: '验', cta: '查看' },
};
export const PRIORITY_TEXT = { P0: '明显损失或关键计划受阻', P1: '重要，需要推进', P2: '可以延后' } as const;
export const STATUS_FILTERS = ['需要你', '等待 DOT 接收', 'DOT 已接收', 'DOT 执行中', '等待外部', '草稿已准备', 'DOT 受阻', '已完成', '已暂停'] as const;
export const ACTOR_FILTERS = ['你', 'DOT', '外部'] as const;

/* ───────────── monitors ───────────── */

export type MonitorPhase = 'active' | 'pending' | 'stopping' | 'failed';

export function currentMonitor(s: WorkbenchState, taskId: string): Monitor | undefined {
  return s.monitors
    .filter((m) => m.taskId === taskId && m.status !== 'stopped')
    .filter((m) => !(m.status === 'stop_requested' && s.monitors.some((n) => n.supersedes === m.id)))
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))[0];
}

export function monitorPhase(m: Monitor): MonitorPhase {
  if (m.status === 'failed') return 'failed';
  if (m.status === 'stop_requested') return 'stopping';
  if (m.status === 'active' && hasReceipt(m.scheduleReceipt)) return 'active';
  return 'pending';
}

export const freqText = (m: Pick<Monitor, 'freq' | 'time'>) => m.freq ? m.freq + (m.freq === '每小时' || !m.time ? '' : ' ' + m.time) : '未指定';
export function monitorSetting(m: Monitor, field: MonitorField, value: string) {
  if (!value || value === '未指定') return '未指定';
  const origin = m.fieldOrigins?.[field];
  if (origin?.kind === 'user_selected') return value;
  if (origin?.kind === 'user_instruction') return `${value}（按你写的话）`;
  if (origin?.kind === 'dot_suggestion') return `${value}（DOT 建议，未确认）`;
  return `${value}（旧记录，来源未确认）`;
}

/* ───────────── row view models ───────────── */

export type Tone = 'normal' | 'muted' | 'warn' | 'danger' | 'good';

export interface TaskRow {
  kind: 'task';
  id: string;
  task: Task;
  status: TaskStatus;
  statusLabel: string;
  actor: string;
  title: string;
  domain: string;
  priority: Task['priority'];
  need: Need | null;
  glyph: string;
  /** Row second line. */
  line: string;
  dueLabel: string;
  dueHot: boolean;
  dueSort: string;
  check: { label: string; tone: Tone };
  flag: { label: string; tone: Tone } | null;
  quiet: boolean;
  dotOrder: number;
  searchText: string;
  dueToday: boolean;
}

export interface CommandRow {
  kind: 'command';
  id: string;
  command: Command;
  status: CommandStatus;
  statusLabel: string;
  title: string;
  line: string;
  check: { label: string; tone: Tone };
  flag: { label: string; tone: Tone } | null;
  dotOrder: number;
  searchText: string;
}

export function commandRow(c: Command): CommandRow {
  const st = effectiveCommandStatus(c);
  const title = c.text.length > 32 ? c.text.slice(0, 32) + '…' : c.text;
  const unverified = c.status !== 'queued' && !hasReceipt(c.receipt);
  const map: Record<CommandStatus, [string, string, Tone]> = {
    queued: ['等待 DOT 接收', unverified ? '状态缺少 DOT 回执，按未接收显示' : '已保存，等待 DOT 接收；接收后先理解你的意思', 'warn'],
    acknowledged: ['DOT 已接收', 'DOT 已收到，等待处理', 'normal'],
    running: ['DOT 执行中', 'DOT 已回执开始处理', 'normal'],
    blocked: ['DOT 受阻', c.blockedReason || 'DOT 回执无法继续，请查看详情', 'danger'],
    completed: ['已完成', '', 'muted'],
  };
  const [statusLabel, line, tone] = map[st];
  return {
    kind: 'command', id: c.id, command: c, status: st, statusLabel, title, line,
    check: { label: st === 'queued' ? 'DOT 尚未回执接收' : st === 'acknowledged' ? '已接收 · 等待整理' : statusLabel, tone },
    flag: st === 'blocked' ? { label: '需注意', tone: 'danger' } : st === 'queued' ? { label: '待接收', tone: 'muted' } : null,
    dotOrder: st === 'blocked' ? 1 : 0,
    searchText: c.text,
  };
}

export function taskRow(s: WorkbenchState, t: Task, now: Date, contexts: ContextRecord[]): TaskRow {
  const status = taskStatus(t);
  const need = effectiveNeed(t);
  const d = t.dot;
  const m = currentMonitor(s, t.id);
  const mp = m ? monitorPhase(m) : null;
  const review = currentReview(s, t);
  const approvedWaiting = status === 'handoff' && review && reviewPhase(review) === 'approved';

  let check: TaskRow['check'];
  if (status === 'handoff') check = { label: 'DOT 尚未回执接收', tone: 'warn' };
  else if (status === 'blocked') check = { label: d?.status === 'completed' ? '还缺结果证明' : d?.blocker?.step || '具体原因待核对', tone: 'danger' };
  else if (m && mp === 'active') check = { label: freqText(m) + ' 检查', tone: 'normal' };
  else if (m && mp === 'pending') check = { label: '检查待 DOT 回执', tone: 'warn' };
  else if (m && mp === 'failed') check = { label: '检查安排失败', tone: 'danger' };
  else if (status === 'waiting') check = { label: '', tone: 'muted' };
  else if (d?.promise && status === 'running') check = { label: d.promise, tone: 'warn' };
  else if (status === 'running') check = { label: 'DOT 正在处理', tone: 'normal' };
  else if (status === 'accepted') check = { label: '已接收 · 尚未开始', tone: 'normal' };
  else check = { label: '', tone: 'muted' };

  let flag: TaskRow['flag'] = null;
  if (status === 'handoff') flag = { label: '待接收', tone: 'muted' };
  else if (status === 'blocked' || (isDotSide(status) && d?.flag === 'alert')) flag = { label: '需注意', tone: 'danger' };
  else if (isDotSide(status) && d?.flag === 'new') flag = { label: '新进展', tone: 'good' };
  else if (status === 'running' && d?.promise) flag = { label: '临近承诺', tone: 'warn' };

  const dotOrder = status === 'handoff' ? 0 : flag?.tone === 'danger' ? 1 : flag?.tone === 'good' ? 2 : flag?.tone === 'warn' ? 3 : 4;
  const quiet = status === 'waiting' && !d?.flag && mp === 'active';

  const glyph = need ? NEED_META[need.kind].glyph
    : ({ handoff: '收', accepted: '接', running: '执', preparation: '查', waiting: '等', blocked: '!', done: '✓', paused: '停', need: '' } as const)[status];

  const statusLabel = status === 'preparation' ? (t.preparation?.status === 'needs_info' ? '还缺一点资料' : '草稿先给你看') : approvedWaiting ? '已批准 · 等待 DOT 接收' : STATUS_LABEL[status];
  const line = need ? need.next : status === 'done' ? `你已确认完成` : status === 'paused' ? '已暂停 · DOT 不推进、不检查' : status === 'blocked' && d?.blocker ? d.blocker.reason : d?.summary || '';
  const dueLabel = t.deadline ? formatDeadline(t.deadline.at, t.deadline.allDay, now) : '';
  const dueHot = !!t.deadline && !isClosed(status) && isDeadlineHot(t.deadline.at, t.deadline.allDay, now);
  return {
    kind: 'task', id: t.id, task: t, status, statusLabel, actor: ACTOR_LABEL[status], title: t.title || '（未命名事项）',
    domain: t.domain || '待识别', priority: t.priority, need, glyph, line, dueLabel, dueHot,
    dueSort: t.deadline?.at || '9999', check, flag, quiet, dotOrder,
    dueToday: !!t.deadline && isSameDay(t.deadline.at, now),
    searchText: [t.title, t.domain, t.goal, t.briefing?.background, t.briefing?.latest, d?.summary, d?.blocker?.step, d?.blocker?.reason, d?.blocker?.next, need?.why, need?.next, ...contexts.filter((c) => c.taskId === t.id).map((c) => c.label)].filter(Boolean).join(' '),
  };
}

/* ───────────── home + all lists ───────────── */

export interface HomeLists {
  need: TaskRow[];
  dotActive: (TaskRow | CommandRow)[];
  dotQuiet: TaskRow[];
  dotCount: number;
  closedCount: number;
}

export function homeLists(s: WorkbenchState, now: Date): HomeLists {
  const ctx = s.contexts ?? [];
  const rows = s.tasks.map((t) => taskRow(s, t, now, ctx));
  // 需要你: strictly by deadline (earliest first, no deadline last). Priority is only a marker.
  const need = rows.filter((r) => r.status === 'need')
    .sort((a, b) => a.dueSort.localeCompare(b.dueSort) || String(a.task.createdAt).localeCompare(String(b.task.createdAt)));
  const dotRows = rows.filter((r) => isDotSide(r.status));
  const cmds = openCommands(s).map(commandRow);
  const dotActive = [...cmds, ...dotRows.filter((r) => !r.quiet)].sort((a, b) => a.dotOrder - b.dotOrder);
  return {
    need,
    dotActive,
    dotQuiet: dotRows.filter((r) => r.quiet),
    dotCount: dotRows.length + cmds.length,
    closedCount: rows.filter((r) => isClosed(r.status)).length,
  };
}

export interface Filters {
  q: string;
  domain: string;
  priority: string;
  today: boolean;
  status: string;
  actor: string;
}
export const NO_FILTERS: Filters = { q: '', domain: '全部', priority: '全部', today: false, status: '全部', actor: '全部' };

export type SortKey = 'status' | 'deadline' | 'priority' | 'updated';
export const SORT_LABEL: Record<SortKey, string> = { status: '按状态', deadline: '按期限', priority: '按优先级', updated: '最近更新' };

export function allLists(s: WorkbenchState, now: Date, f: Filters, sort: SortKey) {
  const ctx = s.contexts ?? [];
  const q = f.q.trim().toLowerCase();
  const rows = s.tasks.map((t) => taskRow(s, t, now, ctx));
  const cmds = openCommands(s).map(commandRow);
  const match = (r: TaskRow) => {
    if (q && !r.searchText.toLowerCase().includes(q)) return false;
    if (f.domain !== '全部' && r.task.domain !== f.domain) return false;
    if (f.priority !== '全部' && r.priority !== f.priority) return false;
    if (f.today && !r.dueToday) return false;
    if (f.status !== '全部' && STATUS_LABEL[r.status] !== f.status) return false;
    if (f.actor !== '全部' && r.actor !== f.actor) return false;
    return true;
  };
  const cmdMatch = (c: CommandRow) =>
    (!q || c.searchText.toLowerCase().includes(q)) && f.domain === '全部' && f.priority === '全部' && !f.today &&
    (f.status === '全部' || f.status === c.statusLabel) && (f.actor === '全部' || f.actor === 'DOT');
  const pickClosed = f.status === '已完成' || f.status === '已暂停';
  const so: Record<TaskStatus, number> = { need: 0, handoff: 1, accepted: 1, blocked: 1, running: 2, preparation: 2, waiting: 3, done: 4, paused: 5 };
  const pr = (p: Task['priority']) => (p === 'P0' ? 0 : p === 'P1' ? 1 : p === 'P2' ? 2 : 3);
  const cmp: Record<SortKey, (a: TaskRow, b: TaskRow) => number> = {
    status: (a, b) => so[a.status] - so[b.status] || pr(a.priority) - pr(b.priority) || a.dueSort.localeCompare(b.dueSort),
    deadline: (a, b) => a.dueSort.localeCompare(b.dueSort) || pr(a.priority) - pr(b.priority),
    priority: (a, b) => pr(a.priority) - pr(b.priority) || a.dueSort.localeCompare(b.dueSort),
    updated: (a, b) => String(b.task.updatedAt).localeCompare(String(a.task.updatedAt)),
  };
  const filtered = rows.filter(match);
  const active = filtered.filter((r) => pickClosed || !isClosed(r.status)).sort(cmp[sort]);
  const closed = pickClosed ? [] : filtered.filter((r) => isClosed(r.status));
  const commands = cmds.filter(cmdMatch);
  const hasFilter = !!q || f.domain !== '全部' || f.priority !== '全部' || f.today || f.status !== '全部' || f.actor !== '全部';
  return { active, closed, commands, hasFilter, total: rows.filter((r) => !isClosed(r.status)).length + cmds.length };
}

/* ───────────── detail helpers ───────────── */

export interface LogLine { at: string; text: string; by: 'dot' | 'user' }

export function taskLog(s: WorkbenchState, t: Task): LogLine[] {
  const monitorIds = new Set(s.monitors.filter((m) => m.taskId === t.id).map((m) => m.id));
  const reviewIds = new Set(s.reviews.filter((r) => r.taskId === t.id).map((r) => r.id));
  const runs = s.runs.filter((r: Run) =>
    hasReceipt(r.receipt) && (r.taskId === t.id || (r.monitorId && monitorIds.has(r.monitorId)) || (r.reviewId && reviewIds.has(r.reviewId))));
  const hist = (s.history ?? []).filter((h: HistoryRecord) => h.taskId === t.id);
  return [
    ...runs.map((r) => ({ at: r.finishedAt || r.startedAt, text: r.summary + (r.status === 'failed' ? '（失败）' : r.status === 'running' ? '（进行中）' : ''), by: 'dot' as const })),
    ...hist.map((h) => ({ at: h.at, text: h.summary, by: h.by })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function taskRecords(s: WorkbenchState, taskId: string) {
  return {
    contexts: (s.contexts ?? []).filter((c: ContextRecord) => c.taskId === taskId),
    requirements: (s.requirements ?? []).filter((r: RequirementRecord) => r.taskId === taskId),
    decisions: (s.decisions ?? []).filter((d: DecisionRecord) => d.taskId === taskId).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    revisions: (s.history ?? []).filter((h: HistoryRecord) => h.taskId === taskId).length,
  };
}

/** Latest DOT receipt time anywhere in the document (for the status pill). */
export function lastDotReceiptAt(s: WorkbenchState): string | null {
  const times: string[] = [];
  for (const c of s.commands) if (hasReceipt(c.receipt) && c.updatedAt) times.push(c.updatedAt);
  for (const t of s.tasks) if (t.dot && hasReceipt(t.dot.receipt) && t.dot.receiptAt) times.push(t.dot.receiptAt);
  for (const r of s.runs) if (hasReceipt(r.receipt)) times.push(r.finishedAt || r.startedAt);
  for (const m of s.monitors) if (hasReceipt(m.scheduleReceipt) && m.scheduledAt) times.push(m.scheduledAt);
  return times.sort().pop() ?? null;
}
