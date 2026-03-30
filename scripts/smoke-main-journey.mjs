import { normalizeInteractionEvent, normalizeLinkedInProfileUrl } from "../shared/lib/schema/normalizers.js";
import { validateInternalMessage } from "../public/background/validators.js";

const checks = [
  {
    name: "profile url normalization",
    run: () => Boolean(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/jane-doe/"))
  },
  {
    name: "interaction payload normalization",
    run: () => Boolean(normalizeInteractionEvent({ type: "profile_view", occurredAt: new Date().toISOString() }))
  },
  {
    name: "runtime message validation",
    run: () => validateInternalMessage({ type: "LN_POPUP_GET_STATE" }).ok
  }
];

let failures = 0;
for (const check of checks) {
  const ok = check.run();
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${check.name}`);
}

if (failures) {
  console.error(`Smoke journey failed with ${failures} failing checks.`);
  process.exit(1);
}

console.log("Smoke journey completed.");
