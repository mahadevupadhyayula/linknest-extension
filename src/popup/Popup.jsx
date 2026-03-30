import { useEffect, useState } from "react";

const SETTINGS_KEY = "ln_settings";
const REFRESH_LABEL_DEFAULT = "Refresh targets";

export default function Popup() {
  const [events, setEvents] = useState([]);
  const [session, setSession] = useState(null);
  const [syncMeta, setSyncMeta] = useState({ lastSyncAt: null });
  const [backendStatus, setBackendStatus] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState(REFRESH_LABEL_DEFAULT);
  const [settings, setSettings] = useState({
    quietMode: false,
    passiveLoggingEnabled: false,
    shadowScanIntervalMs: 1000
  });

  const loadData = async () => {
    const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_GET_STATE" });
    if (!response?.ok) {
      setStatusMessage("Could not load extension state from background service.");
      return;
    }

    setEvents(response.events ?? []);
    setSettings((prev) => ({ ...prev, ...(response.settings ?? {}) }));
    setSession(response.session ?? null);
    setSyncMeta(response.syncMeta ?? { lastSyncAt: null });
    setBackendStatus(response.backendStatus ?? {});
    setUnreadCount(response.unreadCount ?? 0);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const patchSetting = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  };

  const markRead = async (eventId) => {
    const response = await chrome.runtime.sendMessage({
      type: "LN_POPUP_MARK_EVENT_READ",
      payload: { eventId }
    });
    if (response?.ok) {
      setEvents(response.events ?? []);
      setUnreadCount((response.events ?? []).filter((event) => !event.readAt).length);
    }
  };

  const dismiss = async (eventId) => {
    const response = await chrome.runtime.sendMessage({
      type: "LN_POPUP_DISMISS_EVENT",
      payload: { eventId }
    });
    if (response?.ok) {
      setEvents(response.events ?? []);
      setUnreadCount((response.events ?? []).filter((event) => !event.readAt).length);
    }
  };

  const clearAll = async () => {
    const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_CLEAR_EVENTS" });
    if (response?.ok) {
      setEvents([]);
      setUnreadCount(0);
    }
  };

  const refreshTargets = async () => {
    setIsRefreshing(true);
    setRefreshLabel("Refreshing...");
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_REFRESH_TARGETS" });
      if (!response?.ok) {
        throw new Error("Background refresh request failed.");
      }
      setSyncMeta(response.syncMeta ?? { lastSyncAt: null });
      setBackendStatus(response.backendStatus ?? {});
      setStatusMessage("Targets synced.");
    } catch (error) {
      setStatusMessage(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRefreshing(false);
      setRefreshLabel(REFRESH_LABEL_DEFAULT);
    }
  };

  return (
    <div style={{ padding: 12, width: 340, fontFamily: "Arial, sans-serif" }}>
      <h3 style={{ marginTop: 0 }}>LinkNest</h3>
      <p style={{ margin: "0 0 8px", color: "#444", fontSize: 12 }}>
        Session: {session?.active ? "Active" : "Idle"} · Last sync: {syncMeta.lastSyncAt ? new Date(syncMeta.lastSyncAt).toLocaleString() : "Never"}
      </p>
      <p style={{ margin: "0 0 12px", color: "#444", fontSize: 12 }}>Unread notifications: {unreadCount}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => void refreshTargets()} disabled={isRefreshing}>
          {refreshLabel}
        </button>
        <button type="button" onClick={() => void clearAll()} disabled={events.length === 0}>
          Clear all
        </button>
      </div>

      <section style={{ marginBottom: 12, border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
        <h4 style={{ margin: "0 0 6px" }}>Status</h4>
        <p style={{ margin: "0 0 4px", color: backendStatus.status === "error" ? "#b71c1c" : "#2e7d32", fontSize: 12 }}>
          Backend: {backendStatus.status ?? "idle"}
          {backendStatus.action ? ` (${backendStatus.action})` : ""}
        </p>
        <p style={{ margin: "0 0 4px", fontSize: 12 }}>
          Retries: {backendStatus.retries ?? 0}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
          {backendStatus.lastError ? `Last error: ${backendStatus.lastError}` : statusMessage || "No backend errors."}
        </p>
      </section>

      <section>
        <h4 style={{ margin: "0 0 8px" }}>Recent Events</h4>
        {events.length === 0 ? (
          <p style={{ color: "#666" }}>No events yet.</p>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {events.slice(0, 6).map((event) => (
              <li key={event.id} style={{ marginBottom: 8 }}>
                <div>
                  <strong>{event.type}</strong>: {event.message}
                </div>
                <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => void markRead(event.id)} disabled={Boolean(event.readAt)}>
                    {event.readAt ? "Read" : "Mark read"}
                  </button>
                  <button type="button" onClick={() => void dismiss(event.id)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Settings</h4>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.quietMode}
            onChange={(e) => void patchSetting({ quietMode: e.target.checked })}
          />{" "}
          Quiet mode
        </label>

        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.passiveLoggingEnabled}
            onChange={(e) => void patchSetting({ passiveLoggingEnabled: e.target.checked })}
          />{" "}
          Passive interaction logging (opt-in)
        </label>

        <label style={{ display: "block" }}>
          Shadow scan interval (ms):
          <input
            type="number"
            min={700}
            step={100}
            value={settings.shadowScanIntervalMs}
            onChange={(e) => void patchSetting({ shadowScanIntervalMs: Number(e.target.value) })}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
      </section>
    </div>
  );
}
