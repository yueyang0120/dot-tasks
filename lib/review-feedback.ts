import type { WorkbenchState } from '../components/workbench/types';

/** Feedback is a user instruction, never an approval or execution receipt. */
export function validateReviewFeedback(s: WorkbenchState) {
  for (const task of s.tasks) {
    const f = task.reviewFeedback;
    if (f === undefined) continue;
    if (!f || typeof f !== 'object' || Array.isArray(f) ||
      !['id', 'reviewId', 'contentHash', 'text', 'createdAt', 'handoffId'].every(k => typeof f[k as keyof typeof f] === 'string' && String(f[k as keyof typeof f]).trim()) ||
      f.text.length > 6000 || !Number.isInteger(f.version) || f.version < 1 || !Number.isFinite(Date.parse(f.createdAt)) ||
      !s.reviews.some(r => r.taskId === task.id && r.id === f.reviewId)) throw new Error('INVALID_REVIEW_FEEDBACK');
  }
}
