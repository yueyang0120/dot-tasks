'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { CommandRow, TaskRow } from './model';
import {
  NEED_META, PRIORITY_TEXT, currentMonitor, currentReview, hasReceipt, monitorPhase, monitorSetting, reviewPhase, taskLog, taskRecords,
} from './model';
import type { Priority, WorkbenchState } from './types';
import { resolveNeed, setDeadline, setPriority, pauseTask, resumeTask, type Mutation, type Resolution } from './mutations';
import { formatDateTimeShort, formatDeadline, formatLogTime, toLocalInput } from './util';
import type { RunResult } from './useWorkbench';
import { Pri } from './Lists';

type Run = (label: string, m: Mutation, opts?: { inline?: boolean }) => Promise<RunResult>;

interface Common {
  now: Date;
  onClose: () => void;
  run: Run;
  toast: (t: string) => void;
  saving: boolean;
}

function DetailFrame({ crumb, onClose, children }: { crumb: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="wb-detail" aria-label="事项详情">
      <div className="d-top">
        <button type="button" className="d-back" onClick={onClose}>
          <span className="m"><ChevronLeft size={18} aria-hidden />返回</span><span className="d">关闭</span>
        </button>
        <span className="d-crumb">{crumb}</span>
        <div className="d-spacer" />
      </div>
      <div className="d-body">{children}</div>
    </aside>
  );
}

const CTX_LABEL: Record<string, string> = { instruction: '你交代的', chat: '与 DOT 的聊天', email: '邮件', calendar: '日历', web: '网页', file: '文件', note: '备注', space: 'Space' };

export function CommandDetail({ row, now, onClose }: { row: CommandRow } & Pick<Common, 'now' | 'onClose'>) {
  const c = row.command;
  return (
    <DetailFrame crumb={`新指令 · ${row.statusLabel}`} onClose={onClose}>
      <div className="d-title">
        <h2>{c.text}</h2>
        <span className="who">你交出于 {formatDateTimeShort(c.createdAt, now)} · 现在轮到 <b>DOT</b></span>
      </div>
      <div className="box">
        <div className="box-head"><span className="k dot">DOT 负责 · {row.statusLabel}</span><span className={`tone-${row.check.tone}`} style={{ fontWeight: 600 }}>{row.check.label}</span></div>
        <span className="box-text">{row.line}</span>
        {row.status === 'queued' && (
          <span className="box-note">指令已保存到工作台。DOT 接收前不会开始；刷新页面不会唤醒 DOT。接收后会先理解你的意思，再决定是跟进已有事项、保存偏好，还是新增要办的事。</span>
        )}
        {c.interpretation&&<span className="box-note">DOT 理解为：{c.interpretation.summary}</span>}
        {hasReceipt(c.receipt) && <details className="records"><summary>查看处理记录</summary><span className="rec">{c.receipt}</span></details>}
      </div>
      <div className="d-sec">
        <h3>来源</h3>
        <div className="src"><span className="k">口述</span>「{c.text}」</div>
      </div>
    </DetailFrame>
  );
}

export function TaskDetail(p: { row: TaskRow; state: WorkbenchState; openTask?: (id:string) => void; openReview: () => void; openWatch: () => void; askDone: () => void } & Common) {
  const { row, state, now, run, toast } = p;
  const t = row.task;
  const need = row.need;
  const review = currentReview(state, t);
  const rphase = review ? reviewPhase(review) : null;
  const monitor = currentMonitor(state, t.id);
  const mphase = monitor ? monitorPhase(monitor) : null;
  const log = taskLog(state, t);
  const rec = taskRecords(state, t.id);
  const closed = row.status === 'done';
  const canWatch = t.state === 'open';

  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [editMeta, setEditMeta] = useState(false);
  const [dl, setDl] = useState('');
  useEffect(() => { setChoice(null); setNote(''); setErr(null); setEditMeta(false); }, [t.id, need?.id]);

  async function go(label: string, m: Mutation, ok: string) {
    setErr(null);
    const r = await run(label, m, { inline: true });
    if (r.ok) { if (r.changed) toast(ok); }
    else setErr(r.message + (r.reason === 'conflict' ? ' 确认无误后可再点一次。' : ''));
  }

  const resolve = (res: Resolution, ok: string) => go('处理需要你的一步', resolveNeed(t.id, need!.id, res), ok);
  const choicesReady = !!need?.options?.length && need.options.every(o => typeof o.id === 'string' && !!o.id.trim() && typeof o.name === 'string' && !!o.name.trim());
  const chosen = choicesReady ? need?.options?.find((o) => o.id === choice) : undefined;

  return (
    <DetailFrame crumb={`${row.domain} · ${row.statusLabel}`} onClose={p.onClose}>
      <div className="d-title">
        <div className="d-tags"><Pri p={t.priority} /><span title={t.priority ? PRIORITY_TEXT[t.priority] : undefined}>{t.priority ? { P0: '先处理', P1: '重要', P2: '不着急' }[t.priority] : '还没排优先级'}</span>
          {t.deadline && <span>· 期限 {formatDeadline(t.deadline.at, t.deadline.allDay, now)}</span>}
          {!closed && <button type="button" className="btn-text" style={{ height: 32, padding: '0 6px', fontSize: 13 }} onClick={() => { setEditMeta(!editMeta); setDl(t.deadline ? toLocalInput(t.deadline.at) : ''); }}>{editMeta ? '完成' : '调整'}</button>}
        </div>
        <h2>{row.title}</h2>
        <span className="who">{closed ? '这件事已经处理好了' : row.status === 'paused' ? '这件事先放一放' : row.actor === '你' ? '有一步需要你帮忙' : row.status === 'preparation' ? (t.preparation?.status === 'needs_info' ? '草稿先放在这里，DOT 还要核对一点资料' : '草稿先给你看，还没有发送') : row.actor === '外部' ? '还在等对方的消息' : '接下来交给 DOT'}</span>
      </div>

      {t.briefing && (
        <section className="task-story" aria-label="事情的来龙去脉">
          <p>{t.briefing.background}</p>
          {t.briefing.latest && row.status !== 'handoff' && <p>{t.briefing.latest}</p>}
          {t.briefing.checkedAt && <span className="story-time">上次核对：{formatDateTimeShort(t.briefing.checkedAt, now)}</span>}
        </section>
      )}
      {!t.briefing && t.goal && t.goal !== t.title && <section className="task-story" aria-label="事情的来龙去脉"><p>{t.goal}</p></section>}

      {t.plan && !closed && row.status !== 'paused' && <section className="task-story" aria-label="DOT 接下来的安排">
        <p>{t.plan.nextAction}</p>
        {t.plan.dependsOn.length>0&&<><p>要先等下面这件事有结果：</p>{t.plan.dependsOn.map(id=>{const dependency=state.tasks.find(x=>x.id===id);return dependency&&<button type="button" className="dependency-link" key={id} onClick={()=>p.openTask?.(id)}>{dependency.title}<span>{dependency.state==='paused'?'先放一放':dependency.state==='completed'||dependency.dot?.status==='completed'?'已有结果':dependency.owner==='user'?'有一步需要你':'DOT 正在跟进'}</span></button>;})}<p>{t.plan.why}</p></>}
        {t.plan.nextCheckAt&&<span className="story-time">{Date.parse(t.plan.nextCheckAt)>+now?`计划再看：${formatDateTimeShort(t.plan.nextCheckAt,now)}`:'已经到计划再看的时间，等 DOT 核对后更新。'}</span>}
      </section>}

      {t.reviewFeedback && <section className="task-story" aria-label="你的修改意见"><h3>你希望这样改</h3><p style={{ whiteSpace: 'pre-wrap' }}>{t.reviewFeedback.text}</p>
        {t.owner === 'dot' && t.reviewFeedback.handoffId === t.dot?.handoffId && <span className="story-time">意见已保存，等 DOT 改好后再给你看。</span>}
      </section>}
      {t.preparation&&(!review || review.body!==t.preparation.body)&&<section className="d-sec prepared" aria-label="DOT 先准备的内容">
        <h3>DOT 先准备好了</h3><h4>{t.preparation.title}</h4><p>{t.preparation.summary}</p><div className="prepared-body">{t.preparation.body}</div>
        {t.preparation.status==='needs_info'&&<><h4>还缺这点信息</h4><ul>{t.preparation.missing.map(x=><li key={x}>{x}</li>)}</ul></>}
        <span className="story-time">这份内容供你查看{t.preparation.kind==='draft'?'，还没有发送':''}。{t.preparation.handoffId!==(t.owner==='user'?t.need?.id:t.dot?.handoffId)?'事情后来有了变化，DOT 需要据此更新。':''}</span>
      </section>}
      {state.tasks.some(x=>x.state==='open'&&x.plan?.dependsOn.includes(t.id))&&<section className="task-story"><p>这件事的结果还会用在：</p>{state.tasks.filter(x=>x.state==='open'&&x.plan?.dependsOn.includes(t.id)).map(x=><button type="button" className="dependency-link" key={x.id} onClick={()=>p.openTask?.(x.id)}>{x.title}</button>)}</section>}

      {editMeta && (
        <div className="box" style={{ background: '#fff', border: '1px solid var(--line)' }}>
          <div className="f-group">
            <span className="f-label">优先级（与期限无关）</span>
            <div className="seg" role="group" aria-label="优先级">
              {([null, 'P0', 'P1', 'P2'] as (Priority | null)[]).map((x) => (
                <button key={x ?? 'none'} type="button" aria-pressed={t.priority === x} disabled={p.saving}
                  onClick={() => go('调整优先级', setPriority(t.id, x), `优先级已改为 ${x ?? '未定'}`)}>{x ?? '未定'}</button>
              ))}
            </div>
          </div>
          <div className="f-group">
            <span className="f-label">期限（与优先级无关）</span>
            <div className="meta-line">
              <input className="f-input" style={{ width: 'auto', flex: 1 }} type="datetime-local" value={dl} onChange={(e) => setDl(e.target.value)} aria-label="期限" />
              <button type="button" className="btn-dark sm" disabled={!dl || p.saving}
                onClick={() => { const at = new Date(dl).toISOString(); go('调整期限', setDeadline(t.id, { at }, formatDeadline(at, false, now)), '期限已更新'); }}>保存</button>
              {t.deadline && <button type="button" className="btn-soft" disabled={p.saving} onClick={() => go('清除期限', setDeadline(t.id, null, ''), '已清除期限')}>清除</button>}
            </div>
          </div>
        </div>
      )}

      {need && (
        <div className="box">
          <div className="box-head"><span className="k">{need.kind === 'choose' || need.kind === 'clarify' ? '需要你回答一下' : NEED_META[need.kind].label}</span>
            <span className={row.dueHot ? 'tone-danger' : ''} style={{ fontWeight: 600 }}>{t.deadline ? `期限 ${row.dueLabel}` : ''}</span></div>
          <span className="box-text">{need.next}</span>
          {!t.briefing && need.why !== need.next && <span className="box-note">{need.why}</span>}
          {need.kind === 'review' && <button type="button" className="btn-dark" onClick={p.openReview}>审核草稿</button>}
          {need.kind === 'choose' && choicesReady && (
            <>
              <div className="opts" role="radiogroup" aria-label="方案">
                {(need.options ?? []).map((o) => (
                  <button key={o.id} type="button" role="radio" className="opt" aria-checked={choice === o.id} onClick={() => setChoice(o.id)}>
                    <span className="radio" aria-hidden />
                    <span className="opt-col"><span className="nm">{o.name}</span>{o.detail && <span className="dt">{o.detail}</span>}{o.note && <span className="nt">{o.note}</span>}</span>
                    <span className="pr">{o.price}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn-dark" disabled={!chosen || p.saving}
                onClick={() => chosen && resolve({ kind: 'choose', optionId: chosen.id }, `已选${chosen.name.split(' · ')[0]} · 交回 DOT，等待接收`)}>
                {chosen ? '提交回答' : '选好后提交'}
              </button>
            </>
          )}
          {need.kind === 'choose' && !choicesReady && <span className="box-note" role="status">选项还没整理好，等 DOT 补充后再选。</span>}
          {need.kind === 'clarify' && (
            <>
              {need.question && <span className="box-text" style={{ fontWeight: 600 }}>{need.question}</span>}
              <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="直接写你的回答" aria-label="回答" />
              <button type="button" className="btn-dark" disabled={!note.trim() || p.saving} onClick={() => resolve({ kind: 'clarify', answer: note }, '已补充 · 交回 DOT，等待接收')}>提交回答</button>
            </>
          )}
          {(need.kind === 'material' || need.kind === 'login' || need.kind === 'inperson') && (
            <>
              {need.url && <a className="btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', textDecoration: 'none', color: 'var(--ink)' }} href={need.url} target="_blank" rel="noopener noreferrer">在你的浏览器打开<ExternalLink size={14} aria-hidden /></a>}
              <input className="f-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（可选）" aria-label="补充说明" />
              <button type="button" className="btn-dark" disabled={p.saving}
                onClick={() => resolve({ kind: need.kind as 'material' | 'login' | 'inperson', note }, '已记录 · 交回 DOT，等待接收')}>
                {{ material: '我已补充资料', login: '我已恢复登录', inperson: '我已本人办理' }[need.kind as 'material' | 'login' | 'inperson']}
              </button>
            </>
          )}
          {need.kind === 'verify' && (
            <>
              <span className="box-note">你可以展开下面的相关消息，核对后再确认。</span>
              <button type="button" className="btn-dark" onClick={p.askDone}>确认已完成</button>
            </>
          )}
          {err && <div className="inline-err" role="alert">{err}</div>}
        </div>
      )}

      {!need && (row.status === 'handoff' || row.status === 'accepted' || row.status === 'running' || row.status === 'waiting' || row.status === 'preparation' || row.status === 'blocked') && (
        <div className="box" style={{ gap: 8 }}>
          <div className="box-head"><span className="k dot">{row.status === 'blocked' ? '这一步还没能继续' : `DOT 负责 · ${row.statusLabel}`}</span>{row.status !== 'blocked' && <span className={`tone-${row.check.tone}`} style={{ fontWeight: 600, textAlign: 'right' }}>{row.check.label}</span>}</div>
          {row.status === 'blocked' ? (
            <section aria-label="卡住的原因" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {t.dot?.status === 'completed' ? <>
                <span className="box-text">DOT 说已处理好，但还没有留下能核对结果的证据。</span>
                <span className="box-note">接下来：DOT 需要补充实际结果，核对后再请你确认完成。</span>
              </> : t.dot?.blocker ? <>
                <span className="box-text" style={{ fontWeight: 600 }}>{t.dot.blocker.step}</span>
                <span className="box-text">{t.dot.blocker.reason}</span>
                <span className="box-note">{t.dot.blocker.basis === 'current_check' ? '这次检查' : t.dot.blocker.basis === 'last_record' ? '按上次记录，尚未重新核对' : '还没核对当前情况'}{t.dot.blocker.observedAt ? ` · ${formatDateTimeShort(t.dot.blocker.observedAt, now)}` : ''}</span>
                <span className="box-text">接下来：{t.dot.blocker.next}</span>
              </> : <>
                <span className="box-text">{t.dot?.waitingOn || 'DOT 还没有写清楚具体卡在哪里。'}</span>
                {t.dot?.summary && t.dot.summary !== t.dot.waitingOn && <span className="box-note">{t.dot.summary}</span>}
                <span className="box-note">这条记录还缺具体步骤和检查结果，不能据此判断是登录失效，还是对方没回复。</span>
                <span className="box-text">接下来：DOT 需要核对原因，说明哪一步无法继续，以及需要谁帮忙。</span>
              </>}
            </section>
          ) : <span className="box-text">{t.dot?.summary}</span>}
          {row.status === 'handoff' && <span className="box-note">已经交回 DOT，等它接手。</span>}
          {t.dot?.waitingOn && (row.status === 'waiting' || row.status === 'preparation') && <span className="box-note">{row.status === 'preparation' ? '接下来：' : '等待：'}{t.dot.waitingOn}</span>}
          {t.dot?.promise && row.status === 'running' && <span style={{ fontSize: 13, color: 'var(--amber)' }}>DOT 承诺：{t.dot.promise}</span>}

          {err && <div className="inline-err" role="alert">{err}</div>}
        </div>
      )}

      {row.status === 'done' && (
        <div className="box done">
          <div className="done-mark" aria-hidden>✓</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-ink)' }}>你已确认完成 · {t.completion ? formatDateTimeShort(t.completion.at, now) : ''}</span>
            <span style={{ fontSize: 13, color: 'var(--green-ink2)' }}>事项已关闭，DOT 不再提醒、检查或推进。</span>
          </div>
        </div>
      )}
      {row.status === 'paused' && (
        <div className="box">
          <span className="box-text" style={{ lineHeight: 1.55 }}>
            你于 {t.pause ? formatDateTimeShort(t.pause.at, now) : ''} 暂停{t.pause?.note ? ` · ${t.pause.note}` : ''}。DOT 现在不推进、不检查。
          </span>
          <button type="button" className="btn-dark sm" disabled={p.saving} onClick={() => go('恢复推进', resumeTask(t.id), '已恢复 · 等待 DOT 接收')}>恢复推进</button>
          {err && <div className="inline-err" role="alert">{err}</div>}
        </div>
      )}

      {t.steps.length > 0 && (
        <div className="d-sec">
          <h3>接下来怎么做</h3>
          {t.steps.map((st, i) => {
            const current = !st.done && t.steps.findIndex((x) => !x.done) === i;
            return (
              <div key={st.id} className="step" data-done={st.done ? 1 : 0} data-current={current ? 1 : 0}>
                <div className="m" aria-hidden>{st.done ? '✓' : i + 1}</div>
                <span className="t">{st.text}{st.done ? <span className="sr">（已完成）</span> : current ? <span className="sr">（当前）</span> : null}</span>
              </div>
            );
          })}
        </div>
      )}

      {review && (
        <div className="d-sec">
          <h3>草稿</h3>
          <button type="button" className="draft-row" onClick={p.openReview}>
            <span style={{ minWidth: 0 }}><span className="s">{review.subject}</span><span className="to">致 {review.to} · 第 {review.version} 版</span></span>
            <span className="flag" data-tone={rphase === 'approved' || rphase === 'executed' ? 'good' : 'warn'}>
              {t.owner === 'dot' && t.reviewFeedback?.handoffId === t.dot?.handoffId ? '交给 DOT 修改中' : rphase === 'executed' ? 'DOT 已回执执行' : rphase === 'approved' ? '已批准 · 等待 DOT 接收' : rphase === 'invalidated' ? '批准已失效' : '待你审核'}
            </span>
          </button>
        </div>
      )}

      {monitor && <div className="d-sec">
        <div className="d-sec-head"><h3>DOT 会帮你留意</h3>
          {canWatch && mphase !== 'stopping' && <button type="button" className="btn-text" onClick={p.openWatch}>调整</button>}</div>
        <div className="watch-status" data-active={mphase === 'active' ? 1 : 0} data-failed={mphase === 'failed' ? 1 : 0}>
          {mphase === 'active' && `${monitor.planSummary || 'DOT 已确认跟进安排'}${monitor.nextRunAt ? `。下次 ${formatDateTimeShort(monitor.nextRunAt, now)}` : ''}`}
          {mphase === 'pending' && '已经交给 DOT，等它确认跟进安排。'}
          {mphase === 'stopping' && '你已要求停止，等 DOT 确认。'}
          {mphase === 'failed' && '这次没有安排成功，可以调整后再试。'}
        </div>
        {row.status === 'paused' && <span className="box-note">这件事已暂停，DOT 不会继续跟进。</span>}
        <details className="records"><summary>查看跟进要求</summary>
          <div className="followup-instruction"><span>你写的话</span><p>{monitor.what}</p></div>
          {[['去哪里看', monitorSetting(monitor,'sources',monitor.sources.join('、'))], ['多久看一次', monitorSetting(monitor,'freq',monitor.freq || '')], ['具体时间', monitorSetting(monitor,'time',monitor.time)], ['时区', monitorSetting(monitor,'tz',monitor.tz)], ['跟进到', monitorSetting(monitor,'until',monitor.until)], ['什么时候告诉你', monitorSetting(monitor,'notify',monitor.notify.join('、'))]].map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>)}
          <p className="box-note">没交代的设置会保持未指定。DOT 的建议会单独标明；确认安排好后，再显示实际跟进时间。</p>
        </details>
      </div>}

      {(t.authorizations?.length ?? 0) > 0 && (
        <div className="d-sec"><h3>你已经交代过的</h3>
          {t.authorizations!.map((a) => <span key={a.id} style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.55 }}>{a.scope}</span>)}
        </div>
      )}

      <details className="records">
        <summary><span>查看相关消息与处理记录</span><ChevronRight size={16} className="chev" aria-hidden /></summary>
        {rec.contexts.length > 0 && <div className="rec-group"><h4>相关消息</h4>
          {rec.contexts.map((c) => <div key={c.id} className="source-note">
            <p>{c.summary || (/(Sentinel_|assistant_report|[a-f0-9]{18,})/.test(c.label) ? `之前的${CTX_LABEL[c.kind] ?? '相关记录'}` : c.label)}</p>
            <span className="source-meta">{CTX_LABEL[c.kind] ?? '相关记录'}{c.at ? ` · ${formatLogTime(c.at, now)}` : ''}
              {c.url && <> · <a href={c.url} target="_blank" rel="noopener noreferrer">{c.kind === 'email' ? '打开邮件' : '查看原文'}</a></>}
            </span>
          </div>)}
        </div>}
        {t.goal && <div className="rec-group"><h4>你想做到什么</h4><div className="rec">{t.goal}</div></div>}
        {rec.requirements.length > 0 && <div className="rec-group"><h4>需要记住的事</h4>
          {rec.requirements.map((r) => <div key={r.id} className="rec">{r.text}</div>)}
        </div>}
        {rec.decisions.length > 0 && <div className="rec-group"><h4>之前说定的事</h4>
          {rec.decisions.map((d) => <div key={d.id} className="rec">{d.text}<span className="meta">{d.by === 'user' ? '你' : 'DOT'} · {formatLogTime(d.at, now)}</span></div>)}
        </div>}
        {log.length > 0 && <div className="rec-group"><h4>之前的进展</h4>
          {log.map((l, i) => <div key={i} className="log"><span className="tm">{formatLogTime(l.at, now)}</span><span className="tx">{l.by === 'dot' ? 'DOT' : '你'}：{l.text}</span></div>)}
        </div>}
        <details className="records technical">
          <summary><span>原始记录（排查时用）</span><ChevronRight size={16} className="chev" aria-hidden /></summary>
          {need?.detail && <div className="rec-group"><h4>补充记录</h4><div className="rec">{need.detail}</div></div>}
          {t.dot?.receipt && <div className="rec-group"><h4>处理回执</h4><div className="rec">{t.dot.receipt}</div></div>}
          {rec.contexts.map((c) => <div key={c.id} className="rec">{c.label}</div>)}
          {(t.evidence ?? []).map((e) => <div key={e.id} className="rec">{e.text}<span className="meta">{e.receipt ? `回执 ${e.receipt} · ` : ''}{formatLogTime(e.at, now)}</span></div>)}
          {review?.priorApprovals?.map((a) => <div key={a.id} className="rec">第 {a.version} 版 · {a.invalidReason ?? '已失效'}<span className="meta">{formatLogTime(a.at, now)}</span></div>)}
          <div className="rec">编号 {t.id}<span className="meta">修订 {rec.revisions} 次 · 更新于 {formatLogTime(t.updatedAt, now)}</span></div>
        </details>
      </details>

      {t.state === 'open' && (
        <div className="d-foot">
          {!need && <button type="button" className="btn-outline" onClick={p.askDone}>这件事已完成</button>}
          {!monitor && <button type="button" className="btn-text" onClick={p.openWatch}>让 DOT 定期跟进</button>}
          <button type="button" className="btn-soft" disabled={p.saving} onClick={() => go('暂停', pauseTask(t.id), '已暂停')}>暂停</button>
        </div>
      )}
      {err && !need && row.status !== 'paused' && !(row.status === 'handoff' || row.status === 'accepted' || row.status === 'running' || row.status === 'waiting' || row.status === 'preparation' || row.status === 'blocked') && <div className="inline-err" role="alert">{err}</div>}
    </DetailFrame>
  );
}
