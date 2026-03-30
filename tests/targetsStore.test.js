import test from "node:test";
import assert from "node:assert/strict";

import { toCanonicalTarget } from "../shared/lib/stores/targetsStore.js";

test("toCanonicalTarget normalizes store payloads", () => {
  const now = "2026-03-30T00:00:00.000Z";
  const target = toCanonicalTarget(
    {
      profile_url: "https://www.linkedin.com/in/Test-User/",
      display_name: " Test User ",
      headline: " Engineer ",
      status: "active"
    },
    now
  );

  assert.equal(target.profileSlug, "test-user");
  assert.equal(target.displayName, "Test User");
  assert.equal(target.headline, "Engineer");
  assert.equal(target.updatedAt, now);
});
