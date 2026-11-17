# ZadLoop subscription usage — implementation and verification

Status: **review fixes implemented.** The local bundle is installed in the active `web` profile. The owner
reported that the updated popup works after restarting ZadLoop. Automated failure-path tests remain offline.

## Goal

A button in ZadLoop that, when pressed, shows the current subscription usage for **Claude** and **ChatGPT**:
5-hour window percent and reset time, weekly window percent and reset time. No polling, no model involved.

## What was verified (2026-11-15, Windows, throwaway script outside the repo)

| Question | Result |
| --- | --- |
| Does ZadLoop store subscription logins? | Yes. Windows Credential Manager, service `com.zadloop.desktop.credentials:records`, accounts `llm-pi-ai/anthropic` and `llm-pi-ai/openai-codex`. Both hold OAuth `access`/`refresh`/`expires`; the ChatGPT record also has `accountId` and is split into chunks (`dshKeyringChunks`). |
| Claude usage endpoint | `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <access>` and `anthropic-beta: oauth-2025-04-20` returned **200**. The implementation reads `five_hour.{utilization,resets_at}` and `seven_day.{utilization,resets_at}`; other fields are ignored. |
| ChatGPT usage endpoint | `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer <access>` and `chatgpt-account-id: <accountId>` returned **200** once the token was fresh. The implementation identifies 5-hour and weekly windows by `limit_window_seconds` and reads `used_percent` and `reset_at`. The response can also contain an email and account IDs, which the plugin must never display or log. |
| Expired token | ChatGPT returned `401 token_expired` while the stored access token was stale. ZadLoop refreshed it when the ChatGPT model was next used. The probe did not refresh (refresh-token rotation could break the app's login). |
| Does the sidebar-browser route work? | No: the usage pages redirect to login because the sidebar browser has no website session. Rejected. |

## Verification and limitations

1. The host reads OAuth records through `ctx.credentials.readRecord`; that method does not refresh tokens. The plugin
   reports an expired token rather than rotating it.
2. The authenticated connection fetch route and `conversation.composer.dock` slot are the host/client integration
   points. The owner reported the changed popup working after restarting ZadLoop.
3. Both endpoints are undocumented and may change or reject non-official callers.
4. Account routing: the extra observed `openai-codex` keyring entries were chunks of one record, not evidence of
   multiple accounts. The implementation uses a unique eligible OAuth record per vendor, including custom routes;
   it fails closed on ambiguity. It cannot prove that the unique saved account is the current session selection.

## Implementation

Package `@local/usage-panel` (private, local bundle, same layout as `donald-duck`: `package.json` with `dsh.bundle` and
`dsh.client`, `cordis.patch.yml`, `locale/en.json`, `test/`).

- **Host half**
  - The authenticated connection fetch route `/api/usage-panel` uses a unique eligible OAuth route for each provider
    per user request and returns only allowlisted statuses, percentages and reset times.
  - `status` is one of `ok | not-signed-in | token-expired | unavailable | unexpected-format`.
  - Provider operations time out after 10 seconds; concurrent requests share the in-flight operation. Responses use
    `no-store`; there is no background polling.
  - Tokens stay in the host process: never logged, never returned to the client, never included in error text.
- **Client half**: a composer-dock button and a small popover with 5-hour and weekly usage per provider (percent bars and reset times),
  a refresh action, and a plain-language message for each non-`ok` status. Nothing renders account identifiers.
- **Tests (offline)**: parser against synthetic response fixtures; each status path; a redaction test that
  fails if a token, email or account ID appears in output or logs; fake `fetch` and fake credentials service.

## Risks

- Internal endpoints can change without notice → allowlist parsing, `unexpected-format` status, no hard dependency.
- Using subscription OAuth tokens for a non-official call may not match vendor expectations → single user-initiated
  request per click, no polling.
- Token handling → least privilege, host-only, covered by the redaction test.

## Decisions (owner, 2026-11-15)

- Show **both** the 5-hour and the weekly limits.
- Placement: a button beside the context-usage indicator in `conversation.composer.dock`. The popup uses a portal to
  the document body because the docked composer clips overlays.

- Accounts: the owner uses one account per provider and does not need multiple-account selection. The unique-record
  approach remains conservative; determining the current session's selected account is outside the requested scope.
