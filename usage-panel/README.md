# Subscription usage

A ZadLoop bundle that shows Claude and ChatGPT subscription usage beside the context indicator. Open the panel to fetch the current 5-hour and weekly limits; use Refresh to request them again.

A successful response replaces the displayed result and records when it was checked (**Last checked**). While a refresh is pending, the previous result stays visible. If a refresh fails, times out, or returns an unrecognized response, that previous result stays visible and is marked **Stale**; a failure before the first result shows the load error instead. A later valid response always replaces the whole result, including providers that report not signed in, an expired session, unavailable usage, or an unrecognized response; per-provider windows are never kept across statuses. The client rejects responses with an unknown provider status or with malformed window data, and it renders only the fixed status messages, percentages, and reset times, never raw provider diagnostics. Closing the panel cancels its pending request and discards the displayed result, so reopening starts a fresh request and shows no old data. It does not poll or involve a model, and it keeps no stored copy.

The panel needs both windows from a provider. If either is missing or malformed, that provider's response is reported as unrecognized.

The host finds eligible ZadLoop OAuth records for Claude and ChatGPT, including custom routes. It shows usage only when exactly one eligible record is found for a provider; otherwise it reports usage as unavailable rather than choosing between accounts. It does not determine the current session's selected route, so a unique saved account is not proof that it is the account currently selected in the session. Tokens and account identifiers stay in the host and are not sent to the interface. The provider usage endpoints are undocumented and may change. If a token expires, use the corresponding model once to refresh it or sign in again; this bundle does not refresh or change credentials.

Install or remove this local bundle through ZadLoop's Plugin Manager. To run offline checks from this directory:

```sh
npm test
```

The tests use host and network doubles, not live subscription credentials. Prior live verification was on Windows in a ZadLoop `web` profile; the exact ZadLoop version was not recorded. See the [implementation and verification record](IMPLEMENTATION.md) for details.
