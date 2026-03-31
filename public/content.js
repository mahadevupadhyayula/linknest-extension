let shadowIntervalId = null;

/**
 * Message-level payload validators for internal background/content communication.
 */
const validators = {
  LN_EXTRACT_PROFILE_MINIMAL: (payload) => payload == null,
  LN_CAPTURE_SUGGESTION_CONTEXT: (payload) => payload == null,
  LN_CONFIRM_ADD_AUTHOR_TO_TARGETS: (payload) => payload && typeof payload.displayName === "string",
  LN_PROMPT_SUGGESTION_CONTEXT: (payload) => payload == null,
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

  if (message.type === "LN_CONFIRM_ADD_AUTHOR_TO_TARGETS") {
    sendResponse(confirmAddAuthorToTargets(message.payload));
    return true;
  }

  if (message.type === "LN_PROMPT_SUGGESTION_CONTEXT") {
    sendResponse(promptForSuggestionContext());
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

function confirmAddAuthorToTargets({ displayName }) {
  const promptName = displayName?.trim() || "this author";
  const accepted = window.confirm(`"${promptName}" is not in your target list yet. Add them now?`);
  return { ok: true, accepted };
}

function promptForSuggestionContext() {
  const value = window.prompt("No highlighted content found. Add a brief context for the suggestion:") ?? "";
  const text = normalizeText(value);
  return {
    ok: true,
    text,
    contextType: "manual"
  };
}

/**
 * Pull selected text and return a bounded context payload for suggestion generation.
 */
function extractSuggestionContextFromSelection() {
  const MAX_CONTEXT_CHARS = 1200;
  const selection = window.getSelection();
  const selectedText = normalizeText(selection?.toString() ?? "");
  const anchorNode = selection?.anchorNode ?? null;

  if (!selectedText) {
    return {
      contextType: "unknown",
      text: "",
      highlightedText: "",
      textMeta: { selectedChars: 0, capturedChars: 0, wasTrimmed: false }
    };
  }

  const selectedElement = anchorNode?.nodeType === Node.ELEMENT_NODE
    ? anchorNode
    : anchorNode?.parentElement;

  const dmContainer = selectedElement?.closest('[data-view-name*="messaging"], .msg-s-message-list__event, .msg-thread, .msg-conversation-listitem') ?? null;
  if (dmContainer) {
    const dmText = truncateText(selectedText, MAX_CONTEXT_CHARS);
    return {
      contextType: "dm",
      text: dmText,
      highlightedText: dmText,
      textMeta: buildTextMeta(selectedText, dmText)
    };
  }

  const postContainer = selectedElement?.closest("div.feed-shared-update-v2, article") ?? null;
  const commentContainer = selectedElement?.closest(".comments-comment-item, .comments-comment-item-content-body, .comments-post-meta") ?? null;

  if (postContainer && commentContainer) {
    const context = extractFeedContext(postContainer, selectedText, MAX_CONTEXT_CHARS);
    const commentText = truncateText(selectedText, MAX_CONTEXT_CHARS);
    const combined = truncateText(
      [
        context.postText ? `Post: ${context.postText}` : "",
        `Comment: ${commentText}`
      ].filter(Boolean).join("\n\n"),
      MAX_CONTEXT_CHARS
    );

    return {
      contextType: "comment",
      text: combined,
      highlightedText: commentText,
      commentText,
      postText: context.postText,
      postUrl: context.postUrl,
      author: context.author,
      textMeta: buildTextMeta(selectedText, combined)
    };
  }

  if (postContainer) {
    const context = extractFeedContext(postContainer, selectedText, MAX_CONTEXT_CHARS);
    const postText = context.postText || truncateText(selectedText, MAX_CONTEXT_CHARS);

    return {
      contextType: "post",
      text: postText,
      highlightedText: truncateText(selectedText, MAX_CONTEXT_CHARS),
      postText,
      postUrl: context.postUrl,
      author: context.author,
      textMeta: buildTextMeta(selectedText, postText)
    };
  }

  const fallback = truncateText(selectedText, MAX_CONTEXT_CHARS);
  return {
    contextType: "unknown",
    text: fallback,
    highlightedText: fallback,
    textMeta: buildTextMeta(selectedText, fallback)
  };
}

function extractFeedContext(postContainer, selectedText, maxChars) {
  const authorAnchor = postContainer.querySelector('a[href*="/in/"]');
  const normalizedAuthor = normalizeLinkedInProfileUrl(authorAnchor?.href ?? "");
  const authorName = normalizeText(authorAnchor?.textContent ?? "") || "Unknown";
  const author = {
    displayName: authorName,
    profileUrl: normalizedAuthor?.profileUrl ?? null,
    profileSlug: normalizedAuthor?.profileSlug ?? null
  };

  const postUrl = findPostUrl(postContainer);
  const postText = truncateText(
    normalizeText(postContainer.querySelector('.update-components-text, .feed-shared-inline-show-more-text, span[dir="ltr"]')?.textContent ?? "")
      || truncateText(selectedText, maxChars),
    maxChars
  );

  return {
    author,
    postUrl,
    postText
  };
}

function findPostUrl(postContainer) {
  const permalink = postContainer.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
  if (!permalink?.href) return window.location.href;

  try {
    return new URL(permalink.href, window.location.href).toString();
  } catch {
    return window.location.href;
  }
}

function normalizeText(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxChars) {
  return value.slice(0, maxChars);
}

function buildTextMeta(original, captured) {
  return {
    selectedChars: original.length,
    capturedChars: captured.length,
    wasTrimmed: original.length > captured.length
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
