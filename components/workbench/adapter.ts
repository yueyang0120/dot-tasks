/**
 * The only module that talks to the server.
 *
 *   GET  /api/state            -> { revision, state, updatedAt }
 *   PUT  /api/state {revision, state} -> { revision, state, updatedAt }
 *
 * Same-origin cookies, JSON only, no identity headers. The revision is updated only from a
 * successful response. 409 is surfaced to the caller (never retried blindly here).
 */
import type { StateEnvelope, WorkbenchState } from './types';
import { normalizeState } from './model';

export type ApiErrorCode = 'auth' | 'origin' | 'invalid' | 'too_large' | 'conflict' | 'network' | 'server' | 'bad_response';

export const API_ERROR_TEXT: Record<ApiErrorCode, string> = {
  auth: '站点登录不可用或已失效（401），没有保存。请重新打开站点后再试。',
  origin: '请求来源被服务器拒绝（403），没有保存。',
  invalid: '服务器认为数据无效（400），没有保存。',
  too_large: '内容太大，服务器拒收（413），没有保存。',
  conflict: '服务器上的状态已被更新（409），你的操作还没保存。',
  network: '连不上服务器，没有保存。',
  server: '服务器出错，没有保存。',
  bad_response: '服务器返回的数据无法识别，没有保存。',
};

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, public status?: number, message?: string) {
    super(message || API_ERROR_TEXT[code]);
  }
}

export interface StateAdapter {
  mode: 'live' | 'demo';
  load(signal?: AbortSignal): Promise<StateEnvelope>;
  save(revision: number, state: WorkbenchState): Promise<StateEnvelope>;
}

function codeFor(status: number): ApiErrorCode {
  if (status === 401) return 'auth';
  if (status === 403) return 'origin';
  if (status === 400) return 'invalid';
  if (status === 413) return 'too_large';
  if (status === 409) return 'conflict';
  return 'server';
}

export function parseEnvelope(json: unknown): StateEnvelope {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  if (!o || typeof o.revision !== 'number' || !Number.isFinite(o.revision)) throw new ApiError('bad_response');
  if (o.state !== null && o.state !== undefined && (typeof o.state !== 'object' || Array.isArray(o.state))) throw new ApiError('bad_response');
  return {
    revision: o.revision,
    state: normalizeState(o.state),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
  };
}

export function httpAdapter(endpoint = '/api/state'): StateAdapter {
  async function call(init: RequestInit): Promise<StateEnvelope> {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError('network');
    }
    if (!res.ok) throw new ApiError(codeFor(res.status), res.status);
    let json: unknown;
    try { json = await res.json(); } catch { throw new ApiError('bad_response', res.status); }
    return parseEnvelope(json);
  }
  return {
    mode: 'live',
    load: (signal) => call({ method: 'GET', signal }),
    save: (revision, state) => call({ method: 'PUT', body: JSON.stringify({ revision, state }) }),
  };
}

/**
 * Opt-in fictional demo: in-memory only, never touches /api/state, lost on reload.
 * Enabled only when the page passes allowDemo and the URL has ?demo=1.
 */
export function demoAdapter(seed: () => WorkbenchState): StateAdapter {
  let env: StateEnvelope = { revision: 1, state: seed(), updatedAt: new Date().toISOString() };
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    mode: 'demo',
    load: async () => clone(env),
    save: async (revision, state) => {
      await new Promise((r) => setTimeout(r, 250));
      if (revision !== env.revision) throw new ApiError('conflict', 409);
      env = { revision: env.revision + 1, state: clone(state), updatedAt: new Date().toISOString() };
      return clone(env);
    },
  };
}
