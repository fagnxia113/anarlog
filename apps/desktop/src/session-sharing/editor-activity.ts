export async function flushCanonicalSessionEditorChanges(
  _sessionId: string,
): Promise<void> {}

export function registerCanonicalSessionEditor(
  _sessionId: string,
  _view?: unknown,
  _onChange?: () => void,
): () => void {
  return () => {};
}

export function unregisterCanonicalSessionEditor(
  _sessionId: string,
  _view?: unknown,
): void {}

export function isCanonicalSessionImportLocked(_sessionId: string): boolean {
  return false;
}

export function subscribeCanonicalSessionImportLocks(
  _cb: () => void,
): () => void {
  return () => {};
}

export function beginCanonicalSessionEditorActivation(
  _sessionId: string,
): (() => void) | null {
  return () => {};
}

export async function waitForCanonicalSessionImportUnlock(
  _sessionId: string,
): Promise<void> {}
