export function createFingerprintDedupe(ttlMs = 5 * 60 * 1000) {
  const seen = new Map();

  return function isDuplicate(fingerprint) {
    const now = Date.now();
    const existing = seen.get(fingerprint);
    if (existing && now - existing < ttlMs) return true;
    seen.set(fingerprint, now);
    return false;
  };
}
