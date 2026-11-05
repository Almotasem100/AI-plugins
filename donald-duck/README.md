# Donald Duck

A local ZadLoop/DSH bundle that displays the user-supplied transparent [Donald Duck PNG](assets/donald-duck.png) in the frame-wide `shell.overlay` layer. It glides around the workspace with a gentle bob; drag it with the mouse to place it anywhere in the window. After placement it stays at that position while gently bobbing until the page reloads. The animation respects reduced-motion preferences.

The bundle package ID is `@local/donald-duck`. Node.js 20 or later is required for the build and offline tests.

## Move the duck

- Drag with the primary mouse button; another pointer cannot take over an active drag.
- Focus the duck with Tab, then use arrow keys to move 10 pixels, or Shift + arrow keys to move 30 pixels.
- Placed ducks stay within the window when it shrinks. Losing window focus cancels an active drag.
- Placement lasts until the page reloads. Gentle hovering continues after placement; reduced-motion preferences disable animation.

## Install

Install this directory as a local bundle through ZadLoop's Plugin Manager. The profile links to this checkout, so reinstall the bundle from the new path if you move the repository.

## Artwork and build

Replace `assets/donald-duck.png` with a transparent PNG and update `assets/donald-duck-icon.png` with a matching square crop, then run `npm run build` from this directory. The build embeds the character image in `client.js` so no separate image server is needed. Edit `client.source.js`, not the generated `client.js`. Restart ZadLoop to load updated code if it is not refreshed live. The image is contained without stretching or cropping; individual body parts are not animated. The Plugin Manager icon is a square head-and-beak crop of the same transparent artwork.

The artwork is user-supplied, not original plugin artwork; obtain appropriate rights before distributing it.

## Test

Run `npm test` from this directory; it rebuilds the client first. Checks cover bundle metadata, the displayed PNG bytes, disabled native image dragging, and interaction regressions using React/browser boundary doubles: element dimensions, grab offsets, window edges, multiple pointers, release, focus-loss cancellation, keyboard movement, resizing, and listener cleanup. These checks do not render the overlay or verify mouse interaction in the running app.
