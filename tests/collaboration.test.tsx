import React from 'react';
import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyState, taskRow, currentReview } from '../components/workbench/model';
import type { Task, WorkbenchState, Preparation, CapabilityCheck } from '../components/workbench/types';
import { normalizeReview, interpretCommand, recordPreparation, recordCapability, prepareDigest, deliverDigest, notificationSummary, validateCollaboration } from '../lib/collaboration';
import { claimTask, planPull, recordSignal, recordPreference, relatedTasks } from '../lib/intelligence';
import { savePreference, disablePreference, resolveNeed } from '../components/workbench/mutations';
import { CollaborationSheet } from '../components/workbench/CollaborationSheet';
import { TaskDetail } from '../components/workbench/Detail';
const now=new Date('2026-10-11T12:00:00Z');
const task=(id:string):Task=>({id,title:'回复小林的入职时间问题',createdAt:now.toISOString(),updatedAt:now.toISOString(),domain:'工作',priority:'P1',deadline:null,state:'open',owner:'user',need:{id:'need-'+id,kind:'material',next:'提供日期',why:'需要真实日期',requestedAt:now.toISOString()},dot:null,steps:[],plan:{nextAction:'先查已有资料',why:'尽量不用本人重复回答',dependsOn:[],prepareWhileWaiting:true},evidence:[{id:'e-'+id,at:now.toISOString(),text:'Synthetic source record only'}]});
const state=(...tasks:Task[]):WorkbenchState=>({...emptyState(),tasks});
const prep:Preparation={id:'brief',kind:'brief',title:'已有的招聘记录',summary:'还缺准确日期',body:'已知：收到录用。未知：面试开始日期。',status:'needs_info',missing:['开始面试的日期'],sourceIds:['e-a'],handoffId:'need-a',createdAt:now.toISOString(),receipt:'Synthetic actual fixture read only'};
const cap:CapabilityCheck={id:'cloud-session-a',label:'DOT 云端消息连接',environment:'cloud',status:'available',step:'读取消息',reason:'这次读到了实际消息',next:'在原授权内继续',checkedAt:now.toISOString(),receipt:'Synthetic checked fixture',sourceIds:['e-a'],taskIds:['a']};
const event=(key:string)=>({key,taskId:'a',kind:'change' as const,title:'虚构测试进展',summary:'测试结果',observedAt:now.toISOString(),receipt:'Synthetic local only',attention:'digest' as const});

describe('six intelligence capabilities',()=>{
  it('keeps the active review even when multiple drafts share a creation timestamp',()=>{
    const t=task('a');t.need=null;t.owner='dot';t.activeReviewId='new';
    const s=state(t);const common={taskId:'a',channel:'note',to:'fictional',cc:'',subject:'',body:'Local exact draft',version:1,contentHash:'fixture',status:'pending' as const,approval:null,createdAt:now.toISOString(),updatedAt:now.toISOString()};
    s.reviews=[{...common,id:'old'},{...common,id:'new'}];expect(currentReview(s,t)?.id).toBe('new');
  });
  it('binds an exact messaging draft without inventing email headers or accepting ambiguous recipients',()=>{
    expect(normalizeReview({taskId:'a',channel:'WhatsApp',to:'Fictional recipient',body:'Synthetic exact draft'})).toMatchObject({cc:'',subject:'',body:'Synthetic exact draft'});
    expect(()=>normalizeReview({taskId:'a',channel:'WhatsApp',to:['Fictional recipient'],body:'Draft'})).toThrow('INVALID_REVIEW');
    expect(()=>normalizeReview({taskId:'a',channel:'WhatsApp',to:'',body:'Draft'})).toThrow('INVALID_REVIEW');
    expect(()=>normalizeReview({taskId:'a',channel:'WhatsApp',to:'recipient',body:'Draft',cc:null})).toThrow('INVALID_REVIEW');
  });
  it('matches natural Chinese, keeps interpretation linked to exact instruction and refuses silent reclassification',()=>{
    const s=state(task('a'));expect(relatedTasks(s,'小林问了入职时间，帮忙跟进')[0].id).toBe('a');
    s.commands=[{id:'cmd',text:'这只是一个建议，不用建待办',createdAt:now.toISOString(),status:'queued'}];
    const intent={kind:'suggestion' as const,summary:'先保留为建议',quote:'不用建待办',taskIds:[],receipt:'Synthetic actual reading',at:now.toISOString()};
    interpretCommand(s,'cmd',intent,now);expect(s.tasks).toHaveLength(1);expect(interpretCommand(s,'cmd',intent,now).deduplicated).toBe(true);
    expect(()=>interpretCommand(s,'cmd',{...intent,kind:'task'},now)).toThrow('INTERPRETATION_ALREADY_RECORDED');
    const another={id:'new',text:'只是讨论',createdAt:now.toISOString(),status:'queued' as const};s.commands.push(another);
    expect(()=>interpretCommand(s,'new',intent,now)).toThrow('COMMAND_SOURCE_REQUIRED');
  });
  it('prepares while waiting for the user without changing their question, rejects stale/expired leases, and retains unknown facts',()=>{
    const s=state(task('a'));expect(planPull(s,now).candidates[0].purpose).toBe('preparation');
    claimTask(s,'a','need-a',now,'lease','preparation');expect(planPull(s,now).candidates).toHaveLength(0);
    recordPreparation(s,'a',prep,'lease',now);expect(s.tasks[0].owner).toBe('user');expect(s.tasks[0].need!.id).toBe('need-a');expect(s.reviews).toHaveLength(0);expect(s.tasks[0].preparation!.missing).toHaveLength(1);
    expect(()=>recordPreparation(s,'a',{...prep,sourceIds:['invented-source']},'lease',now)).toThrow('ACTUAL_SOURCE_REQUIRED');
    expect(()=>recordPreparation(s,'a',prep,'lease',new Date(+now+11*60000))).toThrow('LEASE_REQUIRED');
    const next=resolveNeed('a','need-a',{kind:'material',note:'10月1日'})(s,now);
    expect(()=>recordPreparation(next,'a',prep,'lease',now)).toThrow('HANDOFF_CHANGED');
    s.tasks[0].state='paused';expect(()=>recordPreparation(s,'a',prep,'lease',now)).toThrow('TASK_CLOSED_OR_PAUSED');
  });
  it('never prepares login/review/verification automatically and uses one combined five-task budget',()=>{
    const s=state(...Array.from({length:7},(_,i)=>task('p'+i)));expect(planPull(s,now).candidates).toHaveLength(5);
    for(const kind of ['login','review','verify','inperson'] as const){const t=task('a');t.need!.kind=kind;expect(planPull(state(t),now).candidates).toHaveLength(0);}
  });
  it('keeps capability proof scoped to an actual environment/session and refuses fabricated or older proof',()=>{
    const s=state(task('a'));recordCapability(s,cap,now);expect(s.tasks[0].owner).toBe('user');
    expect(()=>recordCapability(s,{...cap,sourceIds:['fake']},now)).toThrow('ACTUAL_SOURCE_REQUIRED');
    expect(()=>recordCapability(s,{...cap,environment:'local_mac'},now)).toThrow('CAPABILITY_SCOPE_CHANGED');
    expect(()=>recordCapability(s,{...cap,checkedAt:'2026-10-10T00:00:00Z'},now)).toThrow('CAPABILITY_CHECK_STALE');
    recordCapability(s,{...cap,id:'mac',environment:'local_mac',status:'not_checked',checkedAt:undefined,sourceIds:[],taskIds:[],reason:'尚未核对本机连接'},now);expect(s.capabilities![1].status).toBe('not_checked');
    expect(()=>recordCapability(s,{...cap,id:'lie',checkedAt:'2027-01-01T00:00:00Z'},now)).toThrow('CAPABILITY_CHECK_REQUIRED');
  });
  it('atomically reserves a digest once, excludes quiet/paused/delivered changes, and does not mistake delivery for reading',()=>{
    const s=state(task('a'),task('paused'));s.tasks[1].state='paused';
    recordSignal(s,event('one'),now,'one');recordSignal(s,event('two'),now,'two');recordSignal(s,{...event('quiet'),attention:'quiet'},now,'quiet');
    const p=prepareDigest(s,now,'batch');expect(p.send).toBe(true);expect(p.items).toHaveLength(2);
    expect(prepareDigest(s,now,'again').send).toBe(false);expect(notificationSummary(s).uncertain).toHaveLength(2);
    deliverDigest(s,'batch','Synthetic actual owner chat receipt',now);expect(deliverDigest(s,'batch','same',now).deduplicated).toBe(true);
    expect(s.signals![0].state).toBe('new');expect(notificationSummary(s).silent).toBe(true);expect(()=>validateCollaboration(s)).not.toThrow();
    s.digests![0].signalIds.push('not-reserved');expect(()=>validateCollaboration(s)).toThrow('INVALID_DIGEST');
  });
  it('lets the user edit, stop and explicitly re-enable preferences with fresh quotes and history',()=>{
    let s=savePreference('请用平实的中文','pref',undefined,'source')(state(),now);expect(planPull(s,now).preferences).toHaveLength(1);
    const p=s.preferences![0];s=disablePreference(p.id,p.updatedAt)(s,now);expect(planPull(s,now).preferences).toHaveLength(0);
    expect(()=>recordPreference(s,p,now)).toThrow('PREFERENCE_DISABLED_BY_USER');
    s=savePreference('尽量简短，但把背景说清楚','pref',s.preferences![0].updatedAt,'source-new')(s,new Date(+now+1000));
    expect(s.preferences![0].history![0].quote).toBe('请用平实的中文');expect(s.commands[1].text).toContain(s.preferences![0].quote);expect(planPull(s,now).preferences).toHaveLength(1);
    expect(()=>savePreference('不要覆盖','pref','stale')(s,now)).toThrow();
  });
  it('distinguishes missing draft information from waiting for an external reply, and ignores stale drafts',()=>{
    const t=task('a');t.owner='dot';t.need=null;t.dot={handoffId:'need-a',handoffAt:now.toISOString(),status:'waiting',summary:'还缺首次联系记录',receipt:'Synthetic actual fixture'};t.preparation=prep;
    const row=taskRow(state(t),t,now,[]);expect(row.status).toBe('preparation');expect(row.actor).toBe('DOT');expect(row.statusLabel).toBe('还缺一点资料');
    t.preparation={...prep,status:'ready',missing:[]};expect(taskRow(state(t),t,now,[]).statusLabel).toBe('草稿先给你看');
    t.preparation={...prep,handoffId:'old-handoff'};expect(taskRow(state(t),t,now,[]).status).toBe('waiting');
  });
  it('shows prepared content and dependency titles without exposing raw receipts or IDs in ordinary UI',()=>{
    const a=task('a'),b=task('technical-task-b');a.preparation=prep;a.plan!.dependsOn=[b.id];const s=state(a,b);
    const html=renderToStaticMarkup(<TaskDetail row={taskRow(s,a,now,[])} state={s} now={now} onClose={()=>{}} openReview={()=>{}} openWatch={()=>{}} askDone={()=>{}} run={async()=>({ok:true,changed:false})} toast={()=>{}} saving={false}/>);
    expect(html).toContain('DOT 先准备好了');expect(html).toContain(prep.body);expect(html).not.toContain(prep.receipt);expect(html).not.toContain(b.id);expect(html).toContain('dependency-link');
    recordCapability(s,cap,now);const drawer=renderToStaticMarkup(<CollaborationSheet state={s} now={now} onClose={()=>{}} run={async()=>({ok:true,changed:false})} saving={false}/>);
    expect(drawer).toContain('不是实时在线保证');expect(drawer).not.toContain(cap.receipt);expect(drawer).not.toContain(cap.id);
  });
});
