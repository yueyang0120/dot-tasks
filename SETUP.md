# Install DOT Tasks

## Copy into your agent chat

```text
帮我安装这个工作台：https://github.com/yueyang0120/dot-tasks。按 README 完成安装，需要我操作时再叫我。
```

Use a chat with Sites and your own DOT available. The agent should read the repository before running installation steps. If the chat cannot read GitHub, attach the source ZIP. For a local demo only, use the one-command installer in [README](README.md#one-command-local-demo).

## Agent installation instructions

Obtain a clean copy of this repository in a new directory, then follow these instructions. Preserve existing installations and their data.

```text
Install DOT Tasks from this repository for me.

Read AGENTS.md, README.md, docs/CONNECT-DOT.md and the installed Sites skill.
Check that I can create private Sites and use my own DOT. If a required
capability is unavailable, explain what is missing; do not substitute an
unprotected public endpoint.

Create a new owner-private Site and independent D1 database from this clean
template. Do not reuse another person's Site ID, records or runtime state.
Persist the newly returned Site ID in .openai/hosting.json. Use the Sites
workflow to install, build, validate and deploy. Keep production demo mode
disabled. Verify the production URL and empty database.

Reuse the Site-generated private MCP plugin. Check whether it is already
connected; if not, guide me through installation. Verify read_workbench and
list_inbox through my DOT's actual tools. Opening the webpage is not proof.

Tell DOT the two goals: organize my actual to-dos into P0/P1/P2 with reasons,
then autonomously advance authorized ready work. Preserve my edits and pauses.
Read the latest agentContract on every pull.

Run synthetic tasks first: intake a few to-dos with known priorities, check
persisted records, return a fictional draft, receive feedback from the page,
then return a new unapproved draft to the same task. Read back all results.
Do not send an external message during the test.

Prepare the cloud-pull instruction from docs/AUTONOMY.md. Ask me to choose
whether and when to enable it; do not assume a frequency. After I authorize
it, save and read back the actual schedule, then verify a scheduled run with
the page closed. Do not use a laptop loop as cloud execution.
```

This prompt authorizes the reader's private deployment. It is guided setup, not a universal installer; account capabilities and real execution still need verification.
