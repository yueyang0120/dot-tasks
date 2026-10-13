import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimTask, checkLease, planPull, recordPreference, recordSignal, reserveNotification, relatedTasks, validateIntelligence } from '../lib/intelligence';
import { emptyState } from '../components/workbench/model';
import { acceptOpportunity, acknowledgeSignal } from '../components/workbench/mutations';
import { IntelligencePanel } from '../components/workbench/IntelligencePanel';
import type { Task, WorkbenchState, WorkPreference } from '../components/workbench/types';

const now=new Date('2026-10-11T12:00:00Z');
const task=(id:string):Task=>({id,title:id,createdAt:'2026-10-10T00:00:00Z',updatedAt:now.toISOString(),domain:'工作',priority:'P1',deadline:null,state:'open',owner:'dot',need:null,steps:[],dot:{handoffId:id+'-handoff',handoffAt:now.toISOString(),status:'waiting',summary:'等最新消息',receipt:'Synthetic fixture'},plan:{nextAction:'核对消息',why:'消息可能有变化',dependsOn:[]}});
const state=(...tasks:Task[]):WorkbenchState=>({...emptyState(),tasks});
const signal={key:'fictional-event',kind:'change' as const,title:'收到回复',summary:'虚构测试来源有新回复',next:'DOT 准备草稿',observedAt:now.toISOString(),receipt:'Synthetic local-only event',attention:'now' as const};

describe('autonomous queue',()=>{
  it('orders equally ready tasks by P0, P1, P2 and leaves paused urgent work out',()=>{
    const urgent=task('urgent'),important=task('important'),later=task('later'),unknown=task('unknown'),paused=task('paused-urgent');
    urgent.priority='P0';important.priority='P1';later.priority='P2';unknown.priority=null;paused.priority='P0';paused.state='paused';
    const plan=planPull(state(later,unknown,important,paused,urgent),now);
    expect(plan.candidates.map(t=>t.id)).toEqual(['urgent','important','later','unknown']);
    expect(plan.candidates[0].nextAction).toBe('核对消息');
  });
  it('advances multiple eligible tasks, prioritises a new handoff and excludes paused, complete, human, future and dependencies',()=>{
    const a=task('a'),b=task('b'),queued=task('new');queued.dot!.status='queued';queued.plan!.nextCheckAt='2027-01-01T00:00:00Z';
    const paused=task('paused');paused.state='paused';const complete=task('closed');complete.state='completed';
    const human=task('human');human.owner='user';human.dot=null;human.need={id:'need',kind:'clarify',next:'给日期',why:'需要日期',requestedAt:now.toISOString()};
    const future=task('future');future.plan!.nextCheckAt='2026-10-12T00:00:00Z';
    const dependent=task('dependent');dependent.plan!.dependsOn=['human'];
    const p=planPull(state(a,b,queued,paused,complete,human,future,dependent),now);
    expect(p.candidates.map(c=>c.id)).toEqual(['new','a','b']);expect(p.deferred.map(c=>c.id)).toEqual(['human','future','dependent']);
  });
  it('allows a dependency with real result proof and rejects missing references and cycles',()=>{
    const a=task('a'),b=task('b');b.plan!.dependsOn=['a'];a.dot!.status='completed';a.evidence=[{id:'e',at:now.toISOString(),text:'Synthetic actual fixture check'}];
    expect(planPull(state(a,b),now).candidates.map(c=>c.id)).toEqual(['b']);
    a.plan!.dependsOn=['b'];expect(()=>validateIntelligence(state(a,b))).toThrow('DEPENDENCY_CYCLE');
    a.plan!.dependsOn=[];b.plan!.dependsOn=['missing'];expect(()=>validateIntelligence(state(a,b))).toThrow('INVALID_DEPENDENCY');
  });
  it('checks a shared failure once and keeps unrelated cloud work ready',()=>{
    const a=task('a'),b=task('b'),c=task('c');
    for(const t of [a,b]){t.dot!.status='blocked';t.dot!.blocker={step:'读消息',reason:'Synthetic login page',next:'请扫码',basis:'current_check',observedAt:now.toISOString(),sharedKey:'same-cloud-login'};}
    const p=planPull(state(a,b,c),now);expect(p.candidates.map(c=>c.id)).toEqual(['a','c']);expect(p.sharedBlockers[0].taskIds).toEqual(['a','b']);
  });
  it('prevents overlapping execution, expires a lease, and refuses a stale handoff',()=>{
    const s=state(task('a'));const lease=claimTask(s,'a','a-handoff',now,'lease');
    expect(planPull(s,now).candidates).toHaveLength(0);expect(()=>checkLease(s.tasks[0],'wrong',now)).toThrow('LEASE_REQUIRED');
    expect(()=>checkLease(s.tasks[0],lease.id,now)).not.toThrow();
    expect(planPull(s,new Date(+now+11*60000)).candidates).toHaveLength(1);
    expect(()=>claimTask(s,'a','stale',now,'new-lease')).toThrow('HANDOFF_CHANGED');
  });
  it('finds existing closed tasks without reopening them',()=>{
    const t=task('morgan');t.title='Morgan 的见面安排';t.state='completed';const s=state(t);
    expect(relatedTasks(s,'Morgan')[0].state).toBe('completed');expect(s.tasks[0].state).toBe('completed');
  });
});

describe('meaningful changes and preference provenance',()=>{
  it('deduplicates by source event even after seeing it, and does not invent a check or notification',()=>{
    const s=state();const first=recordSignal(s,signal,now,'first');acknowledgeSignal('first')(s,now);
    const again=recordSignal(s,{...signal,summary:'Rephrased same event'},new Date(+now+3600000),'second');
    expect(first.deduplicated).toBe(false);expect(again.deduplicated).toBe(true);expect(s.signals).toHaveLength(1);expect(s.signals![0].delivery).toBeUndefined();
    expect(()=>recordSignal(s,{...signal,key:'bad',receipt:''},now,'bad')).toThrow('SIGNAL_EVIDENCE_REQUIRED');
  });
  it('reserves notification once, never blindly retries an uncertain send, and excludes quiet/seen/inactive signals',()=>{
    const s=state();recordSignal(s,signal,now,'event');
    expect(reserveNotification(s,'event',now,'delivery').send).toBe(true);
    expect(reserveNotification(s,'event',new Date(+now+86400000),'retry').reason).toBe('delivery_uncertain_reconcile_first');
    s.signals![0].delivery!.status='delivered';s.signals![0].delivery!.receipt='Synthetic delivery';
    expect(reserveNotification(s,'event',now,'retry').reason).toBe('already_delivered');
    recordSignal(s,{...signal,key:'quiet',attention:'quiet'},now,'quiet');expect(()=>reserveNotification(s,'quiet',now,'q')).toThrow('NOTIFICATION_NOT_NEEDED');
  });
  it('keeps a proposed opportunity outside tasks until the user asks to explore it, and preserves server records',()=>{
    const s=state();recordSignal(s,{...signal,kind:'opportunity'},now,'idea');const next=acceptOpportunity('idea','stable-command')(s,now);
    expect(s.tasks).toHaveLength(0);expect(next.tasks).toHaveLength(0);expect(next.commands[0].status).toBe('queued');expect(next.signals![0].state).toBe('seen');
    expect(next.signals![0].receipt).toBe(signal.receipt);expect(()=>acceptOpportunity('idea')(next,now)).toThrow();
  });
  it('uses actual user quotes for preferences and never promotes a model suggestion',()=>{
    const s=state();s.commands=[{id:'source',text:'请写得简短一点',status:'queued',createdAt:now.toISOString()}];
    const p={id:'brief',text:'偏好简短说明',basis:'user_instruction',sourceId:'source',quote:'简短一点'} as WorkPreference;
    recordPreference(s,p,now);expect(planPull(s,now).preferences).toHaveLength(1);
    expect(()=>recordPreference(s,{...p,quote:'每天9点'},now)).toThrow('PREFERENCE_QUOTE_REQUIRED');
    expect(()=>recordPreference(s,{...p,basis:'dot_suggestion'},now)).toThrow('USER_PREFERENCE_CANNOT_BE_REPLACED_BY_SUGGESTION');
    recordPreference(s,{...p,id:'suggestion',basis:'dot_suggestion'},now);expect(planPull(s,now).preferences).toHaveLength(1);
  });
  it('shows concise updates and shared blockers without exposing IDs or technical receipts, and hides inactive/quiet events',()=>{
    const s=state();recordSignal(s,signal,now,'event');recordSignal(s,{...signal,key:'quiet',attention:'quiet',title:'隐藏更新'},now,'quiet');
    const html=renderToStaticMarkup(<IntelligencePanel state={s} now={now} open={()=>{}} run={async()=>({ok:true,changed:false})} saving={false} toast={()=>{}}/>);
    expect(html).toContain(signal.summary);expect(html).not.toContain(signal.receipt);expect(html).not.toContain('隐藏更新');expect(html).toContain('知道了');
  });
});
