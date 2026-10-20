// history.js - snapshot-based undo/redo for the scene's node list.
// A snapshot is a JSON string of scene.nodes; the caller decides when to commit.

const MAX_SNAPSHOTS = 100;

function snapshot(scene) {
  return JSON.stringify(scene.nodes);
}

// Replace scene.nodes contents in place so other modules' references stay valid.
function restore(scene, snap) {
  scene.nodes.length = 0;
  for (const node of JSON.parse(snap)) scene.nodes.push(node);
}

export function createHistory(scene) {
  const stack = [snapshot(scene)];
  let index = 0;

  return {
    // Commit a new state: drop any redo tail and cap the stack.
    commit(scene) {
      stack.length = index + 1;
      stack.push(snapshot(scene));
      index++;
      if (stack.length > MAX_SNAPSHOTS) {
        stack.shift();
        index--;
      }
    },

    undo(scene) {
      if (index > 0) {
        index--;
        restore(scene, stack[index]);
      }
    },

    redo(scene) {
      if (index < stack.length - 1) {
        index++;
        restore(scene, stack[index]);
      }
    },
  };
}
