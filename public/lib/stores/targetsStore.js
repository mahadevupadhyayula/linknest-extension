const KEY = "ln_targets";

export function normalizeLinkedInProfileUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.hostname !== "www.linkedin.com") return null;

  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  const match = cleanPath.match(/^\/in\/([A-Za-z0-9-_%]+)$/);
  if (!match) return null;

  const profileSlug = decodeURIComponent(match[1]).toLowerCase();
  if (!profileSlug) return null;

  return {
    profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(profileSlug)}`,
    profileSlug
  };
}

export function toCanonicalTarget(target = {}, nowIso = new Date().toISOString()) {
  const normalized = normalizeLinkedInProfileUrl(target.profileUrl ?? target.profile_url);
  if (!normalized) return null;

  const displayName = (target.displayName ?? target.display_name ?? "Unknown").trim() || "Unknown";
  const headline = (target.headline ?? "").trim();
  const source = target.source ?? "linkedin_profile";

  return {
    targetId: target.targetId ?? target.target_id ?? normalized.profileSlug,
    profileUrl: normalized.profileUrl,
    profileSlug: normalized.profileSlug,
    displayName,
    headline,
    source,
    status: target.status ?? "active",
    capturedAt: target.capturedAt ?? target.captured_at ?? nowIso,
    createdAt: target.createdAt ?? nowIso,
    updatedAt: nowIso
  };
}

export async function getTargetsMap() {
  const data = await chrome.storage.local.get(KEY);
  const map = data[KEY] ?? {};

  const normalizedEntries = Object.values(map)
    .map((target) => toCanonicalTarget(target, target.updatedAt ?? target.createdAt ?? new Date().toISOString()))
    .filter(Boolean)
    .map((target) => [target.profileSlug, target]);

  return Object.fromEntries(normalizedEntries);
}

export async function upsertLocalTarget(target) {
  const map = await getTargetsMap();
  const canonical = toCanonicalTarget(target);
  if (!canonical) {
    throw new Error("Invalid LinkedIn profile URL. Could not store target.");
  }

  const existing = map[canonical.profileSlug];
  const next = {
    ...existing,
    ...canonical,
    createdAt: existing?.createdAt ?? canonical.createdAt
  };

  const updatedMap = {
    ...map,
    [next.profileSlug]: next
  };

  await chrome.storage.local.set({ [KEY]: updatedMap });
  return { target: next, isNew: !existing };
}

export async function applyDeltaSync(changes = []) {
  for (const change of changes) {
    await upsertLocalTarget(change);
  }
}
