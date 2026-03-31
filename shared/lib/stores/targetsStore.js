import { normalizeLinkedInProfileUrl } from "../schema/normalizers.js";

const KEY = "ln_targets";
const TARGETS_CACHE_META_KEY = "ln_targets_cache_meta";
const RELATIONSHIP_STAGES = new Set(["hot", "warm", "cold"]);

export { normalizeLinkedInProfileUrl };

function normalizeRelationshipStage(stage) {
  return RELATIONSHIP_STAGES.has(stage) ? stage : "cold";
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
    relationshipStage: normalizeRelationshipStage(target.relationshipStage ?? target.relationship_stage),
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

export async function removeLocalTarget(profileSlug) {
  const map = await getTargetsMap();
  if (!profileSlug || !map[profileSlug]) return { removed: false, target: null };

  const target = map[profileSlug];
  const next = { ...map };
  delete next[profileSlug];
  await chrome.storage.local.set({ [KEY]: next });
  return { removed: true, target };
}

export async function setTargetRelationshipStage(profileSlug, relationshipStage) {
  const map = await getTargetsMap();
  const existing = map[profileSlug];
  if (!existing) {
    return { updated: false, target: null };
  }

  const next = {
    ...existing,
    relationshipStage: normalizeRelationshipStage(relationshipStage),
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({
    [KEY]: {
      ...map,
      [profileSlug]: next
    }
  });

  return { updated: true, target: next };
}

export async function applyDeltaSync(changes = []) {
  for (const change of changes) {
    await upsertLocalTarget(change);
  }

  await chrome.storage.local.set({
    [TARGETS_CACHE_META_KEY]: {
      lastHydratedAt: new Date().toISOString()
    }
  });
}

export async function replaceAllTargets(targets = []) {
  const nowIso = new Date().toISOString();
  const next = {};

  for (const target of targets) {
    const canonical = toCanonicalTarget(target, nowIso);
    if (canonical) {
      next[canonical.profileSlug] = canonical;
    }
  }

  await chrome.storage.local.set({
    [KEY]: next,
    [TARGETS_CACHE_META_KEY]: {
      lastHydratedAt: nowIso
    }
  });
}

export async function getTargetsCacheState(maxAgeMs = 5 * 60 * 1000) {
  const [map, data] = await Promise.all([getTargetsMap(), chrome.storage.local.get(TARGETS_CACHE_META_KEY)]);

  const meta = data[TARGETS_CACHE_META_KEY] ?? {};
  const hydratedAt = meta.lastHydratedAt ?? null;
  const ageMs = hydratedAt ? Date.now() - new Date(hydratedAt).getTime() : Number.POSITIVE_INFINITY;

  return {
    targetsMap: map,
    stale: ageMs > maxAgeMs,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    lastHydratedAt: hydratedAt
  };
}
