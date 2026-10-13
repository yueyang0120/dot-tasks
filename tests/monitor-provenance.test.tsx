import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WatchSheet } from '../components/workbench/Sheets';
import { emptyState, monitorSetting } from '../components/workbench/model';
import { requestMonitor } from '../components/workbench/mutations';
import { checkMonitorPatch } from '../lib/monitor-provenance';
import type { Monitor, Task } from '../components/workbench/types';
const now=new Date('2026-10-11T11:00:00Z');
const task:Task={id:'fictional-followup',title:'等 WhatsApp 回复',domain:'工作',priority:'P1',deadline:null,state:'open',owner:'dot',need:null,dot:{handoffId:'h1',handoffAt:now.toISOString(),status:'queued',summary:'等接收'},steps:[],createdAt:now.toISOString(),updatedAt:now.toISOString()};
const cfg={what:'WhatsApp 没登录就提醒我，给我二维码。',sources:[],freq:null,time:'',tz:'',until:'',notify:[],fieldOrigins:{}};
const fresh=():Monitor=>requestMonitor(task.id,cfg)({...emptyState(),tasks:[task]},now).monitors[0];

describe('follow-up preferences retain their actual source',()=>{
  it('accepts only the user sentence, with no invented email, cadence, timezone, cutoff or notification condition',()=>{
    const m=fresh();expect(m.what).toBe(cfg.what);
    expect(m).toMatchObject({sources:[],freq:null,time:'',tz:'',until:'',notify:[],fieldOrigins:{},status:'requested'});
    const html=renderToStaticMarkup(<WatchSheet task={task} state={{...emptyState(),tasks:[task]}} run={async()=>({ok:true,changed:false})} onClose={()=>{}} toast={()=>{}}/>);
    expect(html).not.toContain('value="09:00"');expect(html).not.toContain('value="2026-10-31"');
    expect(html).not.toMatch(/aria-pressed="true"><span>邮箱/);
    expect(html).toContain('<option value="" selected="">未指定</option>');
  });
  it('labels legacy settings honestly and does not preselect them again while editing',()=>{
    const m={...fresh(),sources:['邮箱'],freq:'每天' as const,time:'09:00',tz:'上海 UTC+8',until:'2026-10-31',notify:['有新回复'],fieldOrigins:undefined};
    expect(monitorSetting(m,'sources','邮箱')).toContain('来源未确认');
    const html=renderToStaticMarkup(<WatchSheet task={task} state={{...emptyState(),tasks:[task],monitors:[m]}} run={async()=>({ok:true,changed:false})} onClose={()=>{}} toast={()=>{}}/>);
    expect(html).not.toContain('value="09:00"');expect(html).not.toContain('value="2026-10-31"');
    expect(html).not.toMatch(/aria-pressed="true"><span>邮箱/);
  });
  it('rejects unsupported extraction and agent impersonation of a user selection',()=>{
    const m=fresh();
    expect(()=>requestMonitor(task.id,{...cfg,sources:['邮箱']})({...emptyState(),tasks:[task]},now)).toThrow('没有明确来源');
    expect(()=>checkMonitorPatch(m,{sources:['邮箱']})).toThrow('MONITOR_FIELD_ORIGIN_REQUIRED');
    expect(()=>checkMonitorPatch(m,{sources:['邮箱'],fieldOrigins:{sources:{kind:'user_selected'}}})).toThrow('USER_SELECTION_REQUIRED');
    expect(()=>checkMonitorPatch(m,{freq:'每天',fieldOrigins:{freq:{kind:'user_instruction',quote:'每天9点'}}})).toThrow('USER_INSTRUCTION_QUOTE_REQUIRED');
    expect(()=>checkMonitorPatch(m,{sources:['WhatsApp'],fieldOrigins:{sources:{kind:'user_instruction',quote:'WhatsApp'}}})).not.toThrow();
  });
  it('keeps a DOT suggestion visibly separate and refuses to activate it as a user request',()=>{
    const m=fresh();const fieldOrigins={freq:{kind:'dot_suggestion' as const}};
    expect(monitorSetting({...m,freq:'每天',fieldOrigins},'freq','每天')).toContain('DOT 建议，未确认');
    expect(()=>checkMonitorPatch(m,{freq:'每天',fieldOrigins,status:'active',scheduleReceipt:'fictional-proof'})).toThrow('MONITOR_SUGGESTION_NOT_CONFIRMED');
  });
});
