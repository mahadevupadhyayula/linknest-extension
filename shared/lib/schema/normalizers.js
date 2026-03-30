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

export function normalizeInteractionEvent(event) {
  if (!event || typeof event !== "object") return null;
  const { type, targetId = null, occurredAt, refId = null } = event;
  if (!type || !occurredAt) return null;
  return {
    type: String(type),
    targetId: targetId ? String(targetId) : null,
    occurredAt: String(occurredAt),
    refId: refId ? String(refId) : null
  };
}
