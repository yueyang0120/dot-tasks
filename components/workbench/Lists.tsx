'use client';
import { Search } from 'lucide-react';
import type { CommandRow, Filters, HomeLists, SortKey, TaskRow } from './model';
import { ACTOR_FILTERS, NEED_META, SORT_LABEL, STATUS_FILTERS } from './model';
import type { Priority } from './types';

type Open = (id: string) => void;

export function Pri({ p, className = '' }: { p: Priority | null; className?: string }) {
  return <span className={`pri ${className}`} data-p={p ?? ''} title={p ? undefined : 'DOT 接收后判断'}>{p ?? '—'}</span>;
}

function rowProps(id: string, selId: string | null, open: Open) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-selected': id === selId,
    onClick: () => open(id),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id); } },
  };
}

export function NeedRowView({ r, selId, open, act }: { r: TaskRow; selId: string | null; open: Open; act: (r: TaskRow) => void }) {
  const meta = NEED_META[r.need!.kind];
  const due = r.dueLabel || '';
  return (
    <div className="row r4" {...rowProps(r.id, selId, open)}>
      <div className="glyph" data-k="need" aria-hidden>{r.glyph}</div>
      <div className="row-main">
        <div className="row-title"><span className="t">{r.title}</span><Pri p={r.priority} className="only-wide" /></div>
        <span className="row-line">{r.line}</span>
        <div className="row-meta only-compact"><Pri p={r.priority} /><span className="due" data-hot={r.dueHot ? 1 : 0}>{due}</span></div>
      </div>
      <div className="row-col only-wide"><span className="due" data-hot={r.dueHot ? 1 : 0}>{due}</span><span className="muted">{meta.label}</span></div>
      <div className="row-act">
        <button type="button" className="cta" onClick={(e) => { e.stopPropagation(); act(r); }} aria-label={`${meta.cta}：${r.title}`}>
          <span>{meta.cta}</span>
        </button>
      </div>
    </div>
  );
}

export function DotRowView({ r, selId, open }: { r: TaskRow | CommandRow; selId: string | null; open: Open }) {
  const glyph = r.kind === 'task' ? r.glyph : '收';
  return (
    <div className="row r4" {...rowProps(r.id, selId, open)}>
      <div className="glyph" aria-hidden>{glyph}</div>
      <div className="row-main">
        <div className="row-title"><span className="t">{r.title}</span></div>
        <span className="row-line">{r.line}</span>
        <span className={`check tone-${r.check.tone} only-compact`}>{r.check.label}</span>
      </div>
      <div className="row-col only-wide">
        <span className={`check tone-${r.check.tone}`} style={{ marginTop: 0 }}>{r.check.label}</span>
        <span className="muted">{r.statusLabel}</span>
      </div>
      <div className="row-act">{r.flag && <span className="flag" data-tone={r.flag.tone}>{r.flag.label}</span>}</div>
    </div>
  );
}

function QuietRow({ r, selId, open, line }: { r: TaskRow; selId: string | null; open: Open; line?: string }) {
  return (
    <div className="row row-quiet" {...rowProps(r.id, selId, open)}>
      <div className="glyph" data-k="quiet" aria-hidden>{r.glyph}</div>
      <div className="row-main"><span className="t">{r.title}</span><span className="l">{line ?? r.line}</span></div>
    </div>
  );
}

export function HomeView(p: {
  lists: HomeLists; selId: string | null; open: Open; act: (r: TaskRow) => void;
  needOpen: boolean; setNeedOpen: (v: boolean) => void; quietOpen: boolean; setQuietOpen: (v: boolean) => void;
  onCompose: () => void; onClosed: () => void; isEmptyDoc: boolean; demoHref: string | null;
}) {
  const { lists, selId, open } = p;
  const shown = p.needOpen ? lists.need : lists.need.slice(0, 5);
  return (
    <>
      <section className="sec" aria-labelledby="sec-need">
        <div className="sec-head">
          <h2 id="sec-need">需要你</h2><span className="n">{lists.need.length}</span>
          {lists.need.length > 0 && <span className="hint">按期限</span>}
        </div>
        {lists.need.length === 0 && <div className="empty"><span className="t">现在没有需要你处理的事。DOT 需要你决定或补充时，会出现在这里。</span></div>}
        {shown.map((r) => <NeedRowView key={r.id} r={r} selId={selId} open={open} act={p.act} />)}
        {lists.need.length > 5 && (
          <button type="button" className="more" onClick={() => p.setNeedOpen(!p.needOpen)}>
            {p.needOpen ? '收起' : `还有 ${lists.need.length - 5} 件可以稍后处理`}
          </button>
        )}
      </section>

      <section className="sec" aria-labelledby="sec-dot">
        <div className="sec-head">
          <h2 id="sec-dot">DOT 负责</h2><span className="n">{lists.dotCount}</span>
          {lists.dotCount > 0 && <span className="hint">异常与新进展在前</span>}
        </div>
        {lists.dotCount === 0 && (
          <div className="empty">
            <span className="t">还没有交给 DOT 的事。说一句要办的事，DOT 接收后会在这里显示进展。</span>
            <button type="button" className="btn-green" onClick={p.onCompose}>交给 DOT</button>
          </div>
        )}
        {lists.dotActive.map((r) => <DotRowView key={r.id} r={r} selId={selId} open={open} />)}
        {lists.dotQuiet.length > 0 && (
          <>
            <button type="button" className="fold" aria-expanded={p.quietOpen} onClick={() => p.setQuietOpen(!p.quietOpen)}>
              <span className="t">{lists.dotQuiet.length} 件等待中，已经安排检查，暂时没有新变化</span>
              <span className="a">{p.quietOpen ? '收起' : '展开'}</span>
            </button>
            {p.quietOpen && lists.dotQuiet.map((r) => <QuietRow key={r.id} r={r} selId={selId} open={open} />)}
          </>
        )}
        {lists.closedCount > 0 && (
          <button type="button" className="closed-link" onClick={p.onClosed}>已完成与已暂停 {lists.closedCount} 件 ›</button>
        )}
        {p.isEmptyDoc && p.demoHref && <a className="demo-link" href={p.demoHref}>查看虚构演示（不保存）</a>}
      </section>
    </>
  );
}

const chipBtn = (label: string, on: boolean, onClick: () => void, key?: string) => (
  <button key={key ?? label} type="button" className="chip" aria-pressed={on} onClick={onClick}><span>{label}</span></button>
);

export function AllView(p: {
  active: TaskRow[]; closed: TaskRow[]; commands: CommandRow[]; hasFilter: boolean; total: number;
  f: Filters; setF: (f: Filters) => void; sort: SortKey; setSort: (s: SortKey) => void;
  selId: string | null; open: Open; closedOpen: boolean; setClosedOpen: (v: boolean) => void;
}) {
  const { f, setF, selId, open } = p;
  const count = p.active.length + p.commands.length;
  return (
    <>
      <div className="filters">
        <label className="search">
          <Search size={16} aria-hidden />
          <span className="sr">搜索</span>
          <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="搜索事项、来源或进展" />
        </label>
        <div className="chips" role="group" aria-label="领域">
          {['全部', '出行', '工作', '生活', '项目'].map((x) => chipBtn(x === '全部' ? '全部领域' : x, f.domain === x, () => setF({ ...f, domain: x }), x))}
        </div>
        <div className="chips wrap">
          {(['P0', 'P1', 'P2'] as const).map((x) => chipBtn(x, f.priority === x, () => setF({ ...f, priority: f.priority === x ? '全部' : x })))}
          {chipBtn('今天到期', f.today, () => setF({ ...f, today: !f.today }))}
          <select className="select" aria-label="状态" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="全部">状态：全部</option>
            {STATUS_FILTERS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="select" aria-label="轮到" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })}>
            <option value="全部">轮到：全部</option>
            {ACTOR_FILTERS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="select" aria-label="排序" value={p.sort} onChange={(e) => p.setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
      <section className="sec" aria-label="事项列表">
        <div className="list-bar">
          <span>{count} 件进行中{p.hasFilter ? `（共 ${p.total} 件）` : ''}</span>
          {p.hasFilter && <button type="button" className="btn-text" style={{ fontSize: 13 }} onClick={() => setF({ q: '', domain: '全部', priority: '全部', today: false, status: '全部', actor: '全部' })}>清除筛选</button>}
        </div>
        {count > 0 && (
          <div className="all-head only-wide" aria-hidden><span /><span>事项</span><span>状态</span><span>轮到</span><span>期限</span><span>优先</span></div>
        )}
        {p.commands.map((c) => (
          <div key={c.id} className="row rall" {...rowProps(c.id, selId, open)}>
            <div className="glyph" aria-hidden>收</div>
            <div className="row-main">
              <span className="row-title"><span className="t">{c.title}</span></span>
              <span className="row-line only-wide" style={{ fontSize: 13 }}>新指令</span>
              <span className="row-line only-compact" style={{ fontSize: 13 }}>新指令 · {c.statusLabel}</span>
            </div>
            <span className="cell only-wide">{c.statusLabel}</span>
            <span className="cell only-wide">DOT</span>
            <span className="cell only-wide">—</span>
            <span className="only-wide"><Pri p={null} /></span>
            <span className="only-compact"><Pri p={null} /></span>
          </div>
        ))}
        {p.active.map((r) => {
          const meta = [r.domain, r.statusLabel, r.status === 'need' ? r.dueLabel : (r.status === 'waiting' || r.status === 'running') ? r.check.label : r.dueLabel].filter(Boolean).join(' · ');
          return (
            <div key={r.id} className="row rall" {...rowProps(r.id, selId, open)}>
              <div className="glyph" data-k={r.status === 'need' ? 'need' : undefined} aria-hidden>{r.glyph}</div>
              <div className="row-main">
                <span className="row-title"><span className="t">{r.title}</span></span>
                <span className="row-line only-wide" style={{ fontSize: 13 }}>{r.domain}</span>
                <span className="row-line only-compact" style={{ fontSize: 13 }}>{meta}</span>
              </div>
              <span className="cell only-wide">{r.statusLabel}</span>
              <span className="cell only-wide">{r.actor}</span>
              <span className="cell only-wide"><span className="due" data-hot={r.dueHot ? 1 : 0}>{r.dueLabel || '—'}</span></span>
              <span className="only-wide"><Pri p={r.priority} /></span>
              <span className="only-compact"><Pri p={r.priority} /></span>
            </div>
          );
        })}
        {count === 0 && p.closed.length === 0 && (
          <div className="empty"><span className="t">{p.hasFilter ? '没有符合条件的事项。换个关键词，或清除筛选。' : '还没有事项。'}</span></div>
        )}
        {p.closed.length > 0 && (
          <>
            <button type="button" className="fold" aria-expanded={p.closedOpen} onClick={() => p.setClosedOpen(!p.closedOpen)}>
              <span className="t">已完成与已暂停 {p.closed.length} 件</span><span className="a">{p.closedOpen ? '收起' : '展开'}</span>
            </button>
            {p.closedOpen && p.closed.map((r) => (
              <QuietRow key={r.id} r={r} selId={selId} open={open}
                line={r.status === 'done' ? '你已确认完成' : '已暂停 · DOT 不推进、不检查'} />
            ))}
          </>
        )}
      </section>
    </>
  );
}
