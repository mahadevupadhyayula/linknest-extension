const KEY = "ln_targets";

export async function getTargetsMap() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] ?? {};
}

export async function upsertLocalTarget(target) {
  const map = await getTargetsMap();
  map[target.profileUrl] = target;
  await chrome.storage.local.set({ [KEY]: map });
  return map[target.profileUrl];
}

export async function applyDeltaSync(changes = []) {
  for (const change of changes) {
    await upsertLocalTarget(change);
  }
}
