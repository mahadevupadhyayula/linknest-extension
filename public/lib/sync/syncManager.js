const DEFAULT_META = {
  lastSyncAt: null,
  failCount: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastMode: null,
  lastError: null
};

export async function runDeltaSync({
  syncDelta,
  syncFull,
  applyDelta,
  applyFull,
  maxFailBeforeFullSync = 3,
  metaKey = "ln_sync_meta"
}) {
  const data = await chrome.storage.local.get(metaKey);
  const meta = { ...DEFAULT_META, ...(data[metaKey] ?? {}) };
  const nowIso = new Date().toISOString();
  const shouldRunFullSync = meta.failCount >= maxFailBeforeFullSync;

  try {
    const result = shouldRunFullSync ? await syncFull() : await syncDelta({ updated_since: meta.lastSyncAt });

    if (shouldRunFullSync) {
      await applyFull(result.targets ?? result.changes ?? []);
    } else {
      await applyDelta(result.changes ?? []);
    }

    const nextMeta = {
      ...meta,
      lastSyncAt: nowIso,
      failCount: 0,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastMode: shouldRunFullSync ? "full" : "delta",
      lastError: null
    };

    await chrome.storage.local.set({ [metaKey]: nextMeta });

    return {
      ok: true,
      mode: shouldRunFullSync ? "full" : "delta",
      changes: (result.changes ?? result.targets ?? []).length,
      meta: nextMeta
    };
  } catch (error) {
    const nextMeta = {
      ...meta,
      failCount: (meta.failCount ?? 0) + 1,
      lastAttemptAt: nowIso,
      lastFailureAt: nowIso,
      lastError: error instanceof Error ? error.message : String(error)
    };

    await chrome.storage.local.set({ [metaKey]: nextMeta });

    return {
      ok: false,
      mode: shouldRunFullSync ? "full" : "delta",
      changes: 0,
      meta: nextMeta,
      error
    };
  }
}
