'use client';
/**
 * State hook over a StateAdapter.
 * - Not optimistic: the UI shows a change only after the server returns the new envelope.
 * - Writes are serialized; each one is computed from the latest saved envelope.
 * - On 409: fetch the authoritative state, keep the user's input, and wait for an explicit
 *   "reapply" — never retried automatically and never overwriting the newer state.
 * - Polling only reads. It does not wake DOT.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StateEnvelope } from './types';
import { ApiError, API_ERROR_TEXT, type StateAdapter } from './adapter';
import { PreconditionError, type Mutation } from './mutations';

export type RunResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'conflict' | 'precondition' | 'error'; message: string };

export interface PendingConflict { label: string; mutation: Mutation }

export interface WorkbenchStore {
  env: StateEnvelope | null;
  phase: 'loading' | 'ready' | 'error';
  loadError: string | null;
  lastSyncAt: number | null;
  syncError: string | null;
  saving: boolean;
  conflict: PendingConflict | null;
  run(label: string, mutation: Mutation, opts?: { inline?: boolean }): Promise<RunResult>;
  reapply(): Promise<RunResult>;
  dismissConflict(): void;
  refresh(): Promise<void>;
}

const POLL_MS = 30_000;

export function useWorkbench(adapter: StateAdapter | null): WorkbenchStore {
  const [env, setEnv] = useState<StateEnvelope | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const envRef = useRef<StateEnvelope | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const busy = useRef(0);

  const adopt = useCallback((e: StateEnvelope) => {
    // A slow read started before a save must never roll the UI back to an older revision.
    if (envRef.current && e.revision < envRef.current.revision) return;
    envRef.current = e;
    setEnv(e);
    setLastSyncAt(Date.now());
    setSyncError(null);
  }, []);

  const fetchLatest = useCallback(async () => {
    if (!adapter) return;
    try {
      const e = await adapter.load();
      adopt(e);
      setPhase('ready');
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message.replace('，没有保存', '') : '读取失败。';
      if (!envRef.current) { setPhase('error'); setLoadError(msg); }
      else setSyncError(msg);
    }
  }, [adapter, adopt]);

  useEffect(() => {
    if (!adapter) return;
    envRef.current = null;
    setEnv(null);
    setPhase('loading');
    void fetchLatest();
  }, [adapter, fetchLatest]);

  // Read-only polling while visible and idle.
  useEffect(() => {
    if (!adapter || adapter.mode !== 'live') return;
    const tick = () => {
      if (document.visibilityState !== 'visible' || busy.current > 0) return;
      void fetchLatest();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [adapter, fetchLatest]);

  const runNow = useCallback(async (label: string, mutation: Mutation, inline: boolean): Promise<RunResult> => {
    const base = envRef.current;
    if (!adapter || !base) return { ok: false, reason: 'error', message: '还没有读到服务器状态。' };
    let next;
    try {
      next = mutation(base.state, new Date());
    } catch (err) {
      if (err instanceof PreconditionError) return { ok: false, reason: 'precondition', message: err.message };
      throw err;
    }
    if (next === base.state) return { ok: true, changed: false };
    busy.current++;
    setSaving(true);
    try {
      const saved = await adapter.save(base.revision, next);
      adopt(saved);
      return { ok: true, changed: true };
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      if (code === 'conflict') {
        await fetchLatest();
        if (!inline) setConflict({ label, mutation });
        return { ok: false, reason: 'conflict', message: API_ERROR_TEXT.conflict + ' 已载入最新状态，你的内容仍保留。' };
      }
      return { ok: false, reason: 'error', message: err instanceof ApiError ? err.message : API_ERROR_TEXT.network };
    } finally {
      busy.current--;
      setSaving(busy.current > 0);
    }
  }, [adapter, adopt, fetchLatest]);

  const run = useCallback((label: string, mutation: Mutation, opts?: { inline?: boolean }) => {
    const p = queue.current.then(() => runNow(label, mutation, !!opts?.inline));
    queue.current = p.catch(() => undefined);
    return p;
  }, [runNow]);

  const reapply = useCallback(async () => {
    const c = conflict;
    if (!c) return { ok: true, changed: false } as RunResult;
    setConflict(null);
    return run(c.label, c.mutation);
  }, [conflict, run]);

  return {
    env, phase, loadError, lastSyncAt, syncError, saving, conflict,
    run, reapply, dismissConflict: () => setConflict(null), refresh: fetchLatest,
  };
}
