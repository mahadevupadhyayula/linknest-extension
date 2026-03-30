let shadowIntervalId = null;

/**
 * Message-level payload validators for internal background/content communication.
 */
const validators = {
  LN_EXTRACT_PROFILE_MINIMAL: (payload) => payload == null,
  LN_CAPTURE_SUGGESTION_CONTEXT: (payload) => payload == null,
  LN_START_SHADOW: (payload) => payload && typeof payload.mode === "string",
  LN_STOP_SHADOW: (payload) => payload == null
};

/**
 * Central listener for background script requests handled inside LinkedIn pages.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || !validators[message.type] || !validators[message.type](message.payload)) {
    sendResponse({ ok: false, error: "Invalid internal message payload." });
    return false;
  }

  if (message.type === "LN_EXTRACT_PROFILE_MINIMAL") {
    sendResponse(extractProfileMinimal());
    return true;
  }

  if (message.type === "LN_CAPTURE_SUGGESTION_CONTEXT") {
    sendResponse(extractSuggestionContextFromSelection());
    return true;
  }

  if (message.type === "LN_START_SHADOW") {
    startShadowMode(message.payload);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "LN_STOP_SHADOW") {
    stopShadowMode();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return false;
});

/**
 * Normalize a LinkedIn profile URL into a canonical profile slug + URL pair.
 */
function normalizeLinkedInProfileUrl(rawUrl) {
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

/**
 * Scrape lightweight profile fields from a LinkedIn profile page.
 */
function extractProfileMinimal() {
  const normalized = normalizeLinkedInProfileUrl(window.location.href);
  const displayName = document.querySelector("h1")?.textContent?.trim() || "Unknown";
  const headline = document.querySelector(".text-body-medium")?.textContent?.trim() || "";

  return {
    profileUrl: normalized?.profileUrl ?? null,
    profileSlug: normalized?.profileSlug ?? null,
    displayName,
    headline
  };
}

/**
 * Pull selected text and return a bounded context payload for suggestion generation.
 */
function extractSuggestionContextFromSelection() {
  const MAX_CONTEXT_CHARS = 600;
  const selection = window.getSelection()?.toString() ?? "";
  const normalized = selection.replace(/\s+/g, " ").trim();
  const text = normalized.slice(0, MAX_CONTEXT_CHARS);

  return {
    text,
    textMeta: {
      selectedChars: normalized.length,
      capturedChars: text.length,
      wasTrimmed: normalized.length > text.length
    }
  };
}

/**
 * Begin interval scanning for visible feed cards and emit detection events.
 */
function startShadowMode({ mode }) {
  if (mode !== "name_only") return;
  stopShadowMode();

  shadowIntervalId = window.setInterval(() => {
    const authors = extractVisibleFeedAuthors();
    for (const author of authors) {
      if (author.isTarget) {
        chrome.runtime.sendMessage({
          type: "LN_TARGET_DETECTED",
          payload: {
            displayName: author.displayName,
            profileUrl: author.profileUrl,
            fingerprint: author.fingerprint,
            detectedAt: new Date().toISOString()
          }
        });
      }
    }
  }, 1000);
}

/**
 * Stop ongoing shadow scanning interval, if active.
 */
function stopShadowMode() {
  if (!shadowIntervalId) return;
  window.clearInterval(shadowIntervalId);
  shadowIntervalId = null;
}

/**
 * Collect visible feed author candidates and create stable fingerprints per card.
 */
function extractVisibleFeedAuthors() {
  const cards = Array.from(document.querySelectorAll("div.feed-shared-update-v2"));
  const visibleCards = cards.filter(isElementInViewport).slice(0, 12);

  return visibleCards.map((card, index) => {
    const anchor = card.querySelector("a[href*='/in/']");
    const displayName = anchor?.textContent?.trim() || "Unknown";
    const profileUrl = anchor?.href || "";

    const isTarget = false;
    const fingerprint = `${profileUrl || displayName}_${index}`;

    return { displayName, profileUrl, isTarget, fingerprint };
  });
}

/**
 * Viewport check used to ignore off-screen feed cards.
 */
function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}
