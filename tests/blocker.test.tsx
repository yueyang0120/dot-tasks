import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { validBlocker, checkBlockedReport } from '../lib/blocker';
import { TaskDetail } from '../components/workbench/Detail';
import { emptyState, taskRow } from '../components/workbench/model';
import type { Task } from '../components/workbench/types';

const now = new Date('2026-10-11T12:00:00Z');
const task: Task = {id:'fictional',title:'会面安排还没确认',createdAt:now.toISOString(),updatedAt:now.toISOString(),domain:'工作',priority:'P1',deadline:null,state:'open',owner:'dot',need:null,steps:[],dot:{handoffId:'handoff',handoffAt:now.toISOString(),status:'blocked',summary:'还没看到最新消息',receipt:'synthetic test receipt',waitingOn:'旧记录说需要恢复登录'}};
const blocker = {step:'读取会面消息',reason:'这次打开消息页面，看到登录二维码，还没有进入聊天列表。',next:'你扫码登录后，DOT 再读取消息，确认会面时间。',basis:'current_check' as const,observedAt:now.toISOString()};
function render(t:Task) {
  const state=emptyState();state.tasks=[t];
  return renderToStaticMarkup(<TaskDetail row={taskRow(state,t,now,[])} state={state} now={now} onClose={()=>{}} openReview={()=>{}} openWatch={()=>{}} askDone={()=>{}} run={async()=>({ok:true,changed:false})} toast={()=>{}} saving={false}/>);
}
describe('specific blockers',()=>{
  it('shows the actual step, cause, check time and next action without opening technical details',()=>{
    const t=structuredClone(task);t.dot!.blocker=blocker;
    const front=render(t).split('<details')[0];
    expect(front).toContain(blocker.step);expect(front).toContain(blocker.reason);expect(front).toContain(blocker.next);expect(front).toContain('这次检查');
    expect(front).not.toContain('旧记录说需要恢复登录');
    expect(taskRow(emptyState(),t,now,[]).line).toBe(blocker.reason);
  });
  it('labels old evidence as unverified now and keeps legacy reasons visible without inventing a fresh check',()=>{
    const t=structuredClone(task);t.dot!.blocker={...blocker,basis:'last_record'};
    expect(render(t)).toContain('按上次记录，尚未重新核对');
    const legacy=render(task);expect(legacy).toContain(task.dot!.waitingOn!);expect(legacy).toContain('还缺具体步骤和检查结果');expect(legacy).not.toContain('这次检查');
  });
  it('distinguishes a missing result proof from an access failure and ignores stale blockers after recovery',()=>{
    const t=structuredClone(task);t.dot!.status='completed';t.dot!.blocker=blocker;
    expect(render(t)).toContain('还没有留下能核对结果的证据');expect(render(t)).not.toContain(blocker.reason);
    t.dot!.status='running';expect(render(t)).not.toContain(blocker.reason);
  });
  it('rejects empty causes, missing next steps and current checks without a valid timestamp',()=>{
    expect(validBlocker(blocker)).toBe(true);
    for(const bad of [{...blocker,reason:' '},{...blocker,next:''},{...blocker,observedAt:undefined},{...blocker,observedAt:'today'},{...blocker,basis:'assumed'}])expect(validBlocker(bad)).toBe(false);
    expect(()=>checkBlockedReport(task.dot)).toThrow('BLOCKER_DETAILS_REQUIRED');
    expect(()=>checkBlockedReport({...task.dot,blocker})).not.toThrow();
    expect(()=>checkBlockedReport({...task.dot,status:'running'})).not.toThrow();
  });
});
