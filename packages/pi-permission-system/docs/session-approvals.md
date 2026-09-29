# Session-Scoped Approvals

When a permission resolves to `ask`, this fork offers two options:

```text
Yes | No
```

The prompt shows the effective session grant separately from the options.
**Yes** approves the current request and records the displayed wildcard pattern as a session rule.
Subsequent requests that match that rule skip the prompt for the remainder of the session.
**No** opens the denial-reason input and sends the submitted reason to the agent.
Canceling never approves a request.

Session approvals are ephemeral: they are never persisted to disk and are cleared on `session_shutdown`.
A forwarded subagent request retains a separate scope choice: the requesting subagent only, or the whole serving session.
The default is the requesting subagent only.

## Grant Direction

The `path` and `external_directory` surfaces carry independent read and write permissions.
For an ask whose paths all prove the same direction, **Yes** grants both directions for the displayed patterns.
For example, approving a write to `/tmp/out.txt` can also cover a later read in the displayed `/tmp/*` scope.

```text
Yes, allow reads and writes to "/tmp/*" for this session

  (y) Yes
  (n) No
```

The family grant applies only to the permission surface and patterns shown, not unrestricted file access.
Other permission surfaces still apply.
Session rules take precedence over configured rules on the same surface, including narrower denials within the approved pattern.
A session grant is therefore broader than a one-call approval; inspect the displayed pattern before selecting **Yes**.

A mixed-direction request, such as `cat /outside/a.ts > /elsewhere/b.ts`, retains its per-path directions because the existing grant model provides no combined-width option.
Surfaces with no direction axis (`bash`, `mcp`, `skill`, and per-tool surfaces) retain their existing session-pattern scope.
Two paths in the same directory can derive the same wildcard pattern.
Read the displayed grant before approving it.

The review log records `sessionGrantWidth: "proven"` or `"family"` for each session grant.

## Suggested Patterns

The suggested pattern is surface-specific:

| Surface                         | Example request              | Suggested session pattern |
| ------------------------------- | ---------------------------- | ------------------------- |
| bash                            | `git status --short`         | `git status *`            |
| mcp (qualified)                 | `exa:search`                 | `exa:*`                   |
| mcp (munged)                    | `exa_search`                 | `exa_*`                   |
| skill                           | `librarian`                  | `librarian`               |
| path                            | `src/.env`                   | `src/*`                   |
| tool with path (read, write, …) | `read` for `src/foo.ts`      | `src/*`                   |
| tool catch-all                  | `read` (no extractable path) | `*`                       |
| external_directory              | `/other/project/src/foo.ts`  | `/other/project/src/*`    |

## Bash Arity Table

Bash pattern suggestions use a curated arity dictionary (`src/access-intent/bash/bash-arity.ts`) to determine how many tokens define the "human-understandable subcommand."
Longest matching prefix wins, so `npm run` (arity 3) takes precedence over `npm` (arity 2).
Unknown commands default to arity 1 (first word only).

| Example command       | Arity entry matched  | Suggested pattern     |
| --------------------- | -------------------- | --------------------- |
| `git checkout main`   | `git` → 2            | `git checkout *`      |
| `npm run dev`         | `npm run` → 3        | `npm run dev*`        |
| `npm install lodash`  | `npm` → 2            | `npm install *`       |
| `docker compose up`   | `docker compose` → 3 | `docker compose up *` |
| `rm -rf node_modules` | `rm` → 1             | `rm *`                |
| `mytool --verbose`    | (unknown) → 1        | `mytool *`            |

The arity table covers common CLI tools including git, npm/pnpm/yarn/bun, docker, cargo, go, kubectl, gh, and others.
To add an entry, open `src/access-intent/bash/bash-arity.ts` and add a key/arity pair to the `ARITY` object.
Put the most specific multi-word prefix first (e.g. `"npm run": 3`) before the shorter fallback (`"npm": 2`).

## Review Log Entries

The review log records session approval decisions:

- `resolution: "approved_for_session"` — when the user approves with the session pattern
- `sessionGrantWidth: "proven" | "family"` — beside it, the direction width the grant was recorded at (see [Grant direction](#grant-direction))
- `resolution: "session_approved"` — when a later request is matched by an existing session rule

## Permission Prompt Summaries

When a tool permission resolves to `ask`, the prompt is designed to be readable enough for an informed approval decision:

- `bash` prompts show the command and matched bash pattern when available.
- `mcp` prompts show the derived MCP target and matched rule when available.
- Built-in file tools show concise summaries, such as the target path and edit/write line counts, instead of raw multiline JSON.
- Unknown or third-party extension tools show a bounded single-line JSON preview of the input so users are not asked to approve a blind tool name.

Example edit approval prompt:

```text
Current agent requested tool 'edit' for '.gitignore' (1 replacement: edit #1 replaces 5 lines with 2 lines). Allow this call?
```
