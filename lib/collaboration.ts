import type { CapabilityCheck, CommandInterpretation, NotificationDigest, Preparation, WorkbenchState } from '../components/workbench/types';
const text = (v:unknown,max=4000):v is string => typeof v==='string' && !!v.trim() && v.length<=max;
const iso = (v:unknown):v is string => typeof v==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const strings = (v:unknown,max=30):v is string[] => Array.isArray(v) && v.length<=max && v.every(x=>text(x,400)) && new Set(v).size===v.length;
const records = (s:WorkbenchState) => [...(s.contexts??[]),...(s.requirements??[]),...(s.decisions??[]),...s.tasks.flatMap(t=>(t.evidence??[]).map(e=>({...e,taskId:t.id}))),...s.runs];
function sources(s:WorkbenchState,ids:string[],taskIds:string[]) {
  if (!strings(ids) || !ids.length || ids.some(id=>!records(s).some(r=>r.id===id && (!taskIds.length || taskIds.includes(r.taskId??''))))) throw new Error('ACTUAL_SOURCE_REQUIRED');
}
function validInterpretation(v:CommandInterpretation) {return !!v && ['task','followup','context','preference','discussion','suggestion','clarify'].includes(v.kind) && text(v.summary) && text(v.quote) && strings(v.taskIds) && text(v.receipt,12000) && iso(v.at);}
function validPreparation(v:Preparation) {return !!v && text(v.id) && ['draft','options','brief'].includes(v.kind) && text(v.title,200) && text(v.summary) && text(v.body,20000) && ['ready','needs_info'].includes(v.status) && strings(v.missing) && (v.status!=='needs_info'||!!v.missing.length) && strings(v.sourceIds) && !!v.sourceIds.length && text(v.handoffId) && iso(v.createdAt) && text(v.receipt,12000);}
function validCapability(v:CapabilityCheck) {return !!v && text(v.id) && text(v.label,200) && ['cloud','local_mac'].includes(v.environment) && ['available','blocked','not_checked'].includes(v.status) && text(v.step) && text(v.reason) && text(v.next) && text(v.receipt,12000) && strings(v.sourceIds) && strings(v.taskIds) && (v.status==='not_checked' ? v.checkedAt===undefined : iso(v.checkedAt));}
export function validateCollaboration(s:WorkbenchState) {
  for (const c of s.commands) if(c.interpretation && (!validInterpretation(c.interpretation) || !c.text.includes(c.interpretation.quote) || c.interpretation.taskIds.some(id=>!s.tasks.some(t=>t.id===id)))) throw new Error('INVALID_COMMAND_INTERPRETATION');
  for (const t of s.tasks) if(t.preparation) {if(!validPreparation(t.preparation)) throw new Error('INVALID_PREPARATION'); sources(s,t.preparation.sourceIds,[]);}
  for (const key of ['capabilities','digests'] as const) if(s[key] && (!Array.isArray(s[key]) || s[key]!.length>1000 || new Set(s[key]!.map(v=>v.id)).size!==s[key]!.length)) throw new Error('INVALID_COLLABORATION_RECORDS');
  for (const c of s.capabilities??[]) {if(!validCapability(c) || c.taskIds.some(id=>!s.tasks.some(t=>t.id===id))) throw new Error('INVALID_CAPABILITY'); if(c.status!=='not_checked') sources(s,c.sourceIds,c.taskIds);}
  for (const d of s.digests??[]) {
    if(!text(d.id) || !strings(d.signalIds,8) || !d.signalIds.length || !iso(d.at) || !['reserved','delivered'].includes(d.status) || (d.status==='delivered'&&!text(d.receipt,12000)) || d.signalIds.some(id=>!s.signals?.some(v=>v.id===id && v.delivery?.id===d.id && v.delivery.status===d.status))) throw new Error('INVALID_DIGEST');
  }
  if(s.preferences?.some(p=>p.status!==undefined && !['active','inactive'].includes(p.status))) throw new Error('INVALID_PREFERENCE_STATUS');
}
export function interpretCommand(s:WorkbenchState,id:string,input:CommandInterpretation,now:Date) {
  const c=s.commands.find(c=>c.id===id); if(!c) throw new Error('COMMAND_NOT_FOUND');
  const v={...input,at:now.toISOString()};
  if(!validInterpretation(v) || !c.text.includes(v.quote) || v.taskIds.some(id=>!s.tasks.some(t=>t.id===id))) throw new Error('COMMAND_SOURCE_REQUIRED');
  if(c.interpretation) {
    if(JSON.stringify({...c.interpretation,at:''})!==JSON.stringify({...v,at:''})) throw new Error('INTERPRETATION_ALREADY_RECORDED');
    return {interpretation:c.interpretation,deduplicated:true};
  }
  c.interpretation=v; return {interpretation:v,deduplicated:false};
}
export function recordPreparation(s:WorkbenchState,taskId:string,input:Preparation,leaseId:string,now:Date) {
  const t=s.tasks.find(t=>t.id===taskId); if(!t || t.state!=='open') throw new Error('TASK_CLOSED_OR_PAUSED');
  const expected=t.owner==='user'?t.need?.id:t.dot?.handoffId;
  if(input.handoffId!==expected) throw new Error('HANDOFF_CHANGED');
  if(!t.lease || t.lease.id!==leaseId || t.lease.handoffId!==expected || Date.parse(t.lease.expiresAt)<=+now || (t.owner==='user'&&t.lease.purpose!=='preparation')) throw new Error('LEASE_REQUIRED');
  const v={...input,createdAt:now.toISOString()};if(!validPreparation(v)) throw new Error('PREPARATION_EVIDENCE_REQUIRED');
  sources(s,v.sourceIds,[t.id,...(t.plan?.dependsOn??[])]);
  if(t.preparation?.id===v.id) {if(JSON.stringify({...t.preparation,createdAt:''})!==JSON.stringify({...v,createdAt:''})) throw new Error('PREPARATION_ID_REUSED');return {preparation:t.preparation,deduplicated:true};}
  t.preparation=v;t.updatedAt=now.toISOString();return {preparation:v,deduplicated:false};
}
export function recordCapability(s:WorkbenchState,input:CapabilityCheck,now:Date) {
  if(!validCapability(input) || (input.checkedAt && Date.parse(input.checkedAt)>+now+60000) || input.taskIds.some(id=>!s.tasks.some(t=>t.id===id&&t.state==='open'))) throw new Error('CAPABILITY_CHECK_REQUIRED');
  if(input.status!=='not_checked')sources(s,input.sourceIds,input.taskIds);
  const rows=s.capabilities??=[];const old=rows.find(c=>c.id===input.id);
  if(old?.checkedAt && (!input.checkedAt || Date.parse(input.checkedAt)<Date.parse(old.checkedAt)))throw new Error('CAPABILITY_CHECK_STALE');
  if(old && old.environment!==input.environment)throw new Error('CAPABILITY_SCOPE_CHANGED');
  if(old)Object.assign(old,input);else rows.push({...input});return {capability:old??input};
}
export function notificationSummary(s:WorkbenchState) {
  const eligible=(s.signals??[]).filter(v=>v.state==='new' && v.attention!=='quiet' && !v.delivery && (!v.taskId || s.tasks.some(t=>t.id===v.taskId&&t.state==='open')));
  return {now:eligible.filter(v=>v.attention==='now'),digest:eligible.filter(v=>v.attention==='digest'),uncertain:(s.signals??[]).filter(v=>v.delivery?.status==='reserved'),silent:eligible.length===0};
}
export function prepareDigest(s:WorkbenchState,now:Date,id:string) {
  const rows=notificationSummary(s).digest.slice(0,8);
  if(!rows.length)return {send:false,reason:'no_unnotified_changes',items:[]};
  const digest:NotificationDigest={id,signalIds:rows.map(v=>v.id),status:'reserved',at:now.toISOString()};
  (s.digests??=[]).push(digest);
  for(const row of rows)row.delivery={id,status:'reserved',at:digest.at};
  return {send:true,digest,items:rows.map(v=>({id:v.id,title:v.title,summary:v.summary,next:v.next}))};
}
export function deliverDigest(s:WorkbenchState,id:string,receipt:string,now:Date) {
  const d=s.digests?.find(v=>v.id===id);if(!d)throw new Error('DIGEST_NOT_FOUND');if(!text(receipt,12000))throw new Error('RECEIPT_REQUIRED');
  if(d.status==='delivered')return {deduplicated:true};
  if(d.signalIds.some(id=>!s.signals?.some(v=>v.id===id&&v.delivery?.id===d.id&&v.delivery.status==='reserved')))throw new Error('DELIVERY_CHANGED');
  d.status='delivered';d.receipt=receipt;d.at=now.toISOString();for(const id of d.signalIds){const v=s.signals!.find(v=>v.id===id)!;v.delivery={id:d.id,status:'delivered',at:d.at,receipt};}
  return {digest:d};
}

/** Channel-independent exact draft; messaging channels have no cc or subject. */
export function normalizeReview(input: unknown): {id?:string;taskId:string;channel:string;to:string;cc:string;subject:string;body:string} {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('INVALID_REVIEW');
  const r=input as Record<string,unknown>;
  if(!['taskId','channel','to','body'].every(k=>text(r[k],20000)) || ['cc','subject'].some(k=>r[k]!==undefined&&typeof r[k]!=='string') || (r.id!==undefined&&!text(r.id)))throw new Error('INVALID_REVIEW');
  return {...r,cc:r.cc??'',subject:r.subject??''} as ReturnType<typeof normalizeReview>;
}
