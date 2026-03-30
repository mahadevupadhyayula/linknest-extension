import { logInteractionBatch } from "../backendClient";

const KEY = "ln_interaction_queue";
const SETTINGS_KEY = "ln_settings";
const BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000];
const BATCH_SIZE = 25;

export async function queueInteraction(event) {
  const settingsData = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = settingsData[SETTINGS_KEY] ?? {};
  if (!settings.passiveLoggingEnabled) return { ok: true, skipped: true };

  const normalized = normalizeInteractionEvent(event);
  if (!normalized) return { ok: false, skipped: false };

  const data = await chrome.storage.local.get(KEY);
  const queue = data[KEY] ?? [];
  queue.push({
    event: normalized,
    attemptCount: 0,
    nextRetryAt: Date.now()
  });
  await chrome.storage.local.set({ [KEY]: queue });
  return { ok: true, skipped: false };
}

export async function flushInteractions() {
  const data = await chrome.storage.local.get(KEY);
  const queue = data[KEY] ?? [];
  if (!queue.length) return { accepted_count: 0, rejected_count: 0 };

  const now = Date.now();
  const ready = queue.filter((entry) => !entry.nextRetryAt || entry.nextRetryAt <= now);
  const waiting = queue.filter((entry) => entry.nextRetryAt && entry.nextRetryAt > now);
  if (!ready.length) return { accepted_count: 0, rejected_count: 0 };

  try {
    for (let idx = 0; idx < ready.length; idx += BATCH_SIZE) {
      const chunk = ready.slice(idx, idx + BATCH_SIZE);
      await logInteractionBatch({ events: chunk.map((entry) => entry.event) });
    }
    await chrome.storage.local.set({ [KEY]: waiting });
    return { accepted_count: ready.length, rejected_count: 0 };
  } catch (error) {
    const deferred = ready.map((entry) => {
      const attemptCount = (entry.attemptCount ?? 0) + 1;
      const backoff = BACKOFF_MS[Math.min(attemptCount - 1, BACKOFF_MS.length - 1)];
      return {
        ...entry,
        attemptCount,
        nextRetryAt: Date.now() + backoff,
        lastError: error instanceof Error ? error.message : String(error)
      };
    });
    await chrome.storage.local.set({ [KEY]: [...waiting, ...deferred] });
    throw error;
  }
}

function normalizeInteractionEvent(event) {
  if (!event || typeof event !== "object") return null;
  const { type, targetId = null, occurredAt, refId = null } = event;
  if (!type || !occurredAt) return null;
  return {
    type: String(type),
    targetId: targetId ? String(targetId) : null,
    occurredAt: String(occurredAt),
    refId: refId ? String(refId) : null
  };
}
