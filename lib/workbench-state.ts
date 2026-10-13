import { env } from 'cloudflare:workers';
import { draftContentHash } from '../components/workbench/util';
import type { Review } from '../components/workbench/types';
import type { Monitor } from '../components/workbench/types';
import { validMonitorOrigins } from './monitor-provenance';
import { validBlocker } from './blocker';
import { validateIntelligence } from './intelligence';
import { validateReviewFeedback } from './review-feedback';
import type { WorkbenchState } from '../components/workbench/types';

export type WorkspaceState = {
  tasks: Record<string, unknown>[];
  commands: Record<string, unknown>[];
  monitors: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  workspaces: string[];
  [key: string]: unknown;
};

export const emptyState = (): WorkspaceState => ({tasks:[], commands:[], monitors:[], reviews:[], runs:[], workspaces:[]});

export async function readWorkspace() {
  const row = await env.DB!.prepare('SELECT revision, data, updated_at FROM workspaces WHERE id = ?').bind('owner').first<{revision:number;data:string;updated_at:string}>();
  return row ? {revision:row.revision, state:JSON.parse(row.data) as WorkspaceState, updatedAt:row.updated_at} : {revision:0,state:emptyState(),updatedAt:null};
}

export function validateState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as WorkspaceState;
  try { validateIntelligence(state as unknown as WorkbenchState); validateReviewFeedback(state as unknown as WorkbenchState); } catch { return false; }
  const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
  if(!['tasks','commands','monitors','reviews','runs'].every(key => Array.isArray(state[key]) && (state[key] as unknown[]).length <= 1000 && (state[key] as unknown[]).every(item => item && typeof item === 'object' && !Array.isArray(item))))return false;
  if(!['tasks','commands','monitors','reviews','runs'].every(key=>{const rows=state[key] as Record<string,unknown>[];return rows.every(r=>text(r.id))&&new Set(rows.map(r=>r.id)).size===rows.length;}))return false;
  if(!state.tasks.every(t=>text(t.title)&&['open','paused','completed'].includes(t.state as string)&&Array.isArray(t.steps)&&((t.owner==='user'&&t.need&&t.dot===null)||(t.owner==='dot'&&t.dot&&t.need===null))))return false;
  if(!state.tasks.every(t=>t.evidence===undefined||(Array.isArray(t.evidence)&&t.evidence.every(e=>e&&typeof e==='object'&&text(e.id)&&text(e.at)&&text(e.text)))))return false;
  // Legacy blocked tasks remain editable; new MCP blocked reports require details.
  if(!state.tasks.every(t=>(t.dot as any)?.blocker == null || validBlocker((t.dot as any).blocker)))return false;
  if(!state.tasks.every(t=>t.briefing===undefined||(t.briefing&&typeof t.briefing==='object'&&!Array.isArray(t.briefing)&&text((t.briefing as Record<string,unknown>).background)&&Object.entries(t.briefing).every(([k,v])=>!['background','latest','next','checkedAt'].includes(k)||(typeof v==='string'&&v.length<=4000)))))return false;
  if(!state.commands.every(c=>text(c.text)&&['queued','acknowledged','running','completed','blocked'].includes(c.status as string)&&(c.status==='queued'||text(c.receipt))))return false;
  if(!state.reviews.every(r=>{
    if(!['channel','to','cc','subject','body'].every(k=>typeof r[k]==='string')||!Number.isInteger(r.version)||Number(r.version)<1)return false;
    const hash=draftContentHash(r as unknown as Review),a=r.approval as Review['approval'];
    if(r.contentHash!==hash)return false;
    if(r.status==='approved'&&(!a||a.invalidatedAt||a.version!==r.version||a.contentHash!==hash))return false;
    return r.status!=='executed'||text(r.executionReceipt);
  }))return false;
  if(!state.monitors.every(m=>['requested','active','stop_requested','stopped','failed'].includes(m.status as string)&&(m.status!=='active'||text(m.scheduleReceipt))))return false;
  if(!state.monitors.every(m=>validMonitorOrigins(m as unknown as Monitor)))return false;
  if(!state.runs.every(r=>text(r.receipt)&&text(r.summary)&&text(r.startedAt)))return false;
  return Array.isArray(state.workspaces)&&state.workspaces.length<=100&&state.workspaces.every(item=>typeof item==='string'&&item.length<=100)&&JSON.stringify(state).length<=1500000;
}

export async function writeWorkspace(state:WorkspaceState, revision:number) {
  const updatedAt = new Date().toISOString();
  if (revision === 0) {
    const result = await env.DB!.prepare('INSERT OR IGNORE INTO workspaces (id, revision, data, updated_at) VALUES (?, ?, ?, ?)').bind('owner',1,JSON.stringify(state),updatedAt).run();
    if (result.meta.changes) return {revision:1,state,updatedAt};
  }
  const result = await env.DB!.prepare('UPDATE workspaces SET revision = revision + 1, data = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(state),updatedAt,'owner',revision).run();
  if (!result.meta.changes) throw new Error('CONFLICT');
  return {revision:revision+1,state,updatedAt};
}
