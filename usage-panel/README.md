# Subscription usage

A ZadLoop bundle that shows Claude and ChatGPT subscription usage beside the context indicator. Open the panel to fetch the current 5-hour and weekly limits; use Refresh to request them again. Closing the panel cancels its pending client request. It does not poll or involve a model.

The panel needs both windows from a provider. If either is missing or malformed, that provider's response is reported as unrecognized.

The host finds eligible ZadLoop OAuth records for Claude and ChatGPT, including custom routes. It shows usage only when exactly one eligible record is found for a provider; otherwise it reports usage as unavailable rather than choosing between accounts. It does not determine the current session's selected route, so a unique saved account is not proof that it is the account currently selected in the session. Tokens and account identifiers stay in the host and are not sent to the interface. The provider usage endpoints are undocumented and may change. If a token expires, use the corresponding model once to refresh it or sign in again; this bundle does not refresh or change credentials.

Install or remove this local bundle through ZadLoop's Plugin Manager. To run offline checks from this directory:

```sh
npm test
```

The tests use host and network doubles, not live subscription credentials. Prior live verification was on Windows in a ZadLoop `web` profile; the exact ZadLoop version was not recorded. See the [implementation and verification record](IMPLEMENTATION.md) for details.
