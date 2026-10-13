/**
 * DOT 工作台 v2 — frontend view of the existing GET/PUT /api/state document.
 * Field-by-field contract and enums: DATA-CONTRACT.md.
 *
 * Rules the UI enforces:
 * - The browser writes only user intents (commands, decisions, approvals, draft edits,
 *   pause/resume, user-confirmed completion, monitor requests, priority/deadline edits).
 * - Any acknowledged / running / sent / scheduled / completed state counts only when it
 *   carries a non-empty receipt written by DOT (MCP). Without one, the UI shows "waiting".
 * - Unknown/additive fields are preserved on every write (records are spread, never rebuilt).
 */

export type ISODate = string;
export type Actor = 'user' | 'dot';
export type Domain = '出行' | '工作' | '生活' | '项目';
export type Priority = 'P0' | 'P1' | 'P2';

/** Envelope returned by GET and PUT /api/state. */
export interface StateEnvelope {
  revision: number;
  state: WorkbenchState;
  updatedAt: string | null;
}

export interface WorkbenchState {
  /** Required by the server. */
  tasks: Task[];
  commands: Command[];
  monitors: Monitor[];
  reviews: Review[];
  runs: Run[];
  /** Preserved untouched. Space is optional source linkage only; never required. */
  workspaces: string[];
  /** Additive record arrays (optional). */
  contexts?: ContextRecord[];
  requirements?: RequirementRecord[];
  decisions?: DecisionRecord[];
  history?: HistoryRecord[];
  signals?: Signal[];
  preferences?: WorkPreference[];
  capabilities?: CapabilityCheck[];
  digests?: NotificationDigest[];
  [extra: string]: unknown;
}

/* ───────────── commands: one natural-language instruction each ───────────── */

export type CommandStatus = 'queued' | 'acknowledged' | 'running' | 'completed' | 'blocked';

export interface Command {
  /** UUID v4. */
  id: string;
  /** Verbatim user text. */
  text: string;
  /** Browser writes only 'queued'. Other values are set by DOT and require `receipt`. */
  status: CommandStatus;
  createdAt: ISODate;
  /** Non-empty proof from DOT. Required for any status other than 'queued'. */
  receipt?: string;
  updatedAt?: ISODate;
  /** Set by DOT: tasks it created from this command. */
  taskIds?: string[];
  /** Set by DOT when status is 'blocked'. */
  blockedReason?: string;
  interpretation?: CommandInterpretation;
  [extra: string]: unknown;
}

/* ───────────── tasks: one user goal each ───────────── */

export type TaskState = 'open' | 'paused' | 'completed';
export type DotStatus = 'queued' | 'acknowledged' | 'running' | 'waiting' | 'blocked' | 'completed';
export type NeedKind = 'review' | 'choose' | 'material' | 'login' | 'inperson' | 'clarify' | 'verify';

export interface Task {
  /** Verbatim change request bound to the exact draft the user read. Not approval. */
  reviewFeedback?: {
    id: string; reviewId: string; version: number; contentHash: string;
    text: string; createdAt: ISODate; handoffId: string;
  };
  activeReviewId?: string;
  preparation?: Preparation;
  sourceKey?: string;
  plan?: TaskPlan | null;
  /** Coordination only: never an authorization or proof of external execution. */
  lease?: { id: string; handoffId: string; purpose?: 'task' | 'preparation'; expiresAt: ISODate } | null;
  /** Stable id (UUID). Never reused or derived from title. */
  id: string;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  commandId?: string;
  domain: Domain | null;
  /** Independent of deadline. */
  priority: Priority | null;
  /** Independent of priority. */
  deadline: Deadline | null;
  /** 'completed' only via user confirmation (completion.by === 'user'). */
  state: TaskState;
  /**
   * Exactly one side owns the next step. need != null iff owner === 'user';
   * dot != null iff owner === 'dot'. Kept as-is while paused so resume restores it.
   */
  owner: Actor;
  need: Need | null;
  dot: DotWork | null;
  pause?: { at: ISODate; note?: string } | null;
  completion?: Completion | null;
  /** Goal sentence for this task (requirements/constraints live in `requirements`). */
  goal?: string;
  /** Human-facing context; audit evidence stays in its original fields. */
  briefing?: { background: string; latest?: string; next?: string; checkedAt?: ISODate };
  steps: Step[];
  /** Acceptance evidence, normally written by DOT with a receipt. */
  evidence?: Evidence[];
  /** Scopes already authorised by the user; same-scope actions don't ask again. */
  authorizations?: Authorization[];
  /** Optional Space linkage: one of state.workspaces. Never required. */
  workspace?: string | null;
  [extra: string]: unknown;
}

export interface Deadline {
  at: ISODate;
  allDay?: boolean;
}

export interface Need {
  id: string;
  kind: NeedKind;
  next: string;
  why: string;
  requestedAt: ISODate;
  reviewId?: string;
  options?: ChoiceOption[];
  question?: string;
  detail?: string;
  /** Page the user opens in their own browser (login / in-person). */
  url?: string;
}

export interface ChoiceOption {
  id: string;
  name: string;
  detail?: string;
  price?: string;
  note?: string;
}

export interface DotWork {
  blocker?: {
    sharedKey?: string;
    step: string;
    reason: string;
    next: string;
    basis: 'current_check' | 'last_record' | 'not_checked';
    observedAt?: ISODate;
  } | null;
  /** New id each time the browser hands work to DOT; DOT acknowledges it. */
  handoffId: string;
  handoffAt: ISODate;
  /** Browser writes only 'queued'. Others need `receipt`. */
  status: DotStatus;
  receipt?: string;
  receiptAt?: ISODate;
  summary: string;
  waitingOn?: string | null;
  promise?: string | null;
  flag?: 'alert' | 'new' | null;
}

/** DOT's plan, separate from the user's follow-up preferences. */
export interface TaskPlan {
  /** Explicit read-only preparation while the next decision stays with the user. */
  prepareWhileWaiting?: boolean;
  nextAction: string;
  why: string;
  dependsOn: string[];
  sharedBlockerKey?: string;
  lastCheckedAt?: ISODate;
  nextCheckAt?: ISODate;
  checkpoint?: string;
}

export interface Signal {
  id: string;
  key: string;
  taskId?: string;
  kind: 'change' | 'blocker' | 'opportunity';
  title: string;
  summary: string;
  next?: string;
  observedAt: ISODate;
  recordedAt: ISODate;
  receipt: string;
  attention: 'now' | 'digest' | 'quiet';
  state: 'new' | 'seen' | 'dismissed';
  delivery?: { id: string; status: 'reserved' | 'delivered'; at: ISODate; receipt?: string };
}

export interface WorkPreference {
  status?: 'active' | 'inactive';
  history?: { text: string; sourceId: string; quote: string; basis: 'user_instruction' | 'dot_suggestion'; at: ISODate }[];
  id: string;
  text: string;
  basis: 'user_instruction' | 'dot_suggestion';
  sourceId: string;
  quote: string;
  updatedAt: ISODate;
}

export interface Completion {
  at: ISODate;
  by: 'user';
  verification: 'user_confirmed';
  /** Evidence ids that existed when the user confirmed. */
  evidenceIds: string[];
  note?: string;
}

export interface Step {
  id: string;
  text: string;
  done: boolean;
  role?: 'review' | 'user' | 'dot';
}

export interface Evidence {
  id: string;
  at: ISODate;
  text: string;
  receipt?: string;
  url?: string;
}

export interface Authorization {
  id: string;
  scope: string;
  grantedAt: ISODate;
}

/* ───────────── reviews: exact-content approvals ───────────── */

export type ReviewStatus = 'pending' | 'approved' | 'invalidated' | 'executed';

export interface Review {
  id: string;
  taskId: string;
  channel: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Increments on every content edit. */
  version: number;
  /** Hash of channel/to/cc/subject/body at `version`. */
  contentHash: string;
  status: ReviewStatus;
  approval: Approval | null;
  /** Approvals invalidated by later edits (kept for history). */
  priorApprovals?: Approval[];
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Set by DOT only; required for status 'executed'. */
  executionReceipt?: string;
  executedAt?: ISODate;
  [extra: string]: unknown;
}

export interface Approval {
  id: string;
  version: number;
  contentHash: string;
  at: ISODate;
  by: 'user';
  invalidatedAt?: ISODate;
  invalidReason?: string;
}

/* ───────────── monitors: 持续关注 ───────────── */

export type MonitorStatus = 'requested' | 'active' | 'stop_requested' | 'stopped' | 'failed';
export type MonitorFreq = '每小时' | '每天' | '每周';
export type MonitorField = 'sources' | 'freq' | 'time' | 'tz' | 'until' | 'notify';
export type MonitorFieldOrigin = { kind: 'user_selected' | 'user_instruction' | 'dot_suggestion'; quote?: string };

export interface Monitor {
  id: string;
  taskId: string;
  sources: string[];
  what: string;
  freq: MonitorFreq | null;
  time: string;
  tz: string;
  until: string;
  notify: string[];
  /** Preferences stay empty unless explicitly supplied; execution arrangements are separate. */
  fieldOrigins?: Partial<Record<MonitorField, MonitorFieldOrigin>>;
  planSummary?: string;
  /** Browser writes 'requested' / 'stop_requested'. 'active' counts only with scheduleReceipt. */
  status: MonitorStatus;
  requestedAt: ISODate;
  updatedAt: ISODate;
  scheduleReceipt?: string;
  scheduledAt?: ISODate;
  nextRunAt?: ISODate;
  supersedes?: string;
  [extra: string]: unknown;
}

/* ───────────── runs: written only by DOT ───────────── */

export type RunKind = 'action' | 'check' | 'send' | 'step' | 'note';
export type RunStatus = 'running' | 'succeeded' | 'failed';

export interface Run {
  id: string;
  taskId?: string;
  commandId?: string;
  monitorId?: string;
  reviewId?: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: ISODate;
  finishedAt?: ISODate;
  summary: string;
  receipt: string;
  [extra: string]: unknown;
}

/* ───────────── additive records ───────────── */

export type ContextKind = 'instruction' | 'chat' | 'email' | 'calendar' | 'web' | 'file' | 'note' | 'space';

/** Source references. kind 'space' links optionally to one of state.workspaces. */
export interface ContextRecord {
  id: string;
  taskId: string;
  kind: ContextKind;
  label: string;
  /** Plain-language description; the original label and source link are retained. */
  summary?: string;
  at?: ISODate;
  url?: string;
  workspace?: string;
  [extra: string]: unknown;
}

export interface RequirementRecord {
  id: string;
  taskId: string;
  kind: 'requirement' | 'constraint';
  text: string;
  createdAt: ISODate;
  by: Actor;
  [extra: string]: unknown;
}

export interface DecisionRecord {
  id: string;
  taskId: string;
  at: ISODate;
  by: Actor;
  text: string;
  needId?: string;
  [extra: string]: unknown;
}

/** One entry per change to a task record (its revisions). */
export interface HistoryRecord {
  id: string;
  taskId?: string;
  commandId?: string;
  at: ISODate;
  by: Actor;
  summary: string;
  [extra: string]: unknown;
}

export interface CommandInterpretation {
  kind: 'task' | 'followup' | 'context' | 'preference' | 'discussion' | 'suggestion' | 'clarify';
  summary: string; quote: string; taskIds: string[]; receipt: string; at: ISODate;
}
export interface Preparation {
  id: string; kind: 'draft' | 'options' | 'brief'; title: string; summary: string; body: string;
  status: 'ready' | 'needs_info'; missing: string[]; sourceIds: string[];
  handoffId: string; createdAt: ISODate; receipt: string;
}
export interface CapabilityCheck {
  id: string; label: string; environment: 'cloud' | 'local_mac';
  status: 'available' | 'blocked' | 'not_checked'; step: string; reason: string; next: string;
  checkedAt?: ISODate; receipt: string; sourceIds: string[]; taskIds: string[];
}
export interface NotificationDigest {
  id: string; signalIds: string[]; status: 'reserved' | 'delivered'; at: ISODate; receipt?: string;
}
