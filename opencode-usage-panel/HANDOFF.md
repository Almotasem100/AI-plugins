# OpenCode subscription usage — verification record

## Outcome

OpenCode Desktop 2.3.0 displays an on-demand statistics icon beside the context indicator. Its popup shows Claude and
ChatGPT 5-hour and weekly usage percentages and reset times, with a manual Refresh action. It does not poll or use a
model. The owner reported that the layout looks good and provided a screenshot showing both providers' live usage in
the redesigned popup.

## Implementation and limitations

- The GUI contributes to `session.header` and calls a server RPC for the current session. The server resolves active
  OpenCode connections and returns sanitized statuses and usage data; credentials are not sent to the GUI.
- OpenCode may refresh OAuth credentials when resolving a connection. ChatGPT requires a supported Codex browser or
  device-code OAuth method with an account ID; `chatgpt-token-sharing` is not supported without further evidence.
- The provider endpoints and OpenCode GUI APIs are experimental or undocumented and may change. Provider policy may
  restrict use of subscription OAuth by third-party tools. A credential lookup that never settles remains single-flight;
  restarting the OpenCode host is the recovery if it remains stuck.
- The GUI uses a 15-second deadline; provider operations use a 10-second deadline. Both RPC definitions declare the
  required `events` and null input schema, and the GUI passes `null`.
- The existing ZadLoop panel retains its conservative account safeguards. The owner uses one account per provider and
  does not require multi-account selection; see `usage-panel/IMPLEMENTATION.md`.

## Verification and remaining checks

- `npm test` in `opencode-usage-panel/` passed 21 offline tests. They use fake credentials, network responses, and GUI
  components; they do not exercise OpenCode Desktop or real provider endpoints.
- The owner's screenshots show both providers' usage and reset times in Desktop, including the redesigned header popup.
  Desktop Refresh, keyboard interaction, light mode, and failure paths have not been separately confirmed.
- The owner separately reported successful Gemini image requests in OpenCode and ZadLoop. This confirms only the
  exercised paths, not all models, host compatibility, errors, cancellation, or tool-bridge behavior.
