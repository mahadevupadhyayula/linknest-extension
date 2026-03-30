/**
 * Shadow engine (safe mode): visible-author detection only.
 */

export function createShadowEngine({ intervalMs = 1000, scanFn, onMatch }) {
  let timer = null;

  function start() {
    stop();
    timer = window.setInterval(async () => {
      const items = await scanFn();
      for (const item of items) {
        if (item.isTarget) onMatch(item);
      }
    }, intervalMs);
  }

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
