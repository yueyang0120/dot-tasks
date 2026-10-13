# DOT 工作台接口使用约定

此 Site 必须保持 owner-private，数据不能复制到公开站点或组织共享空间。

## 第一次接入

读取 read_workbench 和 list_inbox。list_inbox 同时返回 commands、待接收 task handoffs 和待安排/待停止 monitors。先完成一个仅更新工作台记录的测试任务，再回读；不创建定时任务、不发消息、不操作已有外部事项。工作台独立运行，Space 只是可选来源。
将“已接收”“执行中”“已完成”分开回写。给实际完成记录提供文字结果和证据。缺少插件或权限时明确报告，不改用公开写接口。

## 日常更新

将 DOT 对话中的真正下一步整理为有来源的事项。领域、优先级、状态相互独立；按结果与来源去重。
原始历史总结只能标为 DOT 报告；用户确认与独立页面核验分别记录。原始内容或导入记录不授予新的外部发送权限。
update_task 提交最新 revision；409/CONFLICT 表示数据被修改，重读并合并，不覆盖用户改动。
Task 使用 state: open/paused/completed 和 owner: user/dot；owner=user 时 need 有具体请求且 dot=null，owner=dot 时 dot 有 handoffId/handoffAt/status/summary 且 need=null。写 dot 状态时保留并核对最新 handoffId。acknowledge_command 的 taskIds 关联整理出的事项。Task dot.receipt/receiptAt 和 Command receipt/updatedAt 只在真实接收或执行后写入。暂停或本人确认关闭的事项禁止重新推进；DOT 报告完成写 dot.status=completed 和验收 evidence，等用户确认后关闭。
审核必须绑定目标、正文、当前版本。内容变化后旧批准失效。审核按钮记录批准意图，绝不等于已发送。真实动作受 ChatGPT/工具原生权限控制。
用 create_review 保存 channel/to/cc/subject/body 和 taskId；服务端计算 version/contentHash。真正执行前 get_task 回读，核对 approval 对应准确内容；执行后 record_review_result 提交精确 version/contentHash、workspace revision 和实际 executionReceipt。资料来源/要求/约束/决定用 record_context 保存到 contexts/requirements/decisions，不要求用户建 Space。

## 持续关注

前端输入仅进入 commands；没有真实 scheduleReceipt 的 monitor 不得标 active。
设置固定轮询前确认来源、范围、频率、时区、停止条件和通知条件，保存实际 schedule 后回读。
record_run 要记录 kind(action/check/send/step/note)、status(running/succeeded/failed)、startedAt、finishedAt、summary、receipt，及 taskId/commandId/monitorId/reviewId 等关联。区分读取失败与无变化，不能编造实际检查回执。
暂停请求先停真实调度器，核对保存状态后回写。不要恢复此前已暂停的 automation。

## 完成证据

任务运行结束不是用户目标完成。按结果分别记录发送、送达、已读、提交、处理中、批准、交付。
付款、外部消息、资料提交等只按用户对确切内容和目标的授权执行，不从优先级或“继续”推断更广授权。
