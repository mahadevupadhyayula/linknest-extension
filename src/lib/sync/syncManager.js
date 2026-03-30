import { syncTargetsDelta } from "../backendClient";
import { applyDeltaSync } from "../stores/targetsStore";

const META_KEY = "ln_sync_meta";

export async function runDeltaSync() {
  const data = await chrome.storage.local.get(META_KEY);
  const meta = data[META_KEY] ?? { lastSyncAt: null, failCount: 0 };

  try {
    const result = await syncTargetsDelta({ updated_since: meta.lastSyncAt });
    await applyDeltaSync(result.changes ?? []);

    await chrome.storage.local.set({
      [META_KEY]: {
        lastSyncAt: new Date().toISOString(),
        failCount: 0
      }
    });

    return { ok: true, changes: result.changes?.length ?? 0 };
  } catch {
    await chrome.storage.local.set({
      [META_KEY]: {
        ...meta,
        failCount: (meta.failCount ?? 0) + 1
      }
    });

    return { ok: false, changes: 0 };
  }
}
