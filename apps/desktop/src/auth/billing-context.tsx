import { createContext, useContext } from "react";
import type { ReactNode } from "react";

type BillingContextValue = {
  isPaid: boolean;
  isPro: boolean;
  isReady: boolean;
  isTrialing: boolean;
  plan: string;
  trialDaysRemaining: number;
  canStartTrial: { data: boolean };
  upgradeToPro: () => void;
};

const defaultValue: BillingContextValue = {
  isPaid: true,
  isPro: true,
  isReady: true,
  isTrialing: false,
  plan: "pro",
  trialDaysRemaining: 0,
  canStartTrial: { data: false },
  upgradeToPro: () => {},
};

const BillingContext = createContext<BillingContextValue>(defaultValue);

export function BillingProvider({ children }: { children: ReactNode }) {
  return (
    <BillingContext.Provider value={defaultValue}>
      {children}
    </BillingContext.Provider>
  );
}

export function useBillingAccess() {
  return useContext(BillingContext);
}
