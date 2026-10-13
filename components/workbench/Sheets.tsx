'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { MonitorField, MonitorFreq, Review, Task, WorkbenchState } from './types';
import { currentMonitor, hasReceipt, reviewPhase } from './model';
import {
  addCommand, approveReview, confirmComplete, editReview, requestReviewChanges, requestMonitor, stopMonitor, type MonitorConfig, type Mutation,
} from './mutations';
import { formatLogTime, newId, previewGoals } from './util';
import type { RunResult } from './useWorkbench';

type Run = (label: string, m: Mutation, opts?: { inline?: boolean }) => Promise<RunResult>;

export function Sheet({ title, sub, onClose, children, foot, labelId }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode; labelId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('textarea, input, button:not(.p-close)');
    el?.focus();
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={ref} className="panel" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(e) => e.stopPropagation()}>
        <div className="p-head">
          <div style={{ minWidth: 0 }}><h2 id={labelId}>{title}</h2>{sub && <span className="sub">{sub}</span>}</div>
          <button type="button" className="p-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>
        <div className="p-body">{children}</div>
        {foot}
      </div>
    </div>
  );
}

/* ───────────── 交给 DOT ───────────── */

const EXAMPLES = [
  '帮我约下周三和小周吃饭，另外车险续保比一下价，月底前定',
  '把妈妈的体检报告整理一下；顺便问问诊所周六能不能复查',
];

export function ComposeSheet({ run, onClose, onDone, offline }: { run: Run; onClose: () => void; onDone: (n: number) => void; offline: boolean }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'edit' | 'sending' | 'failed'>('edit');
  const [err, setErr] = useState('');
  const [conflicted, setConflicted] = useState(false);
  // One id per compose session: an explicit retry after a failure/409 can never create a duplicate.
  const idRef = useRef(newId());
  const goals = previewGoals(text);

  async function submit() {
    if (!text.trim() || phase === 'sending') return;
    setPhase('sending');
    const r = await run('交给 DOT', addCommand(text, idRef.current), { inline: true });
    if (r.ok) { onDone(goals.length || 1); return; }
    setPhase('failed');
    setConflicted(r.reason === 'conflict');
    setErr(r.message);
  }

  return (
    <Sheet title="交给 DOT" labelId="sh-compose" onClose={onClose}
      foot={<div className="p-foot"><button type="button" className="btn-submit" disabled={!text.trim() || phase === 'sending'} onClick={submit}>
        {phase === 'sending' ? '正在保存…' : phase === 'failed' ? '重新提交' : '交给 DOT'}</button></div>}>
      <p className="p-hint">像跟助理说话一样交代，一句里可以有几件事。不用先选领域、优先级或项目。</p>
      <textarea className="compose-ta" value={text} onChange={(e) => { setText(e.target.value); if (phase === 'failed') setPhase('edit'); }}
        placeholder="例如：帮我约下周三和小周吃饭，另外车险续保比一下价，月底前定" aria-label="要交给 DOT 的事"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} />
      {!text && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {EXAMPLES.map((x) => <button key={x} type="button" className="example" onClick={() => setText(x)}>“{x}”</button>)}
        </div>
      )}
      {goals.length > 0 && (
        <div className="goals">
          <span className="h">交代内容 <small>· DOT 接手后会整理好</small></span>
          {goals.map((g, i) => <div key={i} className="goal"><span className="n">{i + 1}</span><span>{g}</span></div>)}
        </div>
      )}
      <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
        提交后显示「等待 DOT 接收」。DOT 接手后会更新这里的进展，有需要你帮忙的地方再来问你。
      </span>
      {offline && <div className="inline-warn">现在连不上服务器，提交不会保存。</div>}
      {phase === 'failed' && <div className="inline-err" role="alert"><b>{conflicted ? '还没保存' : '提交失败'}</b> · {err}{conflicted ? ' 确认后点「重新提交」，会追加到最新状态里。' : ' 内容仍保留在上面，没有交出任何事项。'}</div>}
    </Sheet>
  );
}

/* ───────────── 审核草稿 ───────────── */

export function ReviewSheet({ task, review, run, onClose, toast, now }: {
  task: Task; review: Review; run: Run; onClose: () => void; toast: (t: string) => void; now: Date;
}) {
  const phase = reviewPhase(review);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.body);
  const [baseVersion, setBaseVersion] = useState(review.version);
  const [baseReviewId, setBaseReviewId] = useState(review.id);
  const [feedback, setFeedback] = useState('');
  const [feedbackBase, setFeedbackBase] = useState({ id: review.id, version: review.version, contentHash: review.contentHash });
  const feedbackId = useRef(newId());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const feedbackWaiting = task.owner === 'dot' && task.reviewFeedback?.handoffId === task.dot?.handoffId;
  const current = (!task.activeReviewId || task.activeReviewId === review.id) && (!task.need?.reviewId || task.need.reviewId === review.id);
  const canEdit = current && !feedbackWaiting && phase !== 'executed' && task.state === 'open';
  const canApprove = current && phase !== 'approved' && phase !== 'executed' && task.state === 'open' && task.owner === 'user' && task.need?.kind === 'review';
  const canFeedback = canApprove || (canEdit && phase === 'approved' && ((task.dot?.status === 'queued' && !task.dot.receipt) || task.dot?.status === 'blocked'));
  const feedbackMoved = review.id !== feedbackBase.id || review.version !== feedbackBase.version || review.contentHash !== feedbackBase.contentHash;
  const versionMoved = editing && (review.version !== baseVersion || review.id !== baseReviewId);

  async function approve() {
    setBusy(true); setErr('');
    const r = await run('批准草稿', approveReview(task.id, review.id, { version: review.version, contentHash: review.contentHash }), { inline: true });
    setBusy(false);
    if (r.ok) { toast('已批准 · 等待 DOT 接收，尚未发送'); onClose(); } else setErr(r.message);
  }
  async function save() {
    setBusy(true); setErr('');
    const r = await run('保存草稿修改', editReview(task.id, baseReviewId, baseVersion, { body: text }), { inline: true });
    setBusy(false);
    if (r.ok) {
      setEditing(false);
      if (r.changed && phase === 'approved') toast('批准已失效 · 回到需要你');
      else if (r.changed) toast('已保存修改 · 仍需你批准');
    } else setErr(r.message);
  }

  async function sendFeedback() {
    setBusy(true); setErr('');
    const r = await run('请 DOT 修改草稿', requestReviewChanges(task.id, feedbackBase.id, feedbackBase, feedback, feedbackId.current), { inline: true });
    setBusy(false);
    if (r.ok) { toast('意见已保存，等 DOT 改好后再给你看'); onClose(); }
    else setErr(r.message);
  }

  const banner = feedbackWaiting ? { tone: '', t: '修改意见已保存，等 DOT 改好后再给你看。尚未批准或发送。' } : phase === 'executed'
    ? { tone: 'good', t: `DOT 已处理这份草稿${review.executedAt ? ' · ' + formatLogTime(review.executedAt, now) : ''}` }
    : phase === 'approved' ? { tone: 'good', t: '已批准，等待 DOT 接收并执行。尚未发送；发送后会写入运行记录。' }
      : phase === 'invalidated' ? { tone: 'warn', t: '内容已修改，之前的批准已失效。请确认后重新批准。' }
        : { tone: '', t: '批准前不会发出任何内容。批准只针对下方这一版的准确内容。' };

  return (
    <Sheet title="审核草稿" labelId="sh-review" onClose={onClose}
      foot={
        <div className="p-foot">
          {editing ? (
            <>
              <button type="button" className="btn-soft" onClick={() => { setEditing(false); setErr(''); }}>取消</button>
              <button type="button" className="btn-dark" disabled={busy} onClick={save}>{busy ? '正在保存…' : '保存修改'}</button>
            </>
          ) : (
            <>
              {canEdit && <button type="button" className="btn-soft" disabled={busy} onClick={() => { setText(review.body); setBaseVersion(review.version); setBaseReviewId(review.id); setEditing(true); setErr(''); }}>自己改内容</button>}
              {canApprove && <button type="button" className="btn-dark" disabled={busy || !!feedback.trim()} onClick={approve}>{busy ? '正在保存…' : '批准'}</button>}
              {!canEdit && !canApprove && <button type="button" className="btn-soft" onClick={onClose}>关闭</button>}
            </>
          )}
        </div>
      }>
      <div className="rv-banner" data-tone={banner.tone}>{banner.t}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="rv-label">这份草稿发给谁</span>
        {[['渠道', review.channel], ['发给', review.to], ['抄送', review.cc], ['主题', review.subject]].filter(([,value])=>!!value.trim()).map(([k, v]) => (
          <div key={k} className="rv-row"><span className="k">{k}</span><span className="v">{v}</span></div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="rv-label">要发的内容 · 第 {review.version} 版</span>
        {editing ? (
          <>
            <textarea className="rv-edit" value={text} onChange={(e) => setText(e.target.value)} aria-label="草稿内容" />
            <span style={{ fontSize: 12, color: 'var(--amber)' }}>
              {phase === 'approved' ? '保存后，之前的批准会失效，需要重新批准。' : '保存后仍需你批准，DOT 才会执行。'}
            </span>
            {versionMoved && <div className="inline-warn">草稿在你编辑期间已更新到第 {review.version} 版。你的修改仍在编辑框里；保存会被拒绝，请先对照最新内容。
              <button type="button" className="btn-text" style={{ height: 32 }} onClick={() => { setBaseVersion(review.version); setBaseReviewId(review.id); }}>我已对照，基于第 {review.version} 版保存</button></div>}
          </>
        ) : (
          <div className="rv-body">{review.body}</div>
        )}
        <details className="records"><summary>查看版本记录</summary><span className="rec">内容指纹 {review.contentHash}{review.approval ? ` · 批准对应第 ${review.approval.version} 版` : ''}{review.executionReceipt ? ` · 回执 ${review.executionReceipt}` : ''}</span></details>
      </div>
      {!editing && canFeedback && <section className="review-feedback" aria-label="给 DOT 修改意见">
        <label htmlFor="review-feedback-text" className="rv-label">想让 DOT 怎么改？</label>
        <p className="p-hint" id="review-feedback-hint">直接说你的意见就好。DOT 改好后会再给你看。</p>
        <textarea id="review-feedback-text" className="field" rows={3} maxLength={6000} aria-describedby="review-feedback-hint" value={feedback}
          placeholder="例如：不用讲这么细，把第一段缩短一点，语气自然些。" onChange={e => setFeedback(e.target.value)} />
        {feedbackMoved && <div className="inline-warn">草稿刚更新，你的意见还在。请先看一下新版。
          <button type="button" className="btn-text" onClick={() => setFeedbackBase({ id: review.id, version: review.version, contentHash: review.contentHash })}>我已看过新版，继续提这些意见</button></div>}
        <button type="button" className="btn-dark" disabled={busy || !feedback.trim() || feedbackMoved} onClick={sendFeedback}>{busy ? '正在保存…' : '让 DOT 改一下'}</button>
        {!!feedback.trim() && <span className="box-note">先把意见交给 DOT，等改好后再批准。</span>}
      </section>}
      {task.reviewFeedback && <section className="task-story" aria-label="你上次的修改意见"><span className="rv-label">你上次的修改意见</span><p style={{ whiteSpace: 'pre-wrap' }}>{task.reviewFeedback.text}</p></section>}
      {err && <div className="inline-err" role="alert">{err}</div>}
    </Sheet>
  );
}

/* ───────────── 持续关注 ───────────── */

const SOURCES = ['WhatsApp', '邮箱', '网站', '短信', '日历', '文件夹'];
const NOTIFY = ['有新回复', '状态变化', '临近截止 24 小时', '超过截止仍无回复'];
const TZ = ['上海 UTC+8', '东京 UTC+9', '伦敦 UTC+1', '洛杉矶 UTC−7'];

export function WatchSheet({ task, state, run, onClose, toast }: { task: Task; state: WorkbenchState; run: Run; onClose: () => void; toast: (t: string) => void }) {
  const cur = currentMonitor(state, task.id);
  const [cfg, setCfg] = useState<MonitorConfig>(() => {
    const trusted = (k: MonitorField) => cur?.fieldOrigins?.[k]?.kind === 'user_selected' || cur?.fieldOrigins?.[k]?.kind === 'user_instruction';
    return {what:cur?.what ?? '',sources:trusted('sources') ? cur!.sources : [],freq:trusted('freq') ? cur!.freq : null,
      time:trusted('time') ? cur!.time : '',tz:trusted('tz') ? cur!.tz : '',until:trusted('until') ? cur!.until : '',notify:trusted('notify') ? cur!.notify : [],
      fieldOrigins: Object.fromEntries(Object.entries(cur?.fieldOrigins ?? {}).filter(([,v])=>v?.kind !== 'dot_suggestion'))};
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = (k: MonitorField, v: string | string[] | null) => setCfg(c=>({...c,[k]:v,fieldOrigins:{...c.fieldOrigins,[k]:{kind:'user_selected'}}}));
  const tog = (k: 'sources' | 'notify', v: string) => edit(k, cfg[k].includes(v) ? cfg[k].filter(x=>x!==v) : [...cfg[k],v]);

  async function save() {
    setBusy(true); setErr('');
    const r = await run('提交检查安排', requestMonitor(task.id, cfg), { inline: true });
    setBusy(false);
    if (r.ok) { toast('已交给 DOT，等它安排好'); onClose(); } else setErr(r.message);
  }
  async function stop() {
    if (!cur) return;
    setBusy(true); setErr('');
    const r = await run('停止持续关注', stopMonitor(task.id, cur.id), { inline: true });
    setBusy(false);
    if (r.ok) { toast('已交给 DOT，等它确认停止'); onClose(); } else setErr(r.message);
  }

  return (
    <Sheet title="让 DOT 定期帮你留意" sub={task.title} labelId="sh-watch" onClose={onClose}
      foot={
        <div className="p-foot">
          {cur && <button type="button" className="btn-soft" style={{ flex: 'none', color: 'var(--red)' }} disabled={busy} onClick={stop}>停止关注</button>}
          <button type="button" className="btn-dark" disabled={busy || !cfg.what.trim()} onClick={save}>{busy ? '正在保存…' : '交给 DOT 跟进'}</button>
        </div>
      }>
      <p className="p-hint">写下你希望 DOT 帮你留意什么就可以。时间、来源和提醒方式可以不填，DOT 会根据你的话确认怎么跟进。</p>
      <label className="f-group"><span className="f-label">希望 DOT 帮你留意什么？</span><input className="f-input" value={cfg.what} onChange={(e) => setCfg({ ...cfg, what: e.target.value })} placeholder="例如：HR 有没有回复牙科福利的问题" /></label>
      {cur && !cur.fieldOrigins && <p className="inline-warn">旧版曾自动填入一些设置。这里已取消默认选中，你可以按需要填写。</p>}
      <details className="records"><summary>补充来源、时间和提醒方式（可不填）</summary>
      <div className="f-group"><span className="f-label">去哪里看</span>
        <div className="chips wrap">{SOURCES.map((x) => <button key={x} type="button" className="chip" aria-pressed={cfg.sources.includes(x)} onClick={() => tog('sources', x)}><span>{x}</span></button>)}</div>
      </div>
      <div className="f-group"><span className="f-label">频率</span>
        <div className="freq">
          <div className="seg" role="group" aria-label="频率">
            <button type="button" aria-pressed={cfg.freq === null} onClick={() => edit('freq',null)}>未指定</button>
            {(['每小时', '每天', '每周'] as MonitorFreq[]).map((x) => <button key={x} type="button" aria-pressed={cfg.freq === x} onClick={() => edit('freq',x)}>{x}</button>)}
          </div>
          {cfg.freq && cfg.freq !== '每小时' && <input className="f-input" style={{ width: 'auto' }} type="time" value={cfg.time} onChange={(e) => edit('time',e.target.value)} aria-label="时间" />}
        </div>
      </div>
      <div className="f-grid">
        <label className="f-group"><span className="f-label">时区</span>
          <select className="f-input" value={cfg.tz} onChange={(e) => edit('tz',e.target.value)}><option value="">未指定</option>{TZ.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label className="f-group"><span className="f-label">截止</span>
          <input className="f-input" type="date" value={cfg.until} onChange={(e) => edit('until',e.target.value)} />
        </label>
      </div>
      <div className="f-group"><span className="f-label">何时通知我</span>
        <div className="chips wrap">{NOTIFY.map((x) => <button key={x} type="button" className="chip" aria-pressed={cfg.notify.includes(x)} onClick={() => tog('notify', x)}><span>{x}</span></button>)}</div>
      </div>
      </details>
      <p className="p-hint">只会保存你写下的话和主动选择的设置。没填的保持未指定，不会自动选成邮箱、每天 9 点或某个结束日期。</p>
      <div className="inline-warn">提交后会交给 DOT 安排。它确认安排好后，这里会显示下次检查时间。</div>
      {cur && hasReceipt(cur.scheduleReceipt) && <span style={{ fontSize: 12, color: 'var(--faint)' }}>修改后，DOT 会重新确认检查安排。</span>}
      {err && <div className="inline-err" role="alert">{err}</div>}
    </Sheet>
  );
}

/* ───────────── 确认完成 ───────────── */

export function DoneSheet({ task, run, onClose, toast }: { task: Task; run: Run; onClose: () => void; toast: (t: string) => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ev = task.evidence ?? [];
  async function confirm() {
    setBusy(true); setErr('');
    const r = await run('确认完成', confirmComplete(task.id), { inline: true });
    setBusy(false);
    if (r.ok) { toast('已关闭 · DOT 不再提醒'); onClose(); } else setErr(r.message);
  }
  return (
    <Sheet title="确认这件事已完成？" labelId="sh-done" onClose={onClose}
      foot={<div className="p-foot">
        <button type="button" className="btn-soft" onClick={onClose}>取消</button>
        <button type="button" className="btn-dark" disabled={busy} onClick={confirm}>{busy ? '正在保存…' : '确认完成'}</button>
      </div>}>
      <p className="p-hint" style={{ fontSize: 15 }}>「{task.title}」会关闭，记录为你确认完成。DOT 将停止提醒、检查和后续推进。</p>
      {task.briefing?.latest && <p className="p-hint">{task.briefing.latest}</p>}
      {ev.length ? <details className="records"><summary>查看原始记录</summary>{ev.map(e => <div key={e.id} className="rec">{e.text}</div>)}</details> : <p className="p-hint">DOT 还没有补充处理结果，请确认事情确实完成后再收起。</p>}
      {err && <div className="inline-err" role="alert">{err}</div>}
    </Sheet>
  );
}
