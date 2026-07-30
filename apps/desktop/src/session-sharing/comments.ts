import { useRef } from "react";

export function useSessionCommentAnchors(_sessionId: string) {
  return {
    anchors: [],
    addAnchor: () => {},
    removeAnchor: () => {},
    onViewReady: (_view: unknown) => {},
    onViewDisposed: (_view: unknown) => {},
  };
}

export function useSessionComments(_sessionId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  return {
    comments: [],
    addComment: () => {},
    removeComment: () => {},
    containerRef,
    onCommentAnchorsEvent: () => {},
    onViewReady: (_view: unknown) => {},
    onViewDisposed: (_view: unknown) => {},
  };
}

export function useOwnedSessionComments(_sessionId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  return {
    comments: [],
    addComment: () => {},
    removeComment: () => {},
    containerRef,
    onCommentAnchorsEvent: () => {},
    onViewReady: (_view: unknown) => {},
    onViewDisposed: (_view: unknown) => {},
  };
}

export function SessionCommentsLayer(_props: { controller?: unknown }) {
  return null;
}
