import test from "node:test";
import assert from "node:assert/strict";

import { createFingerprintDedupe } from "../src/lib/utils/dedupe.js";
import { createRateLimiter } from "../src/lib/utils/rateLimiter.js";
import { normalizeInteractionEvent, normalizeLinkedInProfileUrl } from "../shared/lib/schema/normalizers.js";

test("createFingerprintDedupe de-dupes within ttl", async () => {
  const dedupe = createFingerprintDedupe(30);
  assert.equal(dedupe("abc"), false);
  assert.equal(dedupe("abc"), true);
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(dedupe("abc"), false);
});

test("createRateLimiter blocks calls faster than interval", async () => {
  const limiter = createRateLimiter(25);
  assert.equal(limiter(), true);
  assert.equal(limiter(), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(limiter(), true);
});

test("normalizeLinkedInProfileUrl normalizes canonical profile URL", () => {
  const normalized = normalizeLinkedInProfileUrl("https://www.linkedin.com/in/Some-Person/?trk=foo");
  assert.deepEqual(normalized, {
    profileUrl: "https://www.linkedin.com/in/some-person",
    profileSlug: "some-person"
  });
  assert.equal(normalizeLinkedInProfileUrl("https://example.com/in/some-person"), null);
});

test("normalizeInteractionEvent validates required fields", () => {
  assert.equal(normalizeInteractionEvent(null), null);
  assert.equal(normalizeInteractionEvent({ type: "click" }), null);
  assert.deepEqual(normalizeInteractionEvent({ type: "click", occurredAt: "2026-03-30T00:00:00Z", targetId: 101 }), {
    type: "click",
    targetId: "101",
    occurredAt: "2026-03-30T00:00:00Z",
    refId: null
  });
});
