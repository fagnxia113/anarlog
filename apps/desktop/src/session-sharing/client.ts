export class ShareManagementError extends Error {}

export const sessionSharingClient = {
  connect: async () => {},
  disconnect: async () => {},
  deleteSessionShareBySession: async (_sessionId: string) => {},
};

export async function deleteSessionShareBySession(
  _context: unknown,
  _opts?: unknown,
): Promise<{ shareId: string | null }> {
  return { shareId: null };
}
