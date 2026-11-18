# Contributing

## Package boundaries

- Treat each top-level plugin directory as an installable unit. OpenCode loads the exports in its `package.json`; ZadLoop uses the bundle metadata and patch in its package. Keep directory paths, package and plugin IDs, exposed entries, and host contracts stable unless you document a migration.
- The root `package.json` runs checks; it does not install the plugins as a workspace. Avoid runtime imports from sibling plugins. Similar features may use different host APIs, authorization, or lifecycle rules; share behavior only if both packages can still be installed independently.
- Keep host registration, authentication, and UI at their respective boundaries. In usage panels, credentials stay server-side; only sanitized results reach the UI. Use fake processes, fetch implementations, and host doubles in automated tests.
- Keep OpenCode Desktop's `gui-experimental.cjs` entries self-contained. If you change the usage panel RPC, update both its server definition in `opencode-usage-panel/src/rpc.js` and the GUI copy. The offline GUI suite checks that their schemas match.
- Keep experimental work out of the production entry points. For current setup and behavior, use the plugin README and source. Existing `HANDOFF.md`, `IMPLEMENTATION.md`, and `TASK-CONTEXT.md` files retain dated verification evidence and design context; they do not establish compatibility with new host releases.

## Adding a plugin

1. Give it its own directory and package manifest. Export only the parts the target host loads. Keep runtime files and assets inside that directory.
2. Add a README covering the target harness, tested versions, install/remove steps, external dependencies, and any permissions or credential requirements.
3. Give the package an offline `npm test` script. Test through the registered handler or entry point when practical, including a failure or cleanup path if one matters.
4. Add it to the root README and root `test` script. If a host loads a built artifact, document how to regenerate it and check that the committed artifact is current.

## Before handing off a change

Run `npm test` and `git diff --check`. For Donald Duck, edit `client.source.js` or the assets, run `npm --prefix donald-duck run build`, and commit the resulting `client.js` with the source change. Its test checks for drift without rewriting the bundle.

Offline checks do not prove plugin loading in a real host. When changing a host integration, use an authorized test profile to verify that the installed plugin loads, its main action works, and disabling or reloading it leaves no stale UI or background work. For provider changes, verify text, image support where applicable, and cancellation; for usage panels, verify opening and refreshing with the intended connection. Record the host/CLI version and what you actually observed. Do not include tokens, prompts, or raw provider diagnostics.
