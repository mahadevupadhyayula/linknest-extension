const KEY = "ln_events";
const LIMIT = 100;

export async function getEvents() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] ?? [];
}

export async function enqueueEvent(event) {
  const events = await getEvents();
  const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event }, ...events].slice(0, LIMIT);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function clearEvents() {
  await chrome.storage.local.set({ [KEY]: [] });
}
