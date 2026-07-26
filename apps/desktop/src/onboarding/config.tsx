import { platform } from "@tauri-apps/plugin-os";

import { env } from "~/env";

import type { SectionStatus } from "./shared";

export type OnboardingStep =
  | "permissions"
  | "login"
  | "calendar"
  | "folder-location"
  | "final";

const STEPS_MACOS: OnboardingStep[] = [
  "permissions",
  "login",
  "calendar",
  "final",
];
const STEPS_OTHER: OnboardingStep[] = ["login", "calendar", "final"];

const STEPS_OFFLINE: OnboardingStep[] = ["final"];

function getOnboardingSteps(): OnboardingStep[] {
  const hasSupabase = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
  if (!hasSupabase) {
    return STEPS_OFFLINE;
  }
  return platform() === "macos" ? STEPS_MACOS : STEPS_OTHER;
}

export function getInitialStep(): OnboardingStep {
  return getOnboardingSteps()[0];
}

export function getNextStep(
  currentStep: OnboardingStep,
): OnboardingStep | null {
  const steps = getOnboardingSteps();
  const idx = steps.indexOf(currentStep);
  return idx < steps.length - 1 ? steps[idx + 1] : null;
}

export function getPrevStep(
  currentStep: OnboardingStep,
): OnboardingStep | null {
  const steps = getOnboardingSteps();
  const idx = steps.indexOf(currentStep);
  return idx > 0 ? steps[idx - 1] : null;
}

export function getStepStatus(
  step: OnboardingStep,
  currentStep: OnboardingStep,
): SectionStatus | null {
  const steps = getOnboardingSteps();
  const stepIdx = steps.indexOf(step);
  if (stepIdx === -1) return null;
  const currentIdx = steps.indexOf(currentStep);
  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "active";
  return "upcoming";
}
