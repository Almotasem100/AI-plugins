# Subscription usage

A ZadLoop bundle that shows Claude and ChatGPT subscription usage beside the context indicator. Open the button to fetch the current 5-hour and weekly limits; use Refresh to request them again. It makes no background usage requests and does not involve a model.

The host finds eligible ZadLoop OAuth records for Claude and ChatGPT, including custom routes. It shows usage only when exactly one eligible record is found for a provider; otherwise it reports usage as unavailable rather than choosing between accounts. It does not determine the current session's selected route, so a unique saved account is not proof that it is the account currently selected in the session. Tokens and account identifiers stay in the host and are not sent to the interface. The provider usage endpoints are undocumented and may change. If a token expires, use the corresponding model once to refresh it or sign in again; this bundle does not refresh or change credentials.

Install this directory as a local bundle through ZadLoop's Plugin Manager. To run offline checks from this directory:

```sh
npm test
```
