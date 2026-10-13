
## v7: six intelligence capabilities

All fields are additive. Old records and paused/completed tasks remain intact.

- `Command.interpretation`: `kind` (`task|followup|context|preference|discussion|suggestion|clarify`), human `summary`, verbatim `quote` from this command, existing `taskIds`, real `receipt`, server `at`. This records understanding; it does not create a task or grant authorization. Correction is a new user instruction.
- `Task.plan.prepareWhileWaiting`: explicitly opt into read-only preparation for a user-owned `material|clarify|choose` step. `plan_pull` returns `purpose=preparation` with current `need.id`; the shared five-task budget still applies. `claim_task` uses this purpose. Preparation cannot overwrite the user's question, choice, ownership or approval.
- `Task.preparation`: stable `id`, `kind=draft|options|brief`, human `title/summary/body`, `status=ready|needs_info`, `missing[]`, actual existing `sourceIds[]`, current `handoffId`, server `createdAt`, genuine `receipt`. `record_preparation` requires an unexpired matching lease and current continuation ID. A prepared draft is never a sent message. Exact external drafts still use the existing versioned review flow.
- Dependency links use existing `plan.dependsOn`; referenced tasks must exist and cycles are rejected. The detail page shows both prerequisite and downstream tasks. Related topics are not automatically hard dependencies.
- `capabilities[]`: stable connection/session `id`, human `label`, `environment=cloud|local_mac`, `status=available|blocked|not_checked`, concrete `step/reason/next`, real `checkedAt` only for an actual check, `receipt`, existing `sourceIds[]`, affected `taskIds[]`. A record is neither a live connection nor a permission grant. Different cloud sessions are separate scopes; unavailable Mac does not hold the cloud queue.
- `digests[]`: stable batch `id`, at most eight `signalIds`, `status=reserved|delivered`, `at`, actual delivery `receipt`. `prepare_digest` atomically reserves eligible ordinary changes; `send=false` means no new notification. `record_digest_delivery` finishes the same batch; individual delivery must not bypass the batch. Reservation is not delivery or reading; uncertain deliveries are reconciled before retry.
- `WorkPreference.status=active|inactive`, optional provenance `history[]`. User controls can save/edit/adopt/stop preferences with the actual new user quote. Only active `user_instruction` preferences inform planning; DOT suggestions are separate. An old source cannot reactivate a stopped preference or downgrade a user instruction to an inference. No global memory writes.

New tools: `record_command_intent`, `record_preparation`, `record_capability_check`, `notification_summary`, `prepare_digest`, `record_digest_delivery`. All source-derived writes remain ordinary private-workbench records. No automatic scheduler creation, resumption, external sending or invented default follow-up fields.

### v7 integration repair

Messaging review inputs require exact `taskId/channel/to/body`; `to` is a string. Omitted cc/subject normalise to empty strings (not inferred values). Persisted reviews still carry both fields for the exact-content hash. New review creation invalidates prior pending/approved drafts and their approvals. `Task.activeReviewId` binds the current draft, including after user approval returns ownership to DOT; stale approval execution is rejected. Only review tools change this binding.

Prepared content awaiting further records is displayed as “还缺一点资料”; a ready unbound draft is “草稿先给你看”. Neither is treated as waiting for an external reply. After binding the same exact body to formal review, the UI uses the review card instead of duplicating the preparation body.
# 给 DOT 修改意见

审核页保留自己编辑全文，并增加原话意见框和“让 DOT 改一下”。提交写入 `Task.reviewFeedback={id,reviewId,version,contentHash,text,createdAt,handoffId}`，绑定本人实际看过的草稿；本人 decision 保留完整原话。草稿正文不由前端自动改写，也不批准或发送。撤回当前批准，复位 review 步骤，生成新 queued handoff，同一个任务交回 DOT。

DOT 按最新意见修改，使用新的稳定 review ID 调用 `create_review`，新版继续等本人准确批准。旧稿、旧批准不能执行；并发换稿时保留意见，需本人看过新版后再提交。传输失败和冲突不冒充已交给 DOT，提交 ID 让重复重试不会生成第二次交接。活跃租约或已开始执行时不假装可以撤回。

