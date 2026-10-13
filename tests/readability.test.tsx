import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskDetail } from '../components/workbench/Detail';
import { emptyState, taskRow } from '../components/workbench/model';
import { resolveNeed } from '../components/workbench/mutations';
import { agentContract } from '../lib/agent-contract';
import type { Task } from '../components/workbench/types';

const now = new Date('2026-10-11T10:00:00Z');
const task: Task = { id: 'synthetic-aws', title: '这次 AWS 改密码和登录，是你操作的吗？', createdAt: now.toISOString(), updatedAt: now.toISOString(), domain: '项目', priority: 'P0', deadline: null, state: 'open', owner: 'user', dot: null, steps: [],
  briefing: { background: '邮箱里出现了两封密码更新通知，随后又收到登录验证通知。', latest: '目前还不知道是不是你操作的。这些通知本身不能证明账号被盗。' },
  need: {id:'answer-aws', kind:'choose', next:'这次改密码和登录，是你操作的吗？', why:'先确认是不是本人。', requestedAt:now.toISOString(), options:[{id:'yes',name:'是我操作的'},{id:'unknown',name:'不是我／不确定'}]},
  evidence:[{id:'e1',at:now.toISOString(),text:'Synthetic source record',receipt:'Sentinel_SYNTHETIC_INTERNAL_ID'}] };

describe('human-facing task detail', () => {
  it('leads with context and an answer, keeps technical receipts inside collapsed details', () => {
    const state=emptyState(); state.tasks=[task]; state.contexts=[{id:'source1',taskId:task.id,kind:'chat',label:'Sentinel_SYNTHETIC_RAW_SOURCE',summary:'DOT 看过相关通知，正在等你确认是否本人操作。'}];
    const html=renderToStaticMarkup(<TaskDetail row={taskRow(state,task,now,[])} state={state} now={now} onClose={()=>{}} openReview={()=>{}} openWatch={()=>{}} askDone={()=>{}} run={async()=>({ok:true,changed:false})} toast={()=>{}} saving={false}/>);
    expect(html.indexOf(task.briefing!.background)).toBeLessThan(html.indexOf('需要你回答一下'));
    expect(html).toContain('是我操作的');
    expect(html).not.toContain('确认已完成');
    expect(html.split('<details')[0]).not.toContain('Sentinel_SYNTHETIC_INTERNAL_ID');
    expect(html).toContain('Sentinel_SYNTHETIC_INTERNAL_ID');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain('目标、决定与验收依据');
    expect(html).not.toContain('尚未安排检查');
    expect(html).not.toContain('安排检查</button>');
    expect(html).toContain('DOT 看过相关通知，正在等你确认是否本人操作。');
    expect(html.split('原始记录（排查时用）')[0]).not.toContain('Sentinel_SYNTHETIC_RAW_SOURCE');
  });
  it('does not let the user select an empty or partly missing answer', () => {
    const broken=structuredClone(task); broken.need!.options![0].name='';
    const state=emptyState(); state.tasks=[broken];
    const html=renderToStaticMarkup(<TaskDetail row={taskRow(state,broken,now,[])} state={state} now={now} onClose={()=>{}} openReview={()=>{}} openWatch={()=>{}} askDone={()=>{}} run={async()=>({ok:true,changed:false})} toast={()=>{}} saving={false}/>);
    expect(html).not.toContain('role="radio"');
    expect(html).toContain('选项还没整理好');
    expect(html).not.toContain('提交回答');
  });
  it('answering the identity question hands it back to DOT without closing it or losing its context', () => {
    const state=emptyState(); state.tasks=[structuredClone(task)];
    const next=resolveNeed(task.id,task.need!.id,{kind:'choose',optionId:'unknown'})(state,now);
    expect(next.tasks[0].state).toBe('open');
    expect(next.tasks[0].owner).toBe('dot');
    expect(next.tasks[0].dot?.status).toBe('queued');
    expect(next.tasks[0].briefing).toEqual(task.briefing);
    expect(next.tasks[0].evidence).toEqual(task.evidence);
    expect(agentContract.writing.action).toContain('不用 verify');
  });
});
