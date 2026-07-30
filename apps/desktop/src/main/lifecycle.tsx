import type { ReactNode } from "react";

export function MainLifecycle({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function ClassicMainServices() {
  return null;
}

export function useClassicMainLifecycle() {}

export default MainLifecycle;
