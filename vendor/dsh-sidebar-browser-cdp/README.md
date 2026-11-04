# dsh-sidebar-browser-cdp

Provenance record for the third-party DSH Desktop sidebar-browser plugin installed in the ZadLoop profile. This directory records the published package and source revision; it does not contain the plugin source or install it into other DSH profiles.

- **Purpose:** Agent tools for controlling DSH Desktop’s built-in right-sidebar browser.
- **Package:** `dsh-sidebar-browser-cdp@0.3.0`
- **npm package:** [dsh-sidebar-browser-cdp 0.3.0](https://www.npmjs.com/package/dsh-sidebar-browser-cdp/v/0.3.0)
- **Upstream repository:** [alesha-pro/dsh-sidebar-browser](https://github.com/alesha-pro/dsh-sidebar-browser)
- **Package directory:** `plugin/`
- **Published source commit:** [`21279fcf2d7c7d8b4b301d7af3d4c5b09f2ce8e1`](https://github.com/alesha-pro/dsh-sidebar-browser/commit/21279fcf2d7c7d8b4b301d7af3d4c5b09f2ce8e1) (`gitHead` for npm version 0.3.0)
- **License declared by package:** MIT
- **npm tarball integrity:** `sha512-5pgWleWSb9EiDL6DH4FIlvaDRlwr3AVDDKUp5T+LG7AVrOeGq43/HXV01dwQCKt+XsfjtU1jEXuvCJECJgJq+w==`
- **npm tarball SHA-1:** `142083b194bdacc845c67259870e047396c9f920`
- **Install spec:** `dsh-sidebar-browser-cdp@0.3.0` via ZadLoop’s Plugin Manager; this is a profile installation, not a dependency of this repository.

## Verification

Verified in ZadLoop on 2026-11-04 on Windows: opened a test page in the sidebar, navigated the same tab to another URL, and confirmed the page with `browser_snapshot`. The test tab was closed afterward. The upstream [requirements](https://github.com/alesha-pro/dsh-sidebar-browser#requirements) state that Windows is not tested; this smoke test does not establish full compatibility of all plugin tools.
