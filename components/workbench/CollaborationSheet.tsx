'use client';
import { useState } from 'react';
import { Sheet } from './Sheets';
import { savePreference, disablePreference, type Mutation } from './mutations';
import type { WorkbenchState, WorkPreference } from './types';
import type { RunResult } from './useWorkbench';
import { formatDateTimeShort } from './util';

export function CollaborationSheet({state,now,run,onClose,saving}:{state:WorkbenchState;now:Date;run:(label:string,m:Mutation,opts?:{inline?:boolean})=>Promise<RunResult>;onClose:()=>void;saving:boolean}) {
  const [text,setText]=useState('');const [editing,setEditing]=useState<WorkPreference|null>(null);const [message,setMessage]=useState('');
  async function go(label:string,m:Mutation){const r=await run(label,m,{inline:true});setMessage(r.ok?'已保存':r.message);if(r.ok){setText('');setEditing(null);}}
  const prefs=state.preferences??[];
  return <Sheet title="怎样和 DOT 合作" sub="你明确说过的偏好，可以在这里查看和调整。" labelId="collaboration-title" onClose={onClose} foot={null}>
    <section className="collab-section"><h3>你的偏好</h3>
      {!prefs.length&&<p>还没有保存偏好。你可以直接告诉 DOT，也可以在这里写一句。</p>}
      {prefs.map(p=><article className="collab-record" key={p.id}>
        <span className="story-time">{p.status==='inactive'?'已停用':p.basis==='dot_suggestion'?'DOT 的建议，尚未采用':'你明确说过的'}</span>
        <p>{p.text}</p><details><summary>当时怎么说的</summary><p>“{p.quote}”</p>{p.history?.map((h,i)=><p key={i} className="story-time">以前：{h.text}</p>)}</details>
        <div className="collab-actions"><button className="btn-text" disabled={saving} onClick={()=>{setEditing(p);setText(p.text);setMessage('');}}>{p.status==='inactive'?'重新使用':p.basis==='dot_suggestion'?'采用或修改':'修改'}</button>{p.status!=='inactive'&&<button className="btn-text" disabled={saving} onClick={()=>void go('停用偏好',disablePreference(p.id,p.updatedAt))}>不再使用</button>}</div>
      </article>)}
      <label className="f-label" htmlFor="preference-input">{editing?'调整这条偏好':'补充一句偏好'}</label>
      <textarea id="preference-input" className="f-input" rows={3} maxLength={2000} placeholder="例如：普通进展集中告诉我，有急事再单独提醒。" value={text} onChange={e=>setText(e.target.value)}/>
      <div className="collab-actions"><button className="btn-dark sm" disabled={saving||!text.trim()} onClick={()=>void go('保存偏好',savePreference(text,editing?.id,editing?.updatedAt))}>保存偏好</button>{editing&&<button className="btn-text" onClick={()=>{setEditing(null);setText('');}}>取消修改</button>}</div>
      {message&&<p role="status">{message}</p>}
    </section>
    <section className="collab-section"><h3>最近理解的指令</h3>
      {state.commands.filter(c=>c.interpretation).slice(-5).reverse().map(c=><article className="collab-record" key={c.id}><p>{c.interpretation!.summary}</p><span className="story-time">{{task:'交代的事项',followup:'原事项的跟进',context:'补充资料',preference:'协作偏好',discussion:'讨论',suggestion:'一个建议',clarify:'还需说清楚'}[c.interpretation!.kind]}</span></article>)}
      {!state.commands.some(c=>c.interpretation)&&<p>DOT 接收新指令后，会在这里说明它理解的意思。</p>}
    </section>
    <section className="collab-section"><h3>在哪儿处理</h3><p>云端负责接收需求和保存进展。需要本机能力时，再看你的 Mac 是否可用。</p>
      {!(state.capabilities??[]).length&&<p>还没有连接检查记录。允许使用某个环境，不等于已经连上。</p>}
      {(state.capabilities??[]).map(c=><article className="collab-record" key={c.id}><h4>{c.label}</h4><span className="story-time">{c.environment==='cloud'?'云端':'你的 Mac'} · {{available:'这次检查可用',blocked:'这一步暂时用不了',not_checked:'还没核对连接'}[c.status]}</span><p>{c.reason}</p><p>{c.next}</p>{c.checkedAt&&<span className="story-time">核对于 {formatDateTimeShort(c.checkedAt,now)}，不是实时在线保证。</span>}</article>)}
    </section>
    <section className="collab-section"><h3>最近的进展</h3><p>普通进展合并告诉你。同一条消息只提醒一次，没有变化就保持安静。</p>
      {(state.signals??[]).filter(v=>v.attention!=='quiet').slice(-8).reverse().map(v=><article className="collab-record" key={v.id}><h4>{v.title}</h4><p>{v.summary}</p><span className="story-time">{v.state==='seen'?'你已看过':v.delivery?.status==='delivered'?'已在 DOT 聊天中提醒':v.delivery?.status==='reserved'?'正在核对是否送达':'还未提醒'}</span></article>)}
      {!(state.signals??[]).some(v=>v.attention!=='quiet')&&<p>目前没有值得单独提醒的新进展。</p>}
    </section>
  </Sheet>;
}
