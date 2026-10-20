# Sktchy: Infinite Canvas

Sktchy is an infinite canvas application built with [Vite](https://vitejs.dev/), vanilla
JavaScript, and the native [Canvas 2D API](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D),
with zero canvas or graphics libraries. The canvas presents an unbounded world viewed
through a camera that supports smooth panning and cursor-focused zooming. You pick a tool
from the toolbar to draw rectangle and ellipse nodes, then move, resize, and multi-select
them, with full undo/redo and crisp rendering on HiDPI displays.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (required by Vite 5)
- npm (bundled with Node.js)

### Clone the repository

```bash
git clone https://github.com/aniket1251/sktchy.git
cd sktchy
```

If you received the project as a zip instead, unzip it and `cd` into the extracted folder.

### Install dependencies

```bash
npm install
```

Installs the project's dependencies (Vite) into `node_modules`. Run this once after
cloning, and again whenever dependencies change.

### Run the development server

```bash
npm run dev
```

Starts the Vite dev server with hot module replacement. By default the app is served at
<http://localhost:5173>. Open that URL in your browser. The server reloads automatically
as you edit files.

### Build for production

```bash
npm run build
```

Bundles and optimizes the app into the `dist/` directory, ready to deploy as static files.

### Preview the production build

```bash
npm run preview
```

Serves the contents of `dist/` locally so you can verify the production build before
deploying. Run `npm run build` first.

## Controls

Sktchy is driven entirely by the toolbar, the pointer, and a few keyboard shortcuts.
The **Select** tool is active on startup.

### Toolbar

The toolbar sits at the top-center of the screen. It holds four tool buttons followed by
three action buttons. The active tool is highlighted.

| Button        | What it does                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------- |
| **Hand**      | Drag the background to pan the canvas.                                                         |
| **Select**    | Click shapes to select, drag to move/resize, drag empty space to marquee-select. Default tool. |
| **Rectangle** | Drag on the canvas to draw a rectangle.                                                        |
| **Ellipse**   | Drag on the canvas to draw an ellipse.                                                         |
| **Undo**      | Step back to the previous edit.                                                                |
| **Redo**      | Re-apply an undone edit.                                                                       |
| **Delete**    | Remove the current selection.                                                                  |
| **Theme**     | Toggle between light and dark theme.                                                           |

A contextual hint line beneath the toolbar updates to describe what a drag will do with
the current tool and selection.

### Panning

Select the **Hand** tool and drag the background to pan. The point under the pointer stays
locked to the pointer for the whole pan.

### Zooming

- **Scroll wheel:** scroll over the canvas to zoom toward the cursor, so the world point
  under the cursor stays fixed.
- **Zoom buttons:** the `+` and `−` buttons at the bottom-right zoom about the center of
  the viewport.
- **Keyboard:** `Ctrl/Cmd + +` zooms in and `Ctrl/Cmd + -` zooms out, about the center of
  the viewport.
- **Zoom readout:** the `%` label between the buttons shows the current zoom (100% on
  startup).

Zoom is clamped to the inclusive range **10% to 1000%** (0.1x to 10x).

### Drawing shapes

1. Pick the **Rectangle** or **Ellipse** tool.
2. Press on the canvas and drag to the opposite corner; a live preview follows the pointer.
3. Release to create the shape.

A shape must be at least **2 world units** in each dimension, otherwise it is discarded on
release (so a stray click creates nothing).

### Selecting

- **Click a shape** with the Select tool to select the topmost shape under the pointer.
- **Click empty space** with the Select tool to clear the selection.

### Marquee selection

With the Select tool, drag on empty background to draw a marquee box. Every shape the
marquee touches or intersects is selected in real time as you drag, and the selection is
kept when you release.

### Moving

With the Select tool, drag a selected shape to move it. If several shapes are selected,
they all move together. A press-and-release with no movement is treated as a pure
selection and changes nothing.

### Resizing

When exactly one shape is selected, four corner handles appear at a constant on-screen
size. Drag a corner handle to resize; the opposite corner stays fixed.

### Deleting

Press **Delete** or **Backspace** (or the toolbar Delete button) to remove the current
selection. Nothing happens when no shape is selected.

### Undo / Redo

| Shortcut               | Action |
| ---------------------- | ------ |
| `Ctrl/Cmd + Z`         | Undo   |
| `Ctrl/Cmd + Shift + Z` | Redo   |
| `Ctrl/Cmd + Y`         | Redo   |

Only destructive edits (create, move, resize, and delete) are recorded in history.
Panning, zooming, and selection changes are not undoable.

### Theme

The button at the far right of the toolbar toggles between light and dark theme. The
choice is remembered across reloads, and defaults to your system preference on first
visit.

## Architecture

Sktchy is organized around one responsibility per module, with plain functions and small
stateful objects and no framework. The logic-bearing core (coordinate math, AABB
intersection, and the undo/redo invariants) lives in pure functions that can be reasoned
about directly.

| Module                | Owns                                                                                                                                                   | Does not                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `src/camera.js`       | Viewport transform state (pan offset, zoom scale), screen/world conversions, pan/zoom/center, the 0.1x to 10x scale clamp                              | Know about nodes, pointers, or history                              |
| `src/scene.js`        | The ordered node list, the node factory, hit testing, AABB intersection, and selection helpers                                                         | Know about the camera, pointers, or rendering                       |
| `src/interactions.js` | The pointer state machine: resolve one gesture per press, mutate camera/scene/history, keyboard shortcuts                                              | Draw anything                                                       |
| `src/history.js`      | Undo/redo snapshot stack, snapshot/restore, the 100-snapshot cap, redo-tail clearing                                                                   | Know when a gesture is destructive (the caller decides)             |
| `src/render.js`       | All canvas drawing (dot grid, nodes, selection, handles, draft preview, marquee); applies the DPR + camera transform                                   | Mutate any state; it is a pure function of camera + scene + overlay |
| `src/main.js`         | The wiring layer: creates the scene/camera/history, the resize + `requestAnimationFrame` render loop, tool state, and the toolbar/zoom/hint DOM chrome | Contain gesture logic (delegated to interactions)                   |

### Data flow

State and rendering are cleanly separated. Nothing draws except `render.js`, and
`render.js` draws nothing else; it only reads state. The flow for any interaction is:

1. A DOM event (pointer, wheel, key, resize, or a toolbar/zoom click) fires.
2. A handler in `interactions.js` (or `main.js` for chrome) mutates `camera` and/or
   `scene`, and at the end of a destructive gesture may `commit` a snapshot to `history`.
3. The handler calls `requestRender()` to set a dirty flag (and syncs the DOM chrome:
   zoom percentage, active-tool highlight, hint line, when relevant).
4. On the next animation frame, the `requestAnimationFrame` loop sees the dirty flag and
   calls `render.draw` exactly once with the current camera, scene, and gesture overlay,
   then clears the flag.

The separation is strict: `render.js` is pure and reads state only; `interactions.js`
never draws; `camera.js` knows nothing about nodes or history. Camera state lives in
CSS-pixel space, and the device pixel ratio is folded in only at draw time inside
`render.js`, so the camera's screen↔world conversions stay the single source of truth for
coordinate mapping.

## Design Tradeoffs

Sktchy was built to a limited delivery budget, so several choices favor simplicity and
correctness over generality. Each is a deliberate tradeoff rather than an oversight.

- **Dirty-flag render loop, not a reactive system.** A single `requestRender()` sets a
  dirty flag and one `requestAnimationFrame` loop repaints when it is set. This is far
  simpler than a reactive/observer system and is enough to keep the UI responsive, at the
  cost of no fine-grained change tracking.
- **Full-scene JSON snapshots for history, not diffs or commands.** Each destructive
  gesture commits a `JSON.stringify` snapshot of the whole node list, capped at 100
  entries. This is trivial to reason about and correct by construction, trading memory
  efficiency and granularity (no per-property diffs or command objects) for simplicity.
- **Immediate-mode redraw of the whole scene each frame.** Every dirty frame clears and
  repaints the entire scene rather than tracking retained objects or dirty rectangles.
  This keeps `render.js` a pure function of the current state; the tradeoff is redundant
  drawing work that is negligible at this scale.
- **Uniform axis-aligned bounding box (AABB) for every shape.** Rectangles and ellipses
  share one `{x, y, w, h}` model, so hit testing, resize, and marquee intersection have a
  single code path. The tradeoff is no rotation and no non-AABB geometry.
- **No automated tests.** Given the budget, behavior is verified manually by running
  `npm run dev` and observing each gesture. The logic-bearing math is isolated in pure
  functions so it can be reasoned about by hand, but there is no test suite.

## AI Usage

I used AI for boilerplate generation, as a typing aid, and to explore new aspects of the
problem.

## Assumptions

The brief's phrase **"custom geometry routing"** is interpreted as **transform and
coordinate geometry** rather than connectors or routed edges between shapes. Concretely,
that means the hand-written transform math (screen/world conversions, pan, zoom-to-cursor)
together with a **uniform AABB model** used for hit testing, selection, and resize, all
implemented without a graphics library.

Connectors / edges between shapes are explicitly **deferred and out of scope** for this
delivery. Keeping a uniform AABB node model keeps hit testing, resize, and marquee
intersection simple and correct within the budget; adding connectors would introduce a
second element type with endpoints and break that uniform model. If connectors were the
intended reading, they are treated as future work rather than rushed in.
