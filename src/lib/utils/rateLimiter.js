export function createRateLimiter(minIntervalMs = 1000) {
  let lastRun = 0;

  return function shouldRun() {
    const now = Date.now();
    if (now - lastRun < minIntervalMs) return false;
    lastRun = now;
    return true;
  };
}
