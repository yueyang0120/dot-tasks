# Connect your own DOT

## Requirements

- Your own account/workspace with DOT and Sites available.
- Codex or ChatGPT Work able to build and publish a private Site.
- Your connected sources, only when a task needs them. The first synthetic test needs no email or calendar access.

Feature availability varies. [Sites](https://learn.chatgpt.com/docs/sites) explains access controls. [Scheduled tasks](https://learn.chatgpt.com/docs/automations) explains cloud runs.

## Deploy a private instance

Use [SETUP.md](../SETUP.md). Start from clean source, not a deployed Site or database export. `.openai/hosting.json` intentionally omits `project_id`. Sites assigns a new one during provisioning. It declares D1 binding `DB` and MCP capability.

Use the installed Sites skill for registration, source preparation, builds, migrations, deployment and readback. Keep owner-private access: the schema has one workspace keyed `owner`; widening access shares records. A local build alone is not deployment.

## Connect its generated plugin

Publishing with MCP capability creates a private Site plugin. Reuse it; do not create a second bridge or put cookies in this repo.

1. Check whether the tools are already installed and available.
2. If missing, inspect the Site's MCP connection metadata and use the supported plugin installation prompt. The UI may show it under Plugins → Personal → Created by you. A new conversation may be needed.
3. Ask your actual DOT to call `read_workbench` and `list_inbox`.
4. Verify the response is from your new instance and contains `agentContract`.

Sites authenticates requests. Manually injected identity headers are a local fixture, not proof of real DOT connection.

## First acceptance test

Use fictional notes with example.invalid recipients and no external sends:

- Prepare a project checklist for tomorrow; use P0 for this test.
- Research options for a fictional team lunch; use P1.
- Collect future desk ideas; use P2, no deadline.

Check separate tasks, sources, priorities and next steps. Ask for a fictional draft on one task. Give revision feedback in the page. DOT must read it, change the body, create a new review, release its claim and read back. The new draft stays unapproved and unsent. Reload to verify persistence. Pause test tasks when done.

## Cloud progress

Choose a supported frequency and explicitly enable a cloud schedule using [AUTONOMY.md](AUTONOMY.md). Save and read back its enabled state. Verify a genuinely scheduled run with the page closed. A manual run tests the executor, not the timer.

Use your private hosted instance: localhost does not become reachable to a cloud DOT just because a dev server starts. Optional local computer access should use DOT's supported controls; keep unrelated cloud work independent of the laptop.

| Visible state | Next step |
| --- | --- |
| Demo banner | Fictional temporary data; DOT not connected |
| No DOT update | Verify plugin and actual DOT tool access |
| 401 | Re-open the private Site and authenticate |
| Revision conflict | Re-read and merge, preserving user input |
| Feedback saved, no new draft | Inspect actual execution and cloud schedule |
| Source login needed | Restore that source; unread does not mean no reply |
| Waiting for a device | Continue unrelated cloud work |

The recipient's account, plugin and timer require their own checks. No credentials or live schedules ship in this repository.
