export type DurableSharedNote = {
  id: string;
  sessionId: string;
  shareId: string;
  workspaceId: string;
  title: string;
  publishedAt: string;
  manageAccess: boolean;
};

export function useDurableSharedNotes(
  _sessionId: string | undefined,
): DurableSharedNote[] {
  return [];
}

export async function loadManagedSharedNoteForSession(
  _userId: string,
  _sessionId: string,
): Promise<DurableSharedNote | null> {
  return null;
}

export async function removeDurableSharedNoteCache(
  _userId: string,
  _shareId: string,
): Promise<void> {}
