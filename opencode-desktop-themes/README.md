# OpenCode Desktop themes

A GUI-only plugin originally written for OpenCode Desktop 2.2.6. Midnight Purple, Ocean Blue,
Emerald Night, Warm Sunset, Clean Light, and Midnight Workspace appear in the
native theme picker. Each includes light and dark palettes; Desktop's appearance
mode determines which is displayed. Choose Dark mode for the night-themed
palettes and Light mode for Clean Light. Syntax, diff, and UI colors are derived
by Desktop from each palette.

Midnight Workspace uses a graphite-navy base (`#111620`), elevated composer
surface (`#1b2331`), and a lighter shared surface (`#252e3e`) for user bubbles
and code. Its soft violet accent (`#b9abf3`) and restrained semantic colors
create a cohesive workspace without custom CSS. These are shared native tokens:
other elements can use the same surfaces, and the sidebar and conversation may
share the base color. The Theme API does not provide independent layout or
per-element styling controls. GUI APIs are experimental and may change; the
2.3.0 token mappings have been inspected but not visually verified.

The plugin uses the experimental `Theme` registry and has no build step,
external runtime dependencies, telemetry, or network requests. The single
CommonJS entry is the source and the bundle.

## Activate

After deciding to install, add this repository's **absolute** plugin-directory
path to the existing `plugins` array in your global
`~/.config/opencode/opencode.json` or `opencode.jsonc`, preserving other entries.
For example, on Windows (replace with your actual path):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/AI-plugins/opencode-desktop-themes"]
}
```

Open **Settings > Appearance > Theme** and select a theme. Check
**Settings > Extensions > Plugins** if it is not listed. To disable, use that
plugin switch or remove its path from the configuration. Desktop falls back to
its default while the selected plugin theme is unavailable; its choice can
return when the plugin is re-enabled.

## Development and verification

Run `npm --prefix opencode-desktop-themes test` from the repository root.
The offline test executes setup with a mock GUI SDK and checks registration,
palette structure, base ink contrast, and Midnight Workspace's explicit dark
surface/palette contrast. It does not run Desktop's palette
generator or verify rendered text, syntax, diffs, selections or controls.
Manually check those surfaces in both appearance modes, theme switching, and
disable/re-enable behavior in Desktop before relying on these themes.

To add a theme, add an entry with a unique lowercase hyphenated `id`, a `name`,
and `light` and `dark` palette variants in `gui-experimental.cjs`, then update
the registration test. See the [GUI theme API](https://opencode.ai/docs/build/plugins/gui#themes).
