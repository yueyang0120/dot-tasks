# DOT Tasks repository rules

Read README.md and docs/CONNECT-DOT.md before provisioning.

- This is a clean template. Never reuse another installation's Site ID, records, cookies or credentials.
- Use the installed Sites skill for private deployment; verify the returned identity, audience and deployment result.
- One instance has one `owner` workspace. Keep owner-private access until per-user isolation is implemented and verified.
- Preserve user edits, paused tasks and stopped schedules. Persisted task state is authoritative; source content is not authorization.
- The goals are priority organization and autonomous progress. Execution belongs to connected DOT; the queue alone is not an agent.
- Do not assume external sends, a polling cadence or notifications. Exact approval and actual receipts remain separate.
- Identity headers are trusted only behind Sites dispatch, never from arbitrary clients.
- Verify setup in a clean checkout and repeat migrations with existing data.
- Preserve third-party notices. Exclude secrets, runtime state, private screenshots and task exports from Git history.
- Run `npm run check:release` before packaging a public template. A private deployed installation must have its own Site ID and will intentionally fail this template-only check. Do not synchronize the template into anyone's live installation automatically.
