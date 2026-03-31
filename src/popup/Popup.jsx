import { useEffect, useMemo, useState } from "react";

const SETTINGS_KEY = "ln_settings";
const STAGES = ["hot", "warm", "cold"];

const stageStyles = {
  hot: { border: "#ef9a9a", bg: "#ffebee", label: "Hot" },
  warm: { border: "#ffcc80", bg: "#fff3e0", label: "Warm" },
  cold: { border: "#90caf9", bg: "#e3f2fd", label: "Cold" }
};

export default function Popup() {
  const [activeTab, setActiveTab] = useState("targets");
  const [showSettings, setShowSettings] = useState(false);
  const [events, setEvents] = useState([]);
  const [targets, setTargets] = useState([]);
  const [session, setSession] = useState(null);
  const [syncMeta, setSyncMeta] = useState({ lastSyncAt: null });
  const [backendStatus, setBackendStatus] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAddingTarget, setIsAddingTarget] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [manualContext, setManualContext] = useState("");
  const [manualContextType, setManualContextType] = useState("post");
  const [settings, setSettings] = useState({
    quietMode: false,
    passiveLoggingEnabled: false,
    shadowScanIntervalMs: 1000
  });

  const groupedTargets = useMemo(() => {
    const bucket = { hot: [], warm: [], cold: [] };
    for (const target of targets) {
      const stage = STAGES.includes(target.relationshipStage) ? target.relationshipStage : "cold";
      bucket[stage].push(target);
    }
    return bucket;
  }, [targets]);

  const loadData = async () => {
    const [stateResponse, targetsResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: "LN_POPUP_GET_STATE" }),
      chrome.runtime.sendMessage({ type: "LN_TARGETS_GET_SWR" })
    ]);

    if (!stateResponse?.ok) {
      setStatusMessage("Could not load extension state from background service.");
      return;
    }

    setEvents(stateResponse.events ?? []);
    setSettings((prev) => ({ ...prev, ...(stateResponse.settings ?? {}) }));
    setSession(stateResponse.session ?? null);
    setSyncMeta(stateResponse.syncMeta ?? { lastSyncAt: null });
    setBackendStatus(stateResponse.backendStatus ?? {});
    setUnreadCount(stateResponse.unreadCount ?? 0);

    const targetMap = targetsResponse?.targetsMap ?? {};
    setTargets(Object.values(targetMap));
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
    const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_MARK_EVENT_READ", payload: { eventId } });
    if (response?.ok) {
      setEvents(response.events ?? []);
      setUnreadCount((response.events ?? []).filter((event) => !event.readAt).length);
    }
  };

  const dismiss = async (eventId) => {
    const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_DISMISS_EVENT", payload: { eventId } });
    if (response?.ok) {
      setEvents(response.events ?? []);
      setUnreadCount((response.events ?? []).filter((event) => !event.readAt).length);
    }
  };

  const refreshTargets = async () => {
    setIsRefreshing(true);
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_REFRESH_TARGETS" });
      if (!response?.ok) {
        throw new Error("Background refresh request failed.");
      }
      await loadData();
      setStatusMessage("Targets synced.");
    } catch (error) {
      setStatusMessage(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const analyzeProfile = async () => {
    setIsAnalyzing(true);
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_ANALYZE_ACTIVE_PROFILE" });
      if (!response?.ok) throw new Error(response?.error ?? "Could not analyze profile.");
      const decision = response.analysis?.decision === "add_target" ? "Add target" : "Move on";
      setStatusMessage(`Analysis decision: ${decision}.`);
      await loadData();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addTargetFromProfile = async () => {
    setIsAddingTarget(true);
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_ADD_TARGET_FROM_ACTIVE_PROFILE" });
      if (!response?.ok) throw new Error(response?.error ?? "Could not add target.");
      setStatusMessage("Target captured from profile page.");
      await loadData();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAddingTarget(false);
    }
  };

  const removeTarget = async (profileSlug) => {
    const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_REMOVE_TARGET", payload: { profileSlug } });
    if (response?.ok) {
      setStatusMessage("Target removed.");
      await loadData();
      return;
    }
    setStatusMessage(response?.error ?? "Could not remove target.");
  };

  const setStage = async (profileSlug, relationshipStage) => {
    const response = await chrome.runtime.sendMessage({
      type: "LN_POPUP_SET_TARGET_STAGE",
      payload: { profileSlug, relationshipStage }
    });
    if (response?.ok) {
      await loadData();
      return;
    }
    setStatusMessage(response?.error ?? "Could not update relationship stage.");
  };

  const requestSuggestionWithSelection = async () => {
    setIsSuggesting(true);
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "LN_POPUP_REQUEST_SUGGESTION" });
      if (!response?.ok) throw new Error(response?.error ?? "Suggestion request failed.");
      await loadData();
      setStatusMessage("Suggestion generated.");
    } catch (error) {
      setStatusMessage(`Suggestion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSuggesting(false);
    }
  };

  const requestSuggestionManual = async () => {
    setIsSuggesting(true);
    setStatusMessage("");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "LN_POPUP_REQUEST_SUGGESTION_MANUAL",
        payload: {
          text: manualContext,
          contextType: manualContextType
        }
      });
      if (!response?.ok) throw new Error(response?.error ?? "Could not generate suggestion.");
      await loadData();
      setStatusMessage("Suggestion generated from provided context.");
      setManualContext("");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSuggesting(false);
    }
  };

  const suggestionEvents = events.filter((event) => event.type === "suggestion_ready");

  return (
    <div style={{ padding: 12, width: 360, fontFamily: "Arial, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>LinkNest</h3>
        <button type="button" onClick={() => setShowSettings((prev) => !prev)} title="Settings" style={{ borderRadius: 999, width: 30, height: 30, border: "1px solid #ccc", background: "#fff" }}>
          ⚙
        </button>
      </header>

      <p style={{ margin: "0 0 8px", color: "#444", fontSize: 12 }}>
        Session: {session?.active ? "Active" : "Idle"} · Last sync: {syncMeta.lastSyncAt ? new Date(syncMeta.lastSyncAt).toLocaleString() : "Never"}
      </p>
      <p style={{ margin: "0 0 12px", color: "#444", fontSize: 12 }}>Unread notifications: {unreadCount}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { id: "targets", label: "Target Profiles" },
          { id: "notifications", label: "Notifications" },
          { id: "ai", label: "AI Suggestions" }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "4px 8px",
              borderRadius: 999,
              border: activeTab === tab.id ? "1px solid #1a73e8" : "1px solid #ccc",
              background: activeTab === tab.id ? "#e8f0fe" : "#fff",
              color: activeTab === tab.id ? "#174ea6" : "#333",
              fontSize: 12
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showSettings ? (
        <section style={{ marginBottom: 12, border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <h4 style={{ margin: "0 0 6px" }}>Settings</h4>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="checkbox" checked={settings.quietMode} onChange={(e) => void patchSetting({ quietMode: e.target.checked })} /> Quiet mode
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={settings.passiveLoggingEnabled}
              onChange={(e) => void patchSetting({ passiveLoggingEnabled: e.target.checked })}
            /> Passive interaction logging
          </label>
          <label style={{ display: "block" }}>
            Shadow scan interval (ms)
            <input
              type="number"
              min={700}
              step={100}
              value={settings.shadowScanIntervalMs}
              onChange={(e) => void patchSetting({ shadowScanIntervalMs: Number(e.target.value) })}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: backendStatus.status === "error" ? "#b71c1c" : "#2e7d32" }}>
            Backend: {backendStatus.status ?? "idle"}
          </p>
        </section>
      ) : null}

      {activeTab === "targets" ? (
        <section>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button type="button" onClick={() => void analyzeProfile()} disabled={isAnalyzing}>{isAnalyzing ? "Analyzing..." : "Analyze potential target"}</button>
            <button type="button" onClick={() => void addTargetFromProfile()} disabled={isAddingTarget}>{isAddingTarget ? "Adding..." : "Add new target"}</button>
            <button type="button" onClick={() => void refreshTargets()} disabled={isRefreshing}>{isRefreshing ? "Refreshing..." : "Refresh targets"}</button>
          </div>

          {STAGES.map((stage) => (
            <section key={stage} style={{ border: `1px solid ${stageStyles[stage].border}`, background: stageStyles[stage].bg, borderRadius: 6, padding: 8, marginBottom: 8 }}>
              <h4 style={{ margin: "0 0 6px" }}>{stageStyles[stage].label}</h4>
              {groupedTargets[stage].length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#666" }}>No targets in this stage.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {groupedTargets[stage].map((target) => (
                    <li key={target.profileSlug} style={{ marginBottom: 6 }}>
                      <a href={target.profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                        {target.displayName}
                      </a>
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {STAGES.map((nextStage) => (
                          <button
                            key={nextStage}
                            type="button"
                            disabled={target.relationshipStage === nextStage}
                            onClick={() => void setStage(target.profileSlug, nextStage)}
                            style={{ fontSize: 11 }}
                          >
                            Move to {nextStage}
                          </button>
                        ))}
                        <button type="button" onClick={() => void removeTarget(target.profileSlug)} style={{ fontSize: 11 }}>
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </section>
      ) : null}

      {activeTab === "notifications" ? (
        <section>
          {events.length === 0 ? (
            <p style={{ color: "#666", margin: 0 }}>No notifications yet.</p>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0, maxHeight: 260, overflow: "auto" }}>
              {events.slice(0, 12).map((event) => (
                <li key={event.id} style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{event.type}</strong>: {event.message}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => void markRead(event.id)} disabled={Boolean(event.readAt)}>
                      {event.readAt ? "Read" : "Mark read"}
                    </button>
                    <button type="button" onClick={() => void dismiss(event.id)}>Dismiss</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "ai" ? (
        <section>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#555" }}>
            AI behaves like a chatbot. Use highlighted context on LinkedIn, or provide manual context below.
          </p>
          <button type="button" onClick={() => void requestSuggestionWithSelection()} disabled={isSuggesting} style={{ marginBottom: 8 }}>
            {isSuggesting ? "Generating..." : "Generate from highlighted context"}
          </button>
          <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
              Content type
              <select value={manualContextType} onChange={(e) => setManualContextType(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="post">Post</option>
                <option value="comment">Comment</option>
                <option value="dm">DM</option>
              </select>
            </label>
            <label style={{ display: "block", fontSize: 12 }}>
              Context
              <textarea
                value={manualContext}
                onChange={(e) => setManualContext(e.target.value)}
                rows={4}
                placeholder="If no highlight is available, describe the post/comment/DM context here."
                style={{ width: "100%", marginTop: 4, resize: "vertical" }}
              />
            </label>
            <button type="button" onClick={() => void requestSuggestionManual()} disabled={isSuggesting || !manualContext.trim()} style={{ marginTop: 6 }}>
              Ask AI with provided context
            </button>
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, maxHeight: 180, overflow: "auto" }}>
            {suggestionEvents.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "#666" }}>
                AI: Please provide context (post/comment/DM) and what you want to generate.
              </p>
            ) : (
              suggestionEvents.slice(0, 4).map((event) => (
                <div key={event.id} style={{ marginBottom: 8, fontSize: 12 }}>
                  <strong>AI:</strong> {event.payload?.bestSuggestion || event.message}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {statusMessage ? <p style={{ margin: "10px 0 0", fontSize: 12, color: "#2e7d32" }}>{statusMessage}</p> : null}
    </div>
  );
}
