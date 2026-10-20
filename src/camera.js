// camera.js - viewport transform state and screen<->world conversions (CSS-pixel space).

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

export function createCamera(vw, vh) {
  const camera = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    vw,
    vh,

    worldToScreen(wx, wy) {
      return {
        x: wx * camera.scale + camera.offsetX,
        y: wy * camera.scale + camera.offsetY,
      };
    },

    screenToWorld(sx, sy) {
      return {
        x: (sx - camera.offsetX) / camera.scale,
        y: (sy - camera.offsetY) / camera.scale,
      };
    },

    panBy(dxCss, dyCss) {
      camera.offsetX += dxCss;
      camera.offsetY += dyCss;
    },

    // Zoom about a screen anchor, keeping the world point under it fixed. Scale clamps to [MIN, MAX].
    zoomAtPoint(sx, sy, factor) {
      const before = camera.screenToWorld(sx, sy);
      camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
      camera.offsetX = sx - before.x * camera.scale;
      camera.offsetY = sy - before.y * camera.scale;
    },

    setViewport(wCss, hCss) {
      camera.vw = wCss;
      camera.vh = hCss;
    },

    // Place world (0,0) at the viewport center, at scale 1.
    centerOnOrigin() {
      camera.scale = 1;
      camera.offsetX = camera.vw / 2;
      camera.offsetY = camera.vh / 2;
    },
  };
  return camera;
}
