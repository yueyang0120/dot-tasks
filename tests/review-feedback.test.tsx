import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSeed } from '../components/workbench/demo-seed';
import { approveReview, editReview, requestReviewChanges } from '../components/workbench/mutations';
import { currentReview, taskStatus } from '../components/workbench/model';
import { ReviewSheet } from '../components/workbench/Sheets';
import { validateReviewFeedback } from '../lib/review-feedback';

const now = new Date('2026-10-12T02:00:00Z');
function fixture() {
  const s = demoSeed(now);
  const t = s.tasks.find(x => x.title.includes('房东'))!;
  const r = currentReview(s, t)!;
  return { s, t, r };
}
const opinion = '不用讲这么细，把第一段缩短一点，改完再给我看。';

describe('ask DOT to revise a draft', () => {
  it('preserves the exact opinion and draft, queues the same task and does not approve or send', () => {
    const { s, t, r } = fixture();
    const m = requestReviewChanges(t.id, r.id, r, opinion, 'request-a');
    const next = m(s, now), task = next.tasks.find(x => x.id === t.id)!;
    expect(next.tasks).toHaveLength(s.tasks.length);
    expect(task.reviewFeedback).toMatchObject({ id: 'request-a', reviewId: r.id, version: r.version, contentHash: r.contentHash, text: opinion, handoffId: task.dot!.handoffId });
    expect(taskStatus(task)).toBe('handoff');
    expect(task.need).toBeNull();
    expect(task.dot?.receipt).toBeUndefined();
    expect(currentReview(next, task)).toMatchObject({ body: r.body, approval: null, status: 'invalidated' });
    expect(next.decisions?.at(-1)?.text).toContain(opinion);
    expect(m(next, now)).toBe(next);
    expect(() => approveReview(t.id, r.id, r)(next, now)).toThrow();
    expect(() => validateReviewFeedback(next)).not.toThrow();
  });
  it('withdraws a queued approval and resets the review gate before DOT has started', () => {
    const { s, t, r } = fixture();
    const approved = approveReview(t.id, r.id, r)(s, now);
    const next = requestReviewChanges(t.id, r.id, r, opinion)(approved, now);
    const task = next.tasks.find(x => x.id === t.id)!;
    expect(currentReview(next, task)?.approval).toBeNull();
    expect(currentReview(next, task)?.priorApprovals?.[0].invalidatedAt).toBeTruthy();
    expect(task.steps.find(x => x.role === 'review')?.done).toBe(false);
  });
  it('refuses changed drafts, superseded drafts, pauses and already-started execution', () => {
    const { s, t, r } = fixture();
    const changed = editReview(t.id, r.id, r.version, { body: '新版内容' })(s, now);
    expect(() => requestReviewChanges(t.id, r.id, r, opinion)(changed, now)).toThrow('草稿已经更新');
    const superseded = structuredClone(s);
    superseded.reviews.push({ ...r, id: 'new-review' });
    superseded.tasks.find(x => x.id === t.id)!.need!.reviewId = 'new-review';
    expect(() => requestReviewChanges(t.id, r.id, r, opinion)(superseded, now)).toThrow('草稿已经更新');
    expect(() => approveReview(t.id, r.id, r)(superseded, now)).toThrow('新版');
    const paused = structuredClone(s); paused.tasks.find(x => x.id === t.id)!.state = 'paused';
    expect(() => requestReviewChanges(t.id, r.id, r, opinion)(paused, now)).toThrow();
    const started = approveReview(t.id, r.id, r)(s, now);
    started.tasks.find(x => x.id === t.id)!.dot!.status = 'running';
    started.tasks.find(x => x.id === t.id)!.dot!.receipt = 'Synthetic execution already started';
    expect(() => requestReviewChanges(t.id, r.id, r, opinion)(started, now)).toThrow('DOT 已接手');
  });
  it('requires a new explicit approval after DOT returns a revised draft', () => {
    const { s, t, r } = fixture();
    const next = requestReviewChanges(t.id, r.id, r, opinion)(s, now);
    const task = next.tasks.find(x => x.id === t.id)!;
    const revised = { ...r, id: 'revised', approval: null, status: 'pending' as const };
    next.reviews.push(revised);
    Object.assign(task, { owner: 'user', dot: null, activeReviewId: revised.id, need: { ...t.need!, id: 'new-need', reviewId: revised.id } });
    expect(() => approveReview(t.id, r.id, r)(next, now)).toThrow('新版');
    const approved = approveReview(t.id, revised.id, revised)(next, now);
    expect(currentReview(approved, approved.tasks.find(x => x.id === t.id)!)?.approval?.by).toBe('user');
  });
  it('can request changes to an approved draft whose execution is blocked, without resuming paused tasks', () => {
    const { s, t, r } = fixture();
    const approved = approveReview(t.id, r.id, r)(s, now);
    const blocked = approved.tasks.find(x => x.id === t.id)!;
    blocked.dot!.status = 'blocked'; blocked.dot!.receipt = 'Synthetic action rejected before execution';
    const next = requestReviewChanges(t.id, r.id, r, opinion)(approved, now);
    expect(next.tasks.find(x => x.id === t.id)!.dot!.status).toBe('queued');
    expect(currentReview(next, next.tasks.find(x => x.id === t.id)!)!.approval).toBeNull();
    expect(next.tasks.filter(x => x.state === 'paused')).toEqual(s.tasks.filter(x => x.state === 'paused'));
  });
  it('shows a plain-language feedback box and, after submission, a waiting state without approval controls', () => {
    const { s, t, r } = fixture();
    const props = { now, run: async () => ({ ok: true as const, changed: false }), onClose: () => {}, toast: () => {} };
    const initial = renderToStaticMarkup(<ReviewSheet task={t} review={r} {...props} />);
    expect(initial).toContain('想让 DOT 怎么改？');
    expect(initial).toContain('让 DOT 改一下');
    expect(initial).toContain('自己改内容');
    const next = requestReviewChanges(t.id, r.id, r, opinion)(s, now);
    const task = next.tasks.find(x => x.id === t.id)!;
    const waiting = renderToStaticMarkup(<ReviewSheet task={task} review={currentReview(next, task)!} {...props} />);
    expect(waiting).toContain(opinion);
    expect(waiting).toContain('尚未批准或发送');
    expect(waiting).not.toContain('>批准</button>');
    expect(waiting).not.toContain('>自己改内容</button>');
  });
});
