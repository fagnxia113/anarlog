export function useSessionCommentAnchors(_sessionId: string) {
  return {
    anchors: [],
    addAnchor: () => {},
    removeAnchor: () => {},
    onViewReady: (_view: unknown) => {},
    onViewDisposed: (_view: unknown) => {},
  };
}
