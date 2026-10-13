'use client';
/**
 * DOT Tasks — responsive workbench (390 / 768 / 1440 and everything between).
 * Live mode: GET/PUT /api/state through httpAdapter. Starts empty if the server is empty.
 * Demo mode: only when `allowDemo` and the URL has ?demo=1 — fictional, in memory, labeled.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, List, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw } from 'lucide-react';
import { demoAdapter, httpAdapter, type StateAdapter } from './adapter';
import { demoSeed } from './demo-seed';
import { allLists, commandRow, currentReview, homeLists, lastDotReceiptAt, NO_FILTERS, openCommands, taskRow, type Filters, type SortKey, type TaskRow } from './model';
import { useWorkbench } from './useWorkbench';
import { AllView, HomeView } from './Lists';
import { CommandDetail, TaskDetail } from './Detail';
import { ComposeSheet, DoneSheet, ReviewSheet, WatchSheet } from './Sheets';
import { CollaborationSheet } from './CollaborationSheet';
import { IntelligencePanel } from './IntelligencePanel';
import { formatClock, formatLogTime, formatToday } from './util';

type Tab = 'home' | 'all';
type SheetState = null | { type: 'compose' } | { type: 'collaboration' } | { type: 'review' | 'watch' | 'done'; taskId: string };

export interface WorkbenchProps {
  /** Allow ?demo=1 to load fictional in-memory data. Keep false in production unless wanted. */
  allowDemo?: boolean;
  endpoint?: string;
}

function readUrl() {
  const u = new URL(window.location.href);
  return { item: u.searchParams.get('item'), tab: (u.searchParams.get('view') === 'all' ? 'all' : 'home') as Tab, demo: u.searchParams.get('demo') === '1' };
}
function writeUrl(patch: { item?: string | null; tab?: Tab }, push: boolean) {
  const u = new URL(window.location.href);
  if ('item' in patch) { if (patch.item) u.searchParams.set('item', patch.item); else u.searchParams.delete('item'); }
  if (patch.tab) { if (patch.tab === 'all') u.searchParams.set('view', 'all'); else u.searchParams.delete('view'); }
  const href = u.pathname + u.search + u.hash;
  if (push) window.history.pushState({ wb: 1 }, '', href); else window.history.replaceState(window.history.state, '', href);
}

export default function Workbench({ allowDemo = false, endpoint = '/api/state' }: WorkbenchProps) {
  const [adapter, setAdapter] = useState<StateAdapter | null>(null);
  const [demoHref, setDemoHref] = useState<string | null>(null);
  const store = useWorkbench(adapter);
  const [tab, setTab] = useState<Tab>('home');
  const [selId, setSelId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [needOpen, setNeedOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>('priority');
  const [toastText, setToastText] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [showDate, setShowDate] = useState(false);
  const pushedRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setNow(new Date()); setShowDate(true);
    const u = readUrl();
    const demo = allowDemo && u.demo;
    setAdapter(demo ? demoAdapter(() => demoSeed(new Date())) : httpAdapter(endpoint));
    if (allowDemo && !demo) { const x = new URL(window.location.href); x.searchParams.set('demo', '1'); x.searchParams.delete('item'); setDemoHref(x.pathname + x.search); }
    setTab(u.tab); setSelId(u.item);
    const onPop = () => { const v = readUrl(); setSelId(v.item); setTab(v.tab); pushedRef.current = false; };
    window.addEventListener('popstate', onPop);
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { window.removeEventListener('popstate', onPop); window.clearInterval(clock); };
  }, [allowDemo, endpoint]);

  const toast = useCallback((t: string) => {
    window.clearTimeout(toastTimer.current);
    setToastText(t);
    toastTimer.current = window.setTimeout(() => setToastText(''), 2800);
  }, []);

  const state = store.env?.state ?? null;
  const ctx = state?.contexts ?? [];
  const home = useMemo(() => (state ? homeLists(state, now) : null), [state, now]);
  const all = useMemo(() => (state ? allLists(state, now, filters, sort) : null), [state, now, filters, sort]);

  const selTask = state && selId ? state.tasks.find((t) => t.id === selId) : undefined;
  const selCmd = state && selId && !selTask ? openCommands(state).find((c) => c.id === selId) : undefined;
  const selRow: TaskRow | null = state && selTask ? taskRow(state, selTask, now, ctx) : null;
  const detailOpen = !!(selRow || selCmd);

  const open = useCallback((id: string) => {
    if (!pushedRef.current && !readUrl().item) { writeUrl({ item: id }, true); pushedRef.current = true; } else writeUrl({ item: id }, false);
    setSelId(id);
  }, []);
  const close = useCallback(() => {
    setSelId(null);
    if (pushedRef.current) { pushedRef.current = false; window.history.back(); } else writeUrl({ item: null }, false);
  }, []);
  const goTab = (t: Tab) => {
    setTab(t);
    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    if (isMobile && selId) { setSelId(null); pushedRef.current = false; writeUrl({ item: null, tab: t }, false); } else writeUrl({ tab: t }, false);
  };

  // Escape: sheet first, then detail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheet) setSheet(null); else if (detailOpen) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, detailOpen, close]);

  const act = (r: TaskRow) => {
    if (r.need?.kind === 'review' && state && currentReview(state, r.task)) { open(r.id); setSheet({ type: 'review', taskId: r.id }); }
    else open(r.id);
  };

  const isDemo = adapter?.mode === 'demo';
  const offline = !!store.syncError && store.syncError.includes('连不上');
  const stale = store.lastSyncAt !== null && now.getTime() - store.lastSyncAt > 5 * 60_000;
  const lastReceipt = state ? lastDotReceiptAt(state) : null;
  const pill = isDemo
    ? { tone: 'demo', t: '虚构演示数据 · 不保存 · DOT 未连接' }
    : lastReceipt ? { tone: 'good', t: `DOT 最近更新 ${formatLogTime(lastReceipt, now)}` } : { tone: '', t: '还没有 DOT 的更新' };
  const needCount = home?.need.length ?? 0;
  const isEmptyDoc = !!state && state.tasks.length === 0 && state.commands.length === 0;

  const sheetTask = sheet && sheet.type !== 'compose' && sheet.type !== 'collaboration' && state ? state.tasks.find((t) => t.id === sheet.taskId) : undefined;
  const sheetReview = sheet?.type === 'review' && state && sheetTask ? currentReview(state, sheetTask) : undefined;

  const navItems = [
    { k: 'home' as Tab, label: '待办总览', short: '总览', count: needCount ? String(needCount) : '', Icon: LayoutGrid },
    { k: 'all' as Tab, label: '全部事项', short: '全部', count: all ? String(all.total) : '', Icon: List },
  ];

  return (
    <div className="wb" data-detail={detailOpen ? 1 : 0} data-collapsed={collapsed ? 1 : 0}>
      <nav className="wb-rail" aria-label="主导航">
        <div className="rail-full">
          <div className="rail-logo"><span className="logo-dot" aria-hidden /><span className="logo-text">DOT Tasks</span></div>
          <button type="button" className="btn-compose" onClick={() => setSheet({ type: 'compose' })}><Plus size={20} aria-hidden />交给 DOT</button>
          <div className="rail-nav">
            {navItems.map(({ k, label, count, Icon }) => (
              <button key={k} type="button" className="rail-item" aria-current={tab === k ? 'page' : undefined} onClick={() => goTab(k)}>
                <Icon size={18} aria-hidden /><span className="lbl">{label}</span><span className="cnt">{count}</span>
              </button>
            ))}
          </div>
          <button type="button" className="rail-toggle" onClick={() => setCollapsed(true)}><PanelLeftClose size={16} aria-hidden />收起导航</button>
        </div>
        <div className="rail-mini">
          <div className="rail-logo"><span className="logo-dot" aria-hidden /></div>
          <button type="button" className="btn-compose-round" onClick={() => setSheet({ type: 'compose' })} aria-label="交给 DOT" title="交给 DOT"><Plus size={24} aria-hidden /></button>
          <div className="rail-nav">
            {navItems.map(({ k, short, Icon }) => (
              <button key={k} type="button" className="rail-item" aria-current={tab === k ? 'page' : undefined} onClick={() => goTab(k)}>
                <Icon size={18} aria-hidden /><span>{short}</span>
              </button>
            ))}
          </div>
          {collapsed && <button type="button" className="rail-toggle" onClick={() => setCollapsed(false)} aria-label="展开导航" title="展开导航"><PanelLeftOpen size={18} aria-hidden /></button>}
        </div>
      </nav>

      <div className="wb-main">
        <main className="wb-scroll">
          <div className="wb-content">
            <header className="wb-head">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h1>{tab === 'home' ? 'DOT Tasks' : '全部事项'}</h1>
                <span className="date">{showDate ? formatToday(now) : ''}</span>
              </div>
              <div className="wb-head-right">
                <button className="btn-text" type="button" onClick={()=>setSheet({type:'collaboration'})}>协作偏好</button>
                <span className="status-pill" data-tone={pill.tone}>{pill.t}</span>
                {!isDemo && store.phase !== 'loading' && (
                  <button type="button" className="icon-btn" data-spin={store.saving ? 1 : 0} onClick={() => void store.refresh()}
                    aria-label="读取最新状态（不会唤醒 DOT）" title={`读取最新状态，不会唤醒 DOT${store.lastSyncAt ? ` · 上次同步 ${formatClock(store.lastSyncAt)}` : ''}`}>
                    <RefreshCw size={16} aria-hidden />
                  </button>
                )}
              </div>
            </header>

            {store.phase === 'error' && (
              <div className="banner" data-tone="danger"><span className="txt"><b>读取失败</b> · {store.loadError}</span>
                <div className="acts"><button type="button" className="btn-white" onClick={() => void store.refresh()}>重试</button></div></div>
            )}
            {store.phase === 'ready' && store.syncError && (
              <div className="banner" data-tone={offline ? 'danger' : 'warn'}>
                <span className="txt"><b>{offline ? '未连接' : '同步失败'}</b> · 以下是 {store.lastSyncAt ? formatClock(store.lastSyncAt) : ''} 读到的状态。{store.syncError}</span>
                <div className="acts"><button type="button" className="btn-white" onClick={() => void store.refresh()}>重试</button></div>
              </div>
            )}
            {store.phase === 'ready' && !store.syncError && stale && (
              <div className="banner" data-tone="warn"><span className="txt"><b>资料可能已过期</b> · 上次同步 {store.lastSyncAt ? formatClock(store.lastSyncAt) : ''}，进展和期限可能已变化。</span>
                <div className="acts"><button type="button" className="btn-white" onClick={() => void store.refresh()}>刷新</button></div></div>
            )}
            {store.conflict && !sheet && (
              <div className="banner" data-tone="warn" role="alert">
                <span className="txt"><b>未保存</b> · 服务器上的状态已更新，「{store.conflict.label}」没有保存。已载入最新状态，确认后可重新应用。</span>
                <div className="acts">
                  <button type="button" className="btn-white" onClick={async () => { const r = await store.reapply(); if (r.ok) toast('已基于最新状态保存'); else toast(r.message); }}>重新应用</button>
                  <button type="button" className="btn-text" onClick={store.dismissConflict}>放弃</button>
                </div>
              </div>
            )}

            {store.phase === 'loading' && (
              <section className="sec" aria-busy="true"><span className="loading">正在读取待办…</span><div className="skel" /><div className="skel" /><div className="skel" /></section>
            )}

            {state && tab === 'home' && <IntelligencePanel state={state} now={now} open={open} run={store.run} saving={store.saving} toast={toast} />}
            {home && tab === 'home' && (
              <HomeView lists={home} selId={selId} open={open} act={act}
                needOpen={needOpen} setNeedOpen={setNeedOpen} quietOpen={quietOpen} setQuietOpen={setQuietOpen}
                onCompose={() => setSheet({ type: 'compose' })}
                onClosed={() => { setClosedOpen(true); goTab('all'); }}
                isEmptyDoc={isEmptyDoc} demoHref={demoHref} />
            )}
            {all && tab === 'all' && (
              <AllView {...all} f={filters} setF={setFilters} sort={sort} setSort={setSort}
                selId={selId} open={open} closedOpen={closedOpen} setClosedOpen={setClosedOpen} />
            )}
          </div>
        </main>

        <nav className="wb-tabbar" aria-label="主导航">
          <button type="button" className="tab" aria-current={tab === 'home' ? 'page' : undefined} onClick={() => goTab('home')}><LayoutGrid size={18} aria-hidden />待办总览</button>
          <button type="button" className="tab-compose" onClick={() => setSheet({ type: 'compose' })}><Plus size={20} aria-hidden />交给 DOT</button>
          <button type="button" className="tab" aria-current={tab === 'all' ? 'page' : undefined} onClick={() => goTab('all')}><List size={18} aria-hidden />全部事项</button>
        </nav>
      </div>

      {detailOpen && <button type="button" className="wb-scrim" aria-label="关闭详情" onClick={close} />}
      {state && selRow && (
        <TaskDetail key={selRow.id} row={selRow} state={state} now={now} onClose={close} run={store.run} toast={toast} saving={store.saving}
          openTask={open}
          openReview={() => setSheet({ type: 'review', taskId: selRow.id })}
          openWatch={() => setSheet({ type: 'watch', taskId: selRow.id })}
          askDone={() => setSheet({ type: 'done', taskId: selRow.id })} />
      )}
      {selCmd && <CommandDetail key={selCmd.id} row={commandRow(selCmd)} now={now} onClose={close} />}

      {sheet?.type === 'collaboration' && state && <CollaborationSheet state={state} now={now} run={store.run} saving={store.saving} onClose={()=>setSheet(null)}/> }
      {sheet?.type === 'compose' && (
        <ComposeSheet run={store.run} offline={offline || store.phase === 'error'} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); goTab('home'); toast('已保存 · 等待 DOT 接收'); }} />
      )}
      {sheet?.type === 'review' && sheetTask && sheetReview && (
        <ReviewSheet key={sheetTask.id} task={sheetTask} review={sheetReview} run={store.run} onClose={() => setSheet(null)} toast={toast} now={now} />
      )}
      {sheet?.type === 'watch' && sheetTask && state && (
        <WatchSheet task={sheetTask} state={state} run={store.run} onClose={() => setSheet(null)} toast={toast} />
      )}
      {sheet?.type === 'done' && sheetTask && (
        <DoneSheet task={sheetTask} run={store.run} onClose={() => setSheet(null)} toast={toast} />
      )}

      {toastText && <div className="toast" role="status">{toastText}</div>}
    </div>
  );
}
