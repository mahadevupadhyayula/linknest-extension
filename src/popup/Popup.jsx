import { useEffect, useState } from "react";

const SETTINGS_KEY = "ln_settings";

export default function Popup() {
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState({
    quietMode: false,
    passiveLoggingEnabled: false,
    shadowScanIntervalMs: 1000
  });

  const loadData = async () => {
    const [eventsResult, settingsResult] = await Promise.all([
      chrome.storage.local.get("ln_events"),
      chrome.storage.local.get(SETTINGS_KEY)
    ]);

    setEvents(eventsResult.ln_events ?? []);
    setSettings((prev) => ({ ...prev, ...(settingsResult[SETTINGS_KEY] ?? {}) }));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const patchSetting = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  };

  return (
    <div style={{ padding: 12, width: 340, fontFamily: "Arial, sans-serif" }}>
      <h3 style={{ marginTop: 0 }}>LinkNest</h3>

      <section>
        <h4>Recent Events</h4>
        {events.length === 0 ? (
          <p style={{ color: "#666" }}>No events yet.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {events.slice(0, 6).map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>: {event.message}
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
