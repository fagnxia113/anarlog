import type { ReactNode } from "react";

export function SharedNotePreviewAuthLifecycle({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export async function purgeSharedNotePreview(_id: string) {}
