// interactions.js - pointer state machine. Resolves one gesture per pointerdown,
// mutates camera/scene/history, and requests a render. Draws nothing.

import {
  createNode,
  normalizeRect,
  hitTest,
  hitTestCycle,
  selectOnly,
  clearSelection,
  getSelected,
  setSelectionByMarquee,
  removeSelected,
  unionBounds,
} from "./scene.js";
import { handleCenters, HANDLE_SCREEN } from "./render.js";

const DRAW_MIN = 2; // min node size (world units) for a draw to create a shape
const KEY_ZOOM_STEP = 0.1; // scale change per Ctrl/Cmd +/- press

export function attachInteractions({
  canvas,
  camera,
  scene,
  history,
  getActiveTool,
  requestRender,
  syncChrome,
}) {
  let mode = "idle"; // idle | panning | drawing | draggingNode | resizing | groupResizing | marqueeing
  let last = null;
  let start = null;
  let draftNode = null;
  let marqueeRect = null;
  let grabOffsets = null;
  let moved = false;
  let resizeNode = null;
  let resizeAnchor = null;
  let groupAnchor = null;
  let groupResizeData = null;
  let lastPointer = null;

  function setCursor(value) {
    canvas.style.cursor = value;
  }

  // TL(0)/BR(3) lie on the NW-SE diagonal, TR(1)/BL(2) on the NE-SW diagonal.
  function resizeCursorForCorner(i) {
    return i === 0 || i === 3 ? "nwse-resize" : "nesw-resize";
  }

  function hitResizeHandleIndex(node, sx, sy) {
    const corners = handleCenters(node, camera.scale);
    const half = HANDLE_SCREEN / 2;
    for (let i = 0; i < corners.length; i++) {
      const p = camera.worldToScreen(corners[i].x, corners[i].y);
      if (Math.abs(sx - p.x) <= half && Math.abs(sy - p.y) <= half) return i;
    }
    return -1;
  }

  function hoverCursor(sx, sy) {
    const tool = getActiveTool();
    if (tool === "hand") return "grab";
    if (tool === "rect" || tool === "ellipse") return "crosshair";

    if (tool === "select") {
      const sel = getSelected(scene);
      if (sel.length === 1) {
        const i = hitResizeHandleIndex(sel[0], sx, sy);
        if (i !== -1) return resizeCursorForCorner(i);
      } else if (sel.length > 1) {
        const i = hitResizeHandleIndex(unionBounds(sel), sx, sy);
        if (i !== -1) return resizeCursorForCorner(i);
      }
      const world = camera.screenToWorld(sx, sy);
      if (hitTest(scene, world.x, world.y)) return "move";
    }
    return "default";
  }

  function refreshCursor() {
    if (mode !== "idle" || !lastPointer) return;
    setCursor(hoverCursor(lastPointer.sx, lastPointer.sy));
  }

  function undo() {
    history.undo(scene);
    requestRender();
    syncChrome();
  }
  function redo() {
    history.redo(scene);
    requestRender();
    syncChrome();
  }
  function deleteSelection() {
    if (getSelected(scene).length === 0) return;
    removeSelected(scene);
    history.commit(scene);
    requestRender();
    syncChrome();
  }

  // Zoom one 1-point step about the viewport center (matches the zoom buttons).
  function zoomByStep(delta) {
    const factor = (camera.scale + delta) / camera.scale;
    camera.zoomAtPoint(camera.vw / 2, camera.vh / 2, factor);
    requestRender();
    syncChrome();
  }

  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && (e.key === "+" || e.key === "=")) {
      // Ctrl/Cmd + + (= is the unshifted key) zooms in; preventDefault blocks browser zoom.
      e.preventDefault();
      zoomByStep(KEY_ZOOM_STEP);
    } else if (mod && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      zoomByStep(-KEY_ZOOM_STEP);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
    }
  });

  // Resolve the gesture once, in priority order:
  // resize handle -> node -> empty background (by active tool).
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "idle") return;

    const world = camera.screenToWorld(e.clientX, e.clientY);

    const tool = getActiveTool();

    if (tool === "select") {
      const sel = getSelected(scene);
      if (sel.length === 1) {
        const i = hitResizeHandleIndex(sel[0], e.clientX, e.clientY);
        if (i !== -1) {
          const n = sel[0];
          const realCorners = [
            { x: n.x, y: n.y },
            { x: n.x + n.w, y: n.y },
            { x: n.x, y: n.y + n.h },
            { x: n.x + n.w, y: n.y + n.h },
          ];
          beginResize(e, n, realCorners[3 - i], i); // anchor = real opposite corner
          return;
        }
      } else if (sel.length > 1) {
        const box = unionBounds(sel);
        const i = hitResizeHandleIndex(box, e.clientX, e.clientY);
        if (i !== -1) {
          const realCorners = [
            { x: box.x, y: box.y },
            { x: box.x + box.w, y: box.y },
            { x: box.x, y: box.y + box.h },
            { x: box.x + box.w, y: box.y + box.h },
          ];
          beginGroupResize(e, sel, box, realCorners[3 - i], i);
          return;
        }
      }
    }

    if (tool === "select") {
      const hit = hitTest(scene, world.x, world.y);
      if (hit) {
        const sel = getSelected(scene);
        if (sel.length > 1 && hit.selected) {
          beginDrag(e, world);
          requestRender();
          return;
        }
        // Repeated clicks cycle down through overlapping shapes.
        const current = sel.length === 1 ? sel[0] : null;
        selectOnly(scene, hitTestCycle(scene, world.x, world.y, current));
        beginDrag(e, world);
        requestRender();
        return;
      }
    }

    if (tool === "hand") {
      beginPan(e);
    } else if (tool === "rect" || tool === "ellipse") {
      beginDraw(e, tool, world);
    } else if (tool === "select") {
      clearSelection(scene);
      beginMarquee(e, world);
      requestRender();
    }
  });

  function beginPan(e) {
    mode = "panning";
    last = { sx: e.clientX, sy: e.clientY };
    setCursor("grabbing");
    canvas.setPointerCapture(e.pointerId);
  }

  function beginDraw(e, tool, world) {
    mode = "drawing";
    start = world;
    draftNode = createNode(tool, world.x, world.y, 0, 0);
    setCursor("crosshair");
    canvas.setPointerCapture(e.pointerId);
    requestRender();
  }

  function beginMarquee(e, world) {
    mode = "marqueeing";
    start = world;
    marqueeRect = normalizeRect(world.x, world.y, 0, 0);
    setCursor("crosshair");
    canvas.setPointerCapture(e.pointerId);
  }

  function beginResize(e, node, anchor, cornerIndex) {
    mode = "resizing";
    resizeNode = node;
    resizeAnchor = anchor;
    setCursor(resizeCursorForCorner(cornerIndex));
    canvas.setPointerCapture(e.pointerId);
  }

  // Store each node's position/size as fractions of the group box so the layout
  // scales uniformly. Guards a degenerate (zero-size) box.
  function beginGroupResize(e, nodes, box, anchor, cornerIndex) {
    mode = "groupResizing";
    groupAnchor = anchor;
    const safeW = box.w || 1;
    const safeH = box.h || 1;
    groupResizeData = {
      startBox: { ...box },
      nodes: nodes.map((n) => ({
        node: n,
        relX: box.w ? (n.x - box.x) / box.w : 0,
        relY: box.h ? (n.y - box.y) / box.h : 0,
        relW: box.w ? n.w / safeW : 0,
        relH: box.h ? n.h / safeH : 0,
      })),
    };
    setCursor(resizeCursorForCorner(cornerIndex));
    canvas.setPointerCapture(e.pointerId);
  }

  function beginDrag(e, world) {
    mode = "draggingNode";
    moved = false;
    setCursor("move");
    // Offset from the grab point per node keeps moves absolute (no drift).
    grabOffsets = new Map();
    for (const n of getSelected(scene)) {
      grabOffsets.set(n, { dx: n.x - world.x, dy: n.y - world.y });
    }
    canvas.setPointerCapture(e.pointerId);
  }

  canvas.addEventListener("pointermove", (e) => {
    lastPointer = { sx: e.clientX, sy: e.clientY };

    if (mode === "idle") {
      setCursor(hoverCursor(e.clientX, e.clientY));
      return;
    }

    if (mode === "panning") {
      camera.panBy(e.clientX - last.sx, e.clientY - last.sy);
      last = { sx: e.clientX, sy: e.clientY };
      requestRender();
    } else if (mode === "drawing") {
      const now = camera.screenToWorld(e.clientX, e.clientY);
      const r = normalizeRect(start.x, start.y, now.x - start.x, now.y - start.y);
      draftNode.x = r.x;
      draftNode.y = r.y;
      draftNode.w = r.w;
      draftNode.h = r.h;
      requestRender();
    } else if (mode === "draggingNode") {
      moved = true;
      const now = camera.screenToWorld(e.clientX, e.clientY);
      for (const [n, off] of grabOffsets) {
        n.x = now.x + off.dx;
        n.y = now.y + off.dy;
      }
      requestRender();
    } else if (mode === "resizing") {
      const now = camera.screenToWorld(e.clientX, e.clientY);
      const r = normalizeRect(
        resizeAnchor.x,
        resizeAnchor.y,
        now.x - resizeAnchor.x,
        now.y - resizeAnchor.y
      );
      resizeNode.x = r.x;
      resizeNode.y = r.y;
      resizeNode.w = r.w;
      resizeNode.h = r.h;
      requestRender();
    } else if (mode === "groupResizing") {
      const now = camera.screenToWorld(e.clientX, e.clientY);
      const box = normalizeRect(
        groupAnchor.x,
        groupAnchor.y,
        now.x - groupAnchor.x,
        now.y - groupAnchor.y
      );
      for (const r of groupResizeData.nodes) {
        r.node.x = box.x + r.relX * box.w;
        r.node.y = box.y + r.relY * box.h;
        r.node.w = r.relW * box.w;
        r.node.h = r.relH * box.h;
      }
      requestRender();
    } else if (mode === "marqueeing") {
      const now = camera.screenToWorld(e.clientX, e.clientY);
      marqueeRect = normalizeRect(start.x, start.y, now.x - start.x, now.y - start.y);
      setSelectionByMarquee(scene, marqueeRect);
      requestRender();
    }
  });

  function endGesture(e) {
    if (mode === "idle") return;
    if (canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (mode === "drawing") {
      if (draftNode.w >= DRAW_MIN && draftNode.h >= DRAW_MIN) {
        scene.nodes.push(draftNode);
        history.commit(scene);
      }
      draftNode = null;
      start = null;
      requestRender();
    } else if (mode === "draggingNode") {
      if (moved) history.commit(scene); // a zero-move drag is a pure selection
      grabOffsets = null;
      moved = false;
    } else if (mode === "resizing") {
      history.commit(scene);
      resizeNode = null;
      resizeAnchor = null;
    } else if (mode === "groupResizing") {
      history.commit(scene);
      groupAnchor = null;
      groupResizeData = null;
    } else if (mode === "marqueeing") {
      marqueeRect = null;
      start = null;
      requestRender();
    }

    mode = "idle";
    last = null;

    if (e && e.clientX !== undefined) {
      lastPointer = { sx: e.clientX, sy: e.clientY };
    }
    refreshCursor();
  }

  // Route every end (up/cancel/lost-capture) here so the machine always reaches idle.
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("lostpointercapture", endGesture);

  const ZOOM_STEP = 1.0015;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = Math.pow(ZOOM_STEP, -e.deltaY); // up = in, down = out
      camera.zoomAtPoint(e.clientX, e.clientY, factor);
      requestRender();
      syncChrome();
    },
    { passive: false }
  );

  function getOverlay() {
    return { draftNode, marqueeRect };
  }

  setCursor("default");

  return { getOverlay, undo, redo, deleteSelection, refreshCursor };
}
