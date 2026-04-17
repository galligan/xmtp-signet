import {
  createConvosOnboardingScheme,
  type OnboardingScheme,
} from "@xmtp/signet-core";
import type { OnboardingSchemeId } from "./config/schema.js";

/** Resolve a configured onboarding scheme ID to its runtime implementation. */
export function resolveOnboardingScheme(
  schemeId: OnboardingSchemeId,
): OnboardingScheme {
  switch (schemeId) {
    case "convos":
      return createConvosOnboardingScheme();
  }
}
