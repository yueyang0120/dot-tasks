import { describe, expect, it, vi, afterEach } from 'vitest';
import { emptyState, effectiveCommandStatus, homeLists, monitorPhase, normalizeState, reviewPhase, taskRow, taskStatus, allLists, NO_FILTERS } from '../components/workbench/model';
import {
  addCommand, approveReview, confirmComplete, editReview, pauseTask, PreconditionError, requestMonitor, resolveNeed, resumeTask, setPriority,
} from '../components/workbench/mutations';
import { demoSeed } from '../components/workbench/demo-seed';
import { httpAdapter, parseEnvelope, ApiError } from '../components/workbench/adapter';
import type { Task, WorkbenchState } from '../components/workbench/types';

const NOW = new Date('2026-10-11T10:00:00+08:00');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function seed() { return demoSeed(NOW); }
const byTitle = (s: WorkbenchState, t: string) => s.tasks.find((x) => x.title.includes(t))!;

describe('state normalization', () => {
  it('fills required arrays and preserves unknown fields', () => {
    const s = normalizeState({ tasks: [{ id: 'x', custom: 1 }], extra: { keep: true } });
    expect(s.commands).toEqual([]);
    expect(s.workspaces).toEqual([]);
    expect((s as Record<string, unknown>).extra).toEqual({ keep: true });
    expect((s.tasks[0] as Record<string, unknown>).custom).toBe(1);
  });
  it('live default is empty (no demo records)', () => {
    const s = normalizeState(null);
    expect(s.tasks).toHaveLength(0);
    expect(s.demo).toBeUndefined();
  });
});

describe('commands', () => {
  it('appends a queued command with UUID and is idempotent per id', () => {
    const m = addCommand('帮我约下周三吃饭，另外比一下车险');
    const s1 = m(emptyState(), NOW);
    expect(s1.commands).toHaveLength(1);
    const c = s1.commands[0];
    expect(c.id).toMatch(UUID);
    expect(c.status).toBe('queued');
    expect(c.createdAt).toBe(NOW.toISOString());
    expect(Object.keys(c).sort()).toEqual(['createdAt', 'id', 'status', 'text']);
    expect(m(s1, NOW)).toBe(s1);
  });
  it('a non-queued status without a receipt is shown as queued', () => {
    expect(effectiveCommandStatus({ id: '1', text: 'x', status: 'running', createdAt: '' })).toBe('queued');
    expect(effectiveCommandStatus({ id: '1', text: 'x', status: 'running', createdAt: '', receipt: '  ' })).toBe('queued');
    expect(effectiveCommandStatus({ id: '1', text: 'x', status: 'running', createdAt: '', receipt: 'mcp#1' })).toBe('running');
  });
});

describe('approval and edit invalidation', () => {
  it('approval only reaches waiting-for-DOT, never running or sent', () => {
    let s = seed();
    const t = byTitle(s, '房东');
    const r = s.reviews.find((x) => x.taskId === t.id)!;
    s = approveReview(t.id, r.id, { version: r.version, contentHash: r.contentHash })(s, NOW);
    const nt = s.tasks.find((x) => x.id === t.id)!;
    expect(nt.owner).toBe('dot');
    expect(nt.need).toBeNull();
    expect(nt.dot?.status).toBe('queued');
    expect(nt.dot?.receipt).toBeUndefined();
    expect(taskStatus(nt)).toBe('handoff');
    const row = taskRow(s, nt, NOW, []);
    expect(row.statusLabel).toBe('已批准 · 等待 DOT 接收');
    expect(row.check.label).toBe('DOT 尚未回执接收');
    expect(reviewPhase(s.reviews.find((x) => x.id === r.id)!)).toBe('approved');
    expect(nt.steps.find((x) => x.role === 'review')!.done).toBe(true);
  });

  it('editing after approval invalidates it, returns to 需要你 and resets the review step', () => {
    let s = seed();
    const t = byTitle(s, '房东');
    const r = s.reviews.find((x) => x.taskId === t.id)!;
    s = approveReview(t.id, r.id, { version: 1, contentHash: r.contentHash })(s, NOW);
    s = editReview(t.id, r.id, 1, { body: r.body + '\n（补一句）' })(s, NOW);
    const nr = s.reviews.find((x) => x.id === r.id)!;
    const nt = s.tasks.find((x) => x.id === t.id)!;
    expect(nr.version).toBe(2);
    expect(nr.approval).toBeNull();
    expect(nr.priorApprovals).toHaveLength(1);
    expect(nr.priorApprovals![0].invalidatedAt).toBeTruthy();
    expect(reviewPhase(nr)).toBe('invalidated');
    expect(taskStatus(nt)).toBe('need');
    expect(nt.need?.kind).toBe('review');
    const k = nt.steps.findIndex((x) => x.role === 'review');
    expect(nt.steps.slice(k).every((x) => !x.done)).toBe(true);
    expect(nt.steps.slice(0, k).every((x) => x.done)).toBe(true);
  });

  it('a stale approval (content changed since viewed) is refused', () => {
    let s = seed();
    const t = byTitle(s, '房东');
    const r = s.reviews.find((x) => x.taskId === t.id)!;
    s = editReview(t.id, r.id, 1, { body: '改过的内容' })(s, NOW);
    expect(() => approveReview(t.id, r.id, { version: 1, contentHash: r.contentHash })(s, NOW)).toThrow(PreconditionError);
  });

  it('an approval whose hash does not match current content does not count', () => {
    const s = seed();
    const t = byTitle(s, '房东');
    const r = s.reviews.find((x) => x.taskId === t.id)!;
    const tampered = { ...r, status: 'approved' as const, approval: { id: 'a', version: 1, contentHash: 'c53:deadbeef', at: '', by: 'user' as const } };
    expect(reviewPhase(tampered)).toBe('invalidated');
  });

  it('editing with a stale base version is refused (no silent overwrite)', () => {
    let s = seed();
    const t = byTitle(s, '房东');
    const r = s.reviews.find((x) => x.taskId === t.id)!;
    s = editReview(t.id, r.id, 1, { body: 'v2' })(s, NOW);
    expect(() => editReview(t.id, r.id, 1, { body: 'mine' })(s, NOW)).toThrow(PreconditionError);
  });
});

describe('home ordering and exclusivity', () => {
  it('需要你 sorts strictly by deadline: today 18:00 P1 before today 21:00 P0', () => {
    const h = homeLists(seed(), NOW);
    expect(h.need[0].title).toContain('房东');
    expect(h.need[1].title).toContain('东京');
    expect(h.need[0].priority).toBe('P1');
    expect(h.need[1].priority).toBe('P0');
    expect(h.need[h.need.length - 1].task.deadline).toBeNull();
  });
  it('需要你 and DOT 负责 never list the same item', () => {
    const h = homeLists(seed(), NOW);
    const a = new Set(h.need.map((r) => r.id));
    for (const r of [...h.dotActive, ...h.dotQuiet]) expect(a.has(r.id)).toBe(false);
  });
  it('resolving a need moves it to DOT 负责 as waiting for receipt', () => {
    let s = seed();
    const t = byTitle(s, '东京');
    s = resolveNeed(t.id, t.need!.id, { kind: 'choose', optionId: 'b' })(s, NOW);
    const h = homeLists(s, NOW);
    expect(h.need.find((r) => r.id === t.id)).toBeUndefined();
    const row = h.dotActive.find((r) => r.id === t.id)!;
    expect(row.statusLabel).toBe('等待 DOT 接收');
    expect(h.dotActive[0].dotOrder).toBe(0);
    expect((s.decisions ?? []).some((d) => d.taskId === t.id && d.text.includes('方案 B'))).toBe(true);
  });
  it('waiting without a monitor remains with DOT and has no misleading missing-check warning', () => {
    const s = seed();
    const row = taskRow(s, byTitle(s, '车险'), NOW, []);
    expect(row.check.label).toBe('');
    expect(row.status).toBe('waiting');
    expect(homeLists(s, NOW).dotActive.some(r => r.id === row.id)).toBe(true);
  });
  it('priority and deadline are independent', () => {
    let s = seed();
    const t = byTitle(s, '房东');
    s = setPriority(t.id, 'P2')(s, NOW);
    const nt = s.tasks.find((x) => x.id === t.id)!;
    expect(nt.priority).toBe('P2');
    expect(nt.deadline).toEqual(t.deadline);
  });
  it('all-items sort by deadline / priority', () => {
    const s = seed();
    const byDl = allLists(s, NOW, NO_FILTERS, 'deadline').active.map((r) => r.title);
    expect(byDl[0]).toContain('房东');
    const byP = allLists(s, NOW, NO_FILTERS, 'priority').active;
    expect(byP[0].priority).toBe('P0');
    const q = allLists(s, NOW, { ...NO_FILTERS, q: '护照' }, 'status').active;
    expect(q.map((r) => r.title)).toEqual(['护照续签预约']);
  });
});

describe('monitors need a schedule receipt', () => {
  it('requested -> pending; active without receipt -> pending; with receipt -> active', () => {
    let s = seed();
    const t = byTitle(s, '车险');
    s = requestMonitor(t.id, { sources: ['邮箱'], what: '是否回复', freq: '每天', time: '09:00', tz: '上海 UTC+8', until: '2026-10-31', notify: [],fieldOrigins:{sources:{kind:'user_selected'},freq:{kind:'user_selected'},time:{kind:'user_selected'},tz:{kind:'user_selected'},until:{kind:'user_selected'}} })(s, NOW);
    const m = s.monitors.find((x) => x.taskId === t.id)!;
    expect(m.status).toBe('requested');
    expect(monitorPhase(m)).toBe('pending');
    expect(monitorPhase({ ...m, status: 'active' })).toBe('pending');
    expect(monitorPhase({ ...m, status: 'active', scheduleReceipt: 'mcp-sched-1' })).toBe('active');
    expect(taskRow(s, s.tasks.find((x) => x.id === t.id)!, NOW, []).check.label).toBe('检查待 DOT 回执');
  });
  it('editing a monitor creates a new request and supersedes the old one', () => {
    let s = seed();
    const t = byTitle(s, '周报');
    const old = s.monitors.find((x) => x.taskId === t.id)!;
    s = requestMonitor(t.id, { ...old, freq: '每周',fieldOrigins:{sources:{kind:'user_selected'},freq:{kind:'user_selected'},time:{kind:'user_selected'},tz:{kind:'user_selected'},until:{kind:'user_selected'},notify:{kind:'user_selected'}} })(s, NOW);
    const ms = s.monitors.filter((x) => x.taskId === t.id);
    expect(ms).toHaveLength(2);
    expect(ms.find((x) => x.id === old.id)!.status).toBe('stop_requested');
    expect(ms.find((x) => x.id !== old.id)!.supersedes).toBe(old.id);
  });
});

describe('pause, resume and completion', () => {
  it('pause is respected; resume re-hands to DOT with a new handoff waiting for receipt', () => {
    let s = seed();
    const t = byTitle(s, '周报');
    const oldHandoff = t.dot!.handoffId;
    s = pauseTask(t.id)(s, NOW);
    expect(taskStatus(s.tasks.find((x) => x.id === t.id)!)).toBe('paused');
    s = resumeTask(t.id)(s, NOW);
    const nt = s.tasks.find((x) => x.id === t.id)!;
    expect(taskStatus(nt)).toBe('handoff');
    expect(nt.dot!.handoffId).not.toBe(oldHandoff);
  });
  it('user-confirmed completion closes and asks DOT to stop monitors', () => {
    let s = seed();
    const t = byTitle(s, '周报');
    s = confirmComplete(t.id)(s, NOW);
    const nt = s.tasks.find((x) => x.id === t.id)!;
    expect(taskStatus(nt)).toBe('done');
    expect(nt.completion).toMatchObject({ by: 'user', verification: 'user_confirmed' });
    expect(s.monitors.filter((m) => m.taskId === t.id).every((m) => m.status === 'stop_requested')).toBe(true);
  });
  it('DOT "completed" without evidence is not done; with evidence it asks the user to verify', () => {
    const base: Task = byTitle(seed(), '周报');
    const noEv: Task = { ...base, dot: { ...base.dot!, status: 'completed', receipt: 'r1' }, evidence: [] };
    expect(taskStatus(noEv)).toBe('blocked');
    const withEv: Task = { ...noEv, evidence: [{ id: 'e1', at: '', text: '已发送', receipt: 'r1' }] };
    expect(taskStatus(withEv)).toBe('need');
    const stateCompletedByDot: Task = { ...base, state: 'completed', completion: null };
    expect(taskStatus(stateCompletedByDot)).toBe('need');
  });
});

describe('adapter contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('parses the envelope and rejects malformed ones', () => {
    expect(parseEnvelope({ revision: 3, state: null, updatedAt: null }).state.tasks).toEqual([]);
    expect(() => parseEnvelope({ state: {} })).toThrow(ApiError);
    expect(() => parseEnvelope({ revision: 1, state: [] })).toThrow(ApiError);
  });
  it('PUT sends {revision, state} same-origin with no identity headers', async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ revision: 8, state: emptyState(), updatedAt: '2026-10-11T02:00:00Z' }), { status: 200 });
    });
    const env = await httpAdapter().save(7, emptyState());
    expect(env.revision).toBe(8);
    const [url, init] = calls[0];
    expect(url).toBe('/api/state');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(String(init.body))).toEqual({ revision: 7, state: emptyState() });
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(['Accept', 'Content-Type']);
  });
  it.each([[401, 'auth'], [403, 'origin'], [400, 'invalid'], [413, 'too_large'], [409, 'conflict'], [500, 'server']])('maps HTTP %i to %s', async (status, code) => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status }));
    await expect(httpAdapter().load()).rejects.toMatchObject({ code });
  });
  it('maps network failure to network', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fail'); });
    await expect(httpAdapter().load()).rejects.toMatchObject({ code: 'network' });
  });
});
