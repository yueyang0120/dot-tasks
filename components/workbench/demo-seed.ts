/**
 * FICTIONAL DEMO DATA — every person, address and company here is made up.
 * Loaded only by demoAdapter (opt-in ?demo=1 when the page allows it). Never sent to /api/state.
 * Receipts below are fake and exist only to show how real DOT receipts would render.
 */
import type {
  ContextRecord, DecisionRecord, HistoryRecord, Monitor, Review, RequirementRecord, Run, Step, Task, WorkbenchState,
} from './types';
import { draftContentHash } from './util';

export function demoSeed(now = new Date()): WorkbenchState {
  let n = 0;
  const id = (p: string) => `demo-${p}-${(++n).toString().padStart(3, '0')}`;
  const at = (dayOffset: number, hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m);
    return d.toISOString();
  };
  const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
  const steps = (xs: [string, boolean, Step['role']?][]): Step[] => xs.map(([text, done, role]) => ({ id: id('step'), text, done, ...(role ? { role } : {}) }));

  const tasks: Task[] = [];
  const reviews: Review[] = [];
  const monitors: Monitor[] = [];
  const runs: Run[] = [];
  const contexts: ContextRecord[] = [];
  const requirements: RequirementRecord[] = [];
  const decisions: DecisionRecord[] = [];
  const history: HistoryRecord[] = [];

  const base = (p: Partial<Task> & Pick<Task, 'title' | 'steps'>): Task => ({
    id: id('task'), createdAt: ago(600), updatedAt: ago(60), domain: null, priority: null, deadline: null,
    state: 'open', owner: 'dot', need: null, dot: null, evidence: [], authorizations: [], ...p,
  });
  const ctx = (taskId: string, kind: ContextRecord['kind'], label: string) => contexts.push({ id: id('ctx'), taskId, kind, label });
  const log = (taskId: string, minAgo: number, summary: string, by: 'user' | 'dot' = 'dot') =>
    history.push({ id: id('hist'), taskId, at: ago(minAgo), by, summary });
  const run = (taskId: string, minAgo: number, summary: string, extra: Partial<Run> = {}) =>
    runs.push({ id: id('run'), taskId, kind: 'action', status: 'succeeded', startedAt: ago(minAgo), finishedAt: ago(minAgo), summary, receipt: `demo-receipt-${n}`, ...extra });
  const dotWork = (summary: string, status: NonNullable<Task['dot']>['status'], extra: Partial<NonNullable<Task['dot']>> = {}) => ({
    handoffId: id('hof'), handoffAt: ago(900), status, summary, receipt: status === 'queued' ? undefined : `demo-receipt-${n}`, receiptAt: ago(800), ...extra,
  });

  // 1. Review a reply draft — due today 18:00
  {
    const t = base({ title: '回复房东林女士的续租邮件', domain: '生活', priority: 'P1', deadline: { at: at(0, '18:00') }, owner: 'user', goal: '续租两年并把涨幅控制在 5% 以内',
      steps: steps([['读取房东来信', true], ['按你的口径起草回复', true], ['你审核草稿', false, 'review'], ['DOT 发送并记录回执', false, 'dot']]) });
    const r: Review = { id: id('rev'), taskId: t.id, channel: '邮件 · chen.mo@example.com', to: '林女士 <lin.landlord@example.com>', cc: '无', subject: 'Re: 关于明年续租的确认',
      body: '林女士您好：\n\n感谢提前告知。我希望续租两年，至 2028 年 11 月 30 日。租金方面，能否按不超过 5% 的调整幅度确认？如可以，请把新合同发我，我会在本周内签回。\n\n祝好\n陈默',
      version: 1, contentHash: '', status: 'pending', approval: null, createdAt: ago(90), updatedAt: ago(90) };
    r.contentHash = draftContentHash(r);
    t.need = { id: id('need'), kind: 'review', reviewId: r.id, requestedAt: ago(90), next: '回复已按你的口径起草：续两年、涨幅不超过 5%', why: '林女士要求今天内答复是否续租两年。DOT 已按你的口径起草回复，批准后才会发送。' };
    tasks.push(t); reviews.push(r);
    ctx(t.id, 'email', '邮件 · 林女士 · 今天 09:12'); ctx(t.id, 'instruction', '你的口述：「续两年，涨幅别超过 5%」');
    requirements.push({ id: id('req'), taskId: t.id, kind: 'requirement', text: '续租两年', createdAt: ago(600), by: 'user' },
      { id: id('req'), taskId: t.id, kind: 'constraint', text: '租金涨幅不超过 5%', createdAt: ago(600), by: 'user' });
    run(t.id, 120, '读取来信，识别出今天 18:00 的答复期限'); run(t.id, 90, '草稿生成，等待你审核');
  }
  // 2. Choose an itinerary — due today 21:00, P0
  {
    const t = base({ title: '东京出差：选定机票和酒店', domain: '出行', priority: 'P0', deadline: { at: at(0, '21:00') }, owner: 'user', goal: '订好 11 月东京季度会的机票和酒店',
      steps: steps([['确认会议日期与地点', true], ['比价三组机酒', true], ['你选方案', false, 'user'], ['DOT 预订并发行程单', false, 'dot']]) });
    t.need = { id: id('need'), kind: 'choose', requestedAt: ago(110), next: '3 个机酒方案已比好，报价今晚 21:00 失效', why: '航司报价只保留到今晚 21:00，过时需重新询价，可能超出差旅标准。',
      options: [
        { id: 'a', name: '方案 A · 早班直飞', detail: '11月3日 08:05 浦东→羽田，新桥商务酒店 4 晚', price: '¥8,460', note: '到达最早，可赶上午会' },
        { id: 'b', name: '方案 B · 午班直飞', detail: '11月3日 12:40 浦东→羽田，品川站前酒店 4 晚', price: '¥7,920', note: '唯一在差旅标准内' },
        { id: 'c', name: '方案 C · 前一晚出发', detail: '11月2日 19:30 虹桥→羽田，新桥商务酒店 5 晚', price: '¥9,180', note: '多住一晚，需自付差额' },
      ] };
    tasks.push(t);
    ctx(t.id, 'calendar', '日历 · 东京季度会 11月3–6日'); ctx(t.id, 'file', '差旅标准 · 经济舱、酒店 ≤ ¥1,100/晚');
    requirements.push({ id: id('req'), taskId: t.id, kind: 'constraint', text: '经济舱，酒店每晚不超过 ¥1,100', createdAt: ago(600), by: 'user' });
    run(t.id, 1100, '向 3 家渠道询价'); run(t.id, 110, '整理出 3 个方案，报价保留至今晚 21:00');
  }
  // 3. Sign in person — tomorrow 12:00
  {
    const t = base({ title: '签署星桥科技合作框架协议', domain: '项目', priority: 'P0', deadline: { at: at(1, '12:00') }, owner: 'user',
      steps: steps([['核对协议条款与上一版差异', true], ['你本人完成电子签', false, 'user'], ['DOT 归档并通知对方', false, 'dot']]) });
    t.need = { id: id('need'), kind: 'inperson', requestedAt: ago(500), next: '对方要求本人电子签，DOT 不能代签', why: '对方要求签署人本人完成电子签。不签会推迟项目启动；条款已比对，3 处变更都在你的底线内。',
      detail: '签署链接在你的邮箱「星桥科技 · 合作框架协议」。签完回来点下方按钮，DOT 负责归档和通知对方。' };
    tasks.push(t);
    ctx(t.id, 'email', '邮件 · 星桥科技法务'); ctx(t.id, 'file', '条款比对 · 3 处变更已标注');
    run(t.id, 960, '比对完成，3 处变更均在你给的底线内');
  }
  // 4. Material — date-only deadline in 3 days
  {
    const t = base({ title: '护照续签预约', domain: '出行', priority: 'P0', deadline: { at: at(3, '00:00'), allDay: true }, owner: 'user',
      steps: steps([['查询可预约时段', true], ['填写申请表', true], ['你补充新证件照', false, 'user'], ['DOT 提交预约', false, 'dot']]) });
    t.need = { id: id('need'), kind: 'material', requestedAt: ago(160), next: '证件照已过期，需要 6 个月内的新照片', why: '预约前要上传 6 个月内的证件照。之前给的照片已超过 6 个月；4 天后上午仍有号。',
      detail: '需 6 个月内、白底、48×33mm。照片放进你的资料文件夹后点下方按钮。' };
    tasks.push(t);
    ctx(t.id, 'web', '出入境预约页面 · 4 天后上午仍有号'); ctx(t.id, 'file', '资料库 · 旧证件照');
    run(t.id, 160, '发现证件照过期，暂停提交');
  }
  // 5. Login — 5 days
  {
    const t = base({ title: '提交九月差旅报销', domain: '工作', priority: 'P1', deadline: { at: at(5, '23:59') }, owner: 'user',
      steps: steps([['整理 7 张发票', true], ['提交前 2 张', true], ['你恢复登录', false, 'user'], ['DOT 提交剩余 5 张', false, 'dot']]) });
    t.need = { id: id('need'), kind: 'login', requestedAt: ago(150), next: '报销系统登录过期，停在第 3 张发票', why: '报销系统登录已过期，DOT 已提交 2 张，停在第 3 张，无法继续。',
      detail: '登录在你自己的浏览器完成，DOT 不保存密码，恢复后只继续同一范围的提交。' };
    tasks.push(t);
    ctx(t.id, 'email', '邮箱 · 发票 7 封'); ctx(t.id, 'web', '报销系统 · 会话过期');
    run(t.id, 150, '提交第 3 张时登录失效', { status: 'failed' });
  }
  // 6. Review, no deadline, P2
  {
    const t = base({ title: '向物业报修厨房水龙头', domain: '生活', priority: 'P2', owner: 'user',
      steps: steps([['起草报修留言', true], ['你审核', false, 'review'], ['DOT 提交并跟进上门时间', false, 'dot']]) });
    const r: Review = { id: id('rev'), taskId: t.id, channel: '物业小程序留言', to: '安和苑物业服务中心', cc: '无', subject: '报修：3 栋 1202 厨房水龙头滴水',
      body: '您好，3 栋 1202 厨房水龙头关闭后持续滴水，已有两天。请安排维修师傅上门，工作日晚上 7 点后或周末均可，谢谢。',
      version: 1, contentHash: '', status: 'pending', approval: null, createdAt: ago(30), updatedAt: ago(30) };
    r.contentHash = draftContentHash(r);
    t.need = { id: id('need'), kind: 'review', reviewId: r.id, requestedAt: ago(30), next: '报修留言已起草，确认后提交', why: '水龙头持续滴水。DOT 起草了报修留言，确认后提交并跟进上门时间。' };
    tasks.push(t); reviews.push(r);
    ctx(t.id, 'instruction', '你的口述：「厨房水龙头一直滴」');
    run(t.id, 30, '草稿生成');
  }
  // 7. Waiting external, no monitor scheduled
  {
    const t = base({ title: '车险理赔进度', domain: '生活', priority: 'P1',
      dot: dotWork('3 天前已交材料，等保险公司回复；目前没人查看回复', 'waiting', { waitingOn: '保险公司', flag: 'alert' }),
      steps: steps([['整理事故照片与维修单', true], ['提交理赔材料', true], ['等待保险公司审核', false], ['确认赔付到账', false]]) });
    t.watchHint = '保险公司是否回复审核结果';
    tasks.push(t);
    ctx(t.id, 'email', '邮件 · 理赔受理回执');
    run(t.id, 4300, '材料提交，受理号 CL-DEMO-17');
  }
  // 8. Running with promise + active monitor + authorization
  {
    const t = base({ title: '汇总第三季度项目周报', domain: '项目', priority: 'P1', deadline: { at: at(1, '09:00') },
      dot: dotWork('已收齐 3/5 位组员更新，正在合并成一页摘要', 'running', { promise: '今天 17:00 前出初稿', flag: 'new' }),
      authorizations: [{ id: id('auth'), scope: '向项目组成员发送催交提醒。同一范围的提醒不再逐条审核。', grantedAt: ago(3000) }],
      steps: steps([['向组员收集更新', true], ['催交未提交的 2 位', true], ['合并为一页摘要', false], ['发你审核', false]]) });
    tasks.push(t);
    const m: Monitor = { id: id('mon'), taskId: t.id, sources: ['邮箱'], what: '组员是否提交周报更新', freq: '每天', time: '09:00', tz: '上海 UTC+8', until: at(2, '00:00').slice(0, 10),
      notify: ['超过截止仍无回复'], status: 'active', requestedAt: ago(2900), updatedAt: ago(2880), scheduleReceipt: 'demo-schedule-1', scheduledAt: ago(2880), nextRunAt: at(1, '09:00') };
    monitors.push(m);
    ctx(t.id, 'email', '项目群邮件 · 3 份更新'); ctx(t.id, 'instruction', '你的口述：「周一前要」');
    run(t.id, 1500, '检查：3 人已交', { kind: 'check', monitorId: m.id }); run(t.id, 1498, '向 2 人发送催交提醒（已授权范围）'); run(t.id, 90, '检查：无新提交', { kind: 'check', monitorId: m.id });
  }
  // 9–10. Quiet waits with active monitors
  for (const [title, domain, line, what, freq, until] of [
    ['洗碗机延保登记', '生活', '等厂商确认登记 · 上次检查无变化', '厂商是否发来登记确认', '每周', 50],
    ['预订十一月工作坊场地', '工作', '等行政回复场地申请 · 上次检查无变化', '行政是否批复场地申请', '每天', 9],
  ] as const) {
    const t = base({ title, domain, priority: 'P2', dot: dotWork(line, 'waiting', { waitingOn: '对方' }),
      steps: steps([['提交申请', true], ['等待对方回复', false]]) });
    tasks.push(t);
    const m: Monitor = { id: id('mon'), taskId: t.id, sources: ['邮箱'], what, freq, time: '10:00', tz: '上海 UTC+8', until: at(until, '00:00').slice(0, 10), notify: ['有新回复'],
      status: 'active', requestedAt: ago(9000), updatedAt: ago(8990), scheduleReceipt: `demo-schedule-${n}`, scheduledAt: ago(8990), nextRunAt: at(1, '10:00') };
    monitors.push(m);
    run(t.id, 60, '检查：无变化', { kind: 'check', monitorId: m.id });
  }
  // 11. User-confirmed complete
  {
    const t = base({ title: '预约牙科复诊', domain: '生活', priority: 'P2', state: 'completed', owner: 'dot', dot: dotWork('复诊已完成', 'completed'),
      steps: steps([['查询可约时间', true], ['预约复诊', true], ['复诊完成', true]]) });
    t.evidence = [{ id: id('ev'), at: ago(2900), text: '诊所短信确认：复诊已完成', receipt: 'demo-receipt-ev' }];
    t.completion = { at: ago(2880), by: 'user', verification: 'user_confirmed', evidenceIds: [t.evidence[0].id] };
    tasks.push(t);
    ctx(t.id, 'note', '诊所短信确认');
    log(t.id, 2880, '你确认已完成，事项关闭', 'user');
  }
  // 12. Paused
  {
    const t = base({ title: '搬家后更新各处地址', domain: '生活', priority: 'P2', state: 'paused', pause: { at: ago(8600), note: '等搬家日期确定后再推进' },
      dot: dotWork('已列出 9 个需要更新地址的账户', 'acknowledged'),
      steps: steps([['列出需更新地址的 9 个账户', true], ['逐个更新', false]]) });
    tasks.push(t);
    ctx(t.id, 'instruction', '你的口述');
    log(t.id, 8600, '你暂停了此事项', 'user');
  }
  void decisions;

  return { demo: true, tasks, commands: [], monitors, reviews, runs, workspaces: [], contexts, requirements, decisions, history };
}
