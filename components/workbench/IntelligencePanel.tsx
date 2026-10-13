'use client';
import { useState } from 'react';
import type { WorkbenchState } from './types';
import type { RunResult } from './useWorkbench';
import { acknowledgeSignal, acceptOpportunity, type Mutation } from './mutations';
import { sharedBlockers } from '../../lib/intelligence';
import { formatDateTimeShort } from './util';

export function IntelligencePanel({state,now,open,run,saving,toast}:{state:WorkbenchState;now:Date;open:(id:string)=>void;run:(label:string,m:Mutation)=>Promise<RunResult>;saving:boolean;toast:(text:string)=>void}) {
  const [expanded,setExpanded]=useState(false);
  const signals=(state.signals??[]).filter(v=>v.state==='new'&&v.attention!=='quiet'&&(!v.taskId||state.tasks.some(t=>t.id===v.taskId&&t.state==='open'))).sort((a,b)=>Number(b.attention==='now')-Number(a.attention==='now')||b.observedAt.localeCompare(a.observedAt));
  const groups=sharedBlockers(state).filter(g=>g.tasks.length>1);
  if(!signals.length&&!groups.length)return null;
  async function act(label:string,m:Mutation) { const r=await run(label,m);if(!r.ok)toast(r.message);else if(r.changed)toast(label==='继续了解这个建议'?'已交给 DOT，等它接收':'已收起这条更新'); }
  return <section className="sec" aria-label="DOT 的新进展">
    <div className="sec-head"><h2>DOT 带来的新进展</h2></div>
    {groups.map(g=><div className="box" key={g.key} style={{gap:8,marginBottom:12}}>
      <span className="box-text" style={{fontWeight:600}}>同一步影响了 {g.tasks.length} 件事</span>
      <span className="box-note">{g.tasks.map(t=>t.title).join('、')}</span>
      <span className="box-text">{g.next}</span>
      <button type="button" className="btn-text" style={{alignSelf:'flex-start'}} onClick={()=>open(g.tasks.find(t=>t.dot?.blocker)?.id||g.tasks[0].id)}>看看卡在哪里</button>
    </div>)}
    {(expanded?signals:signals.slice(0,3)).map(v=><article className="box" key={v.id} style={{gap:10,marginBottom:12}}>
      <span className="box-note">{v.kind==='opportunity'?'一个建议':'新的进展'} · {formatDateTimeShort(v.observedAt,now)}</span>
      <span className="box-text" style={{fontWeight:600}}>{v.title}</span>
      <span className="box-text">{v.summary}</span>
      {v.next&&<span className="box-note">{v.next}</span>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {v.taskId&&<button type="button" className="btn-outline sm" onClick={()=>open(v.taskId!)}>查看这件事</button>}
        {v.kind==='opportunity'&&<button type="button" className="btn-outline sm" disabled={saving} onClick={()=>void act('继续了解这个建议',acceptOpportunity(v.id))}>让 DOT 继续了解</button>}
        <button type="button" className="btn-text" disabled={saving} onClick={()=>void act('收起更新',acknowledgeSignal(v.id))}>知道了</button>
      </div>
    </article>)}
    {signals.length>3&&<button type="button" className="btn-text" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':`还有 ${signals.length-3} 条更新`}</button>}
  </section>;
}
