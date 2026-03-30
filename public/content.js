let shadowIntervalId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LN_EXTRACT_PROFILE_MINIMAL") {
    sendResponse(extractProfileMinimal());
    return true;
  }

  if (message?.type === "LN_CAPTURE_SUGGESTION_CONTEXT") {
    sendResponse(extractSuggestionContextFromSelection());
    return true;
  }

  if (message?.type === "LN_START_SHADOW") {
    startShadowMode(message.payload);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "LN_STOP_SHADOW") {
    stopShadowMode();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return false;
});

function extractProfileMinimal() {
  const displayName = document.querySelector("h1")?.textContent?.trim() || "Unknown";
  const headline = document.querySelector(".text-body-medium")?.textContent?.trim() || "";

  return {
    profileUrl: window.location.href,
    displayName,
    headline
  };
}

function extractSuggestionContextFromSelection() {
  const text = window.getSelection()?.toString()?.trim() || "";
  return {
    text: text.slice(0, 1200)
  };
}

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

function stopShadowMode() {
  if (!shadowIntervalId) return;
  window.clearInterval(shadowIntervalId);
  shadowIntervalId = null;
}

function extractVisibleFeedAuthors() {
  const cards = Array.from(document.querySelectorAll("div.feed-shared-update-v2"));
  const visibleCards = cards.filter(isElementInViewport).slice(0, 12);

  return visibleCards.map((card, index) => {
    const anchor = card.querySelector("a[href*='/in/']");
    const displayName = anchor?.textContent?.trim() || "Unknown";
    const profileUrl = anchor?.href || "";

    // Placeholder target match strategy:
    // In implementation, load real local target cache for matching.
    const isTarget = false;
    const fingerprint = `${profileUrl || displayName}_${index}`;

    return { displayName, profileUrl, isTarget, fingerprint };
  });
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}
