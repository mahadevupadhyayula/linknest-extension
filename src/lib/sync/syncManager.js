import { syncTargetsDelta } from "../backendClient";
import { applyDeltaSync } from "../stores/targetsStore";

const META_KEY = "ln_sync_meta";
const MAX_FAIL_BEFORE_FULL_SYNC = 3;

export async function runDeltaSync() {
  const data = await chrome.storage.local.get(META_KEY);
  const meta = data[META_KEY] ?? { lastSyncAt: null, failCount: 0 };
  const nowIso = new Date().toISOString();
  const shouldFallbackToFull = (meta.failCount ?? 0) >= MAX_FAIL_BEFORE_FULL_SYNC;

  try {
    const result = await syncTargetsDelta({ updated_since: shouldFallbackToFull ? null : meta.lastSyncAt });
    await applyDeltaSync(result.changes ?? []);

    await chrome.storage.local.set({
      [META_KEY]: {
        lastSyncAt: nowIso,
        failCount: 0,
        lastMode: shouldFallbackToFull ? "full_fallback" : "delta",
        lastAttemptAt: nowIso,
        lastSuccessAt: nowIso,
        lastError: null
      }
    });

    return { ok: true, changes: result.changes?.length ?? 0, mode: shouldFallbackToFull ? "full_fallback" : "delta" };
  } catch (error) {
    await chrome.storage.local.set({
      [META_KEY]: {
        ...meta,
        failCount: (meta.failCount ?? 0) + 1,
        lastAttemptAt: nowIso,
        lastFailureAt: nowIso,
        lastError: error instanceof Error ? error.message : String(error)
      }
    });

    return { ok: false, changes: 0, mode: shouldFallbackToFull ? "full_fallback" : "delta" };
  }
}
