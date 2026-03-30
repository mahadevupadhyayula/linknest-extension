const KEY = "ln_settings";

const DEFAULT_SETTINGS = {
  quietMode: false,
  passiveLoggingEnabled: false,
  shadowScanIntervalMs: 1000,
  shadowSessionTimeoutMin: 30
};

export async function getSettings() {
  const data = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(data[KEY] ?? {}) };
}

export async function patchSettings(partial) {
  const settings = await getSettings();
  const next = { ...settings, ...partial };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
