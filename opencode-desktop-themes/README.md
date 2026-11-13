# OpenCode Desktop themes

A GUI-only plugin for OpenCode Desktop 2.2.6. Midnight Purple, Ocean Blue,
Emerald Night, Warm Sunset, and Clean Light appear in the native theme picker.
Each includes light and dark palettes; Desktop's appearance mode determines
which is displayed. Choose Dark mode for the four night-themed palettes and
Light mode for Clean Light. Syntax, diff, and UI colors are derived by Desktop
from each palette.

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
palette structure and base ink contrast. It does not run Desktop's palette
generator or verify rendered text, syntax, diffs, selections or controls.
Manually check those surfaces in both appearance modes, theme switching, and
disable/re-enable behavior in Desktop before relying on these themes.

To add a theme, add an entry with a unique lowercase hyphenated `id`, a `name`,
and `light` and `dark` palette variants in `gui-experimental.cjs`, then update
the registration test. See the [GUI theme API](https://opencode.ai/docs/build/plugins/gui#themes).
