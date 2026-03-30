import { CACHE_LIMITS, STORE_KEYS } from "./constants.js";
const chrome = globalThis.chrome ?? globalThis.browser;

export async function getEvents() {
  const data = await chrome.storage.local.get(STORE_KEYS.EVENTS);
  return data[STORE_KEYS.EVENTS] ?? [];
}

export async function enqueueEvent(event) {
  const events = await getEvents();
  const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event }, ...events].slice(
    0,
    CACHE_LIMITS.EVENTS
  );
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
}

export async function markEventRead(eventId) {
  if (!eventId) return getEvents();
  const events = await getEvents();
  const next = events.map((event) =>
    event.id === eventId
      ? {
          ...event,
          readAt: event.readAt ?? new Date().toISOString()
        }
      : event
  );
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

export async function dismissEvent(eventId) {
  if (!eventId) return getEvents();
  const events = await getEvents();
  const next = events.filter((event) => event.id !== eventId);
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

export async function clearEvents() {
  const next = [];
  await chrome.storage.local.set({ [STORE_KEYS.EVENTS]: next });
  await recalculateUnreadCount(next);
  return next;
}

export async function recalculateUnreadCount(eventsInput) {
  const events = eventsInput ?? (await getEvents());
  const unreadCount = events.filter((event) => !event.readAt).length;
  await chrome.storage.local.set({ [STORE_KEYS.UNREAD_COUNT]: unreadCount });
  await applyUnreadBadge(unreadCount);
  return unreadCount;
}

export async function applyUnreadBadge(unreadCountInput) {
  if (!chrome?.action?.setBadgeBackgroundColor || !chrome?.action?.setBadgeText) return;

  const unreadCount =
    unreadCountInput ?? (await chrome.storage.local.get(STORE_KEYS.UNREAD_COUNT))[STORE_KEYS.UNREAD_COUNT] ?? 0;
  chrome.action.setBadgeBackgroundColor({ color: "#C62828" });
  chrome.action.setBadgeText({ text: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : "" });
}

export async function notify(title, message) {
  if (!chrome?.notifications?.create) return;

  const data = await chrome.storage.local.get(STORE_KEYS.SETTINGS);
  if (data[STORE_KEYS.SETTINGS]?.quietMode) return;

  chrome.notifications.create({
    type: "basic",
    title,
    message,
    iconUrl: "favicon.svg"
  });
}
