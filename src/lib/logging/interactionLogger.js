import { logInteractionBatch } from "../backendClient";

const KEY = "ln_interaction_queue";
const BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000];

export async function queueInteraction(event) {
  const data = await chrome.storage.local.get(KEY);
  const queue = data[KEY] ?? [];
  queue.push({
    event,
    attemptCount: 0,
    nextRetryAt: Date.now()
  });
  await chrome.storage.local.set({ [KEY]: queue });
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
    const result = await logInteractionBatch({ events: ready.map((entry) => entry.event) });
    await chrome.storage.local.set({ [KEY]: waiting });
    return result;
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
