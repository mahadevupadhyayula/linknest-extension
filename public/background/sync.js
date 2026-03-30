import { applyDeltaSync, getTargetsCacheState, replaceAllTargets } from "../lib/stores/targetsStore.js";
import { runDeltaSync as runSyncManager } from "../lib/sync/syncManager.js";
import { ALARM_IDS, CACHE_TTL_MS, STORE_KEYS } from "./constants.js";
import { enqueueEvent } from "./notifications.js";

export function scheduleBackgroundSync() {
  chrome.alarms.create(ALARM_IDS.REMINDERS, { periodInMinutes: 20 });
  chrome.alarms.create(ALARM_IDS.TARGET_SYNC, { periodInMinutes: 10 });
  chrome.alarms.create(ALARM_IDS.WRITE_FLUSH, { periodInMinutes: 1 });
}

export async function runTargetSync(syncApis, trigger = "background") {
  const result = await runSyncManager({
    syncDelta: syncApis.syncTargetsDeltaApi,
    syncFull: syncApis.syncTargetsFullApi,
    applyDelta: applyDeltaSync,
    applyFull: replaceAllTargets,
    metaKey: STORE_KEYS.SYNC_META
  });

  if (!result.ok) {
    await enqueueEvent({
      type: "target_sync_failed",
      message: "Target sync failed. Will retry automatically with backoff/fallback.",
      payload: {
        trigger,
        mode: result.mode,
        failCount: result.meta?.failCount ?? 0,
        error: result.error instanceof Error ? result.error.message : String(result.error)
      }
    });
  }

  return result;
}

export async function getTargetsWithStaleWhileRevalidate(syncApis) {
  const cache = await getTargetsCacheState(CACHE_TTL_MS.TARGET_CACHE_STALE);
  if (cache.stale) {
    void runTargetSync(syncApis, "stale_while_revalidate");
  }

  return cache;
}
