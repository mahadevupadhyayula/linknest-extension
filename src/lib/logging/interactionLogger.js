import { logInteractionBatch } from "../backendClient";

const KEY = "ln_interaction_queue";

export async function queueInteraction(event) {
  const data = await chrome.storage.local.get(KEY);
  const queue = data[KEY] ?? [];
  queue.push(event);
  await chrome.storage.local.set({ [KEY]: queue });
}

export async function flushInteractions() {
  const data = await chrome.storage.local.get(KEY);
  const queue = data[KEY] ?? [];
  if (!queue.length) return { accepted_count: 0, rejected_count: 0 };

  const result = await logInteractionBatch({ events: queue });
  await chrome.storage.local.set({ [KEY]: [] });
  return result;
}
