import { ALARM_IDS, MENU_IDS, STORE_KEYS } from "./constants.js";
import { backendApis } from "./backend.js";
import {
  addTargetFromProfile,
  ensureDefaultSettings,
  flushWriteQueues,
  getPageContext,
  handleRuntimeMessage,
  refreshMenusForTab,
  registerContextMenus,
  requestSuggestion,
  startShadowSession
} from "./handlers.js";
import { enqueueEvent, recalculateUnreadCount, notify } from "./notifications.js";
import { runTargetSync, scheduleBackgroundSync } from "./sync.js";
import { validateInternalMessage } from "./validators.js";
const chrome = globalThis.chrome ?? globalThis.browser;

async function configureSidePanelForTab(tabId, tabUrl) {
  if (!chrome.sidePanel?.setOptions || !tabId || typeof tabUrl !== "string") return;
  const isLinkedIn = tabUrl.startsWith("https://www.linkedin.com/");
  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled: isLinkedIn
  });
}

export function registerBackgroundOrchestrator() {
  if (!chrome?.runtime?.onInstalled || !chrome?.runtime?.onStartup || !chrome?.runtime?.onMessage) {
    console.error("LinkNest background: runtime APIs are unavailable in this browser context.");
    return;
  }

  chrome.runtime.onInstalled.addListener(async () => {
    await ensureDefaultSettings();
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    await registerContextMenus();
    await recalculateUnreadCount();
    scheduleBackgroundSync();
    await flushWriteQueues(backendApis);
  });

  chrome.runtime.onStartup.addListener(() => {
    void recalculateUnreadCount();
    scheduleBackgroundSync();
    void flushWriteQueues(backendApis);
  });

  chrome.tabs?.onActivated?.addListener?.(async ({ tabId }) => {
    await refreshMenusForTab(tabId);
    const tab = await chrome.tabs.get(tabId);
    await configureSidePanelForTab(tabId, tab?.url ?? "");
  });

  chrome.tabs?.onUpdated?.addListener?.(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      await refreshMenusForTab(tabId);
      await configureSidePanelForTab(tabId, tab?.url ?? "");
    }
  });

  chrome.contextMenus?.onClicked?.addListener?.(async (info, tab) => {
    if (!tab?.id || !tab.url) return;
    const ctx = getPageContext(tab.url);

    if (info.menuItemId === MENU_IDS.SHADOW_ME) return startShadowSession(tab.id, backendApis);
    if (info.menuItemId === MENU_IDS.SUGGEST_RESPONSE) return requestSuggestion(tab.id, backendApis);
    if (info.menuItemId === MENU_IDS.ADD_TARGET && ctx === "profile") return addTargetFromProfile(tab.id, backendApis);

    if (info.menuItemId === MENU_IDS.ANALYZE_PROFILE_MATCH && ctx === "profile") {
      await enqueueEvent({ type: "analysis_future", message: "Profile match analysis is planned for a future release." });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void (async () => {
      const validation = validateInternalMessage(message);
      if (!validation.ok) {
        sendResponse({ ok: false, error: validation.error });
        return;
      }

      const response = await handleRuntimeMessage(message, backendApis);
      sendResponse(response);
    })();

    return true;
  });

  chrome.alarms?.onAlarm?.addListener?.(async (alarm) => {
    if (alarm.name === ALARM_IDS.REMINDERS) {
      const reminders = await backendApis.fetchFollowupReminders({ limit: 5 });
      for (const reminder of reminders.reminders ?? []) {
        await enqueueEvent({ type: "followup_due", message: reminder.message, payload: reminder });
        await notify("LinkNest reminder", reminder.message);
      }
      return;
    }

    if (alarm.name === ALARM_IDS.TARGET_SYNC) {
      await runTargetSync(backendApis, "alarm");
      return;
    }

    if (alarm.name === ALARM_IDS.WRITE_FLUSH) {
      await flushWriteQueues(backendApis);
    }
  });
}
