import { ArrowDownIcon, ArrowUpIcon, RotateCcw } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useRef,
  useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLingui } from "@lingui/react/macro";

import { cn } from "@hypr/utils";
import { sonnerToast } from "@hypr/ui/components/ui/toast";

import { SelectionMenu } from "./selection-menu";
import { TranscriptSeparator } from "./separator";
import { RenderTranscript } from "./transcript";
import {
  useAutoScroll,
  usePlaybackAutoScroll,
  useScrollDetection,
} from "./viewport-hooks";

import { useAudioPlayer } from "~/audio-player";
import { useAudioTime } from "~/audio-player/provider";
import type { Segment } from "~/stt/live-segment";
import {
  restoreOriginalTranscript,
  useTranscriptHasEdits,
} from "~/stt/queries";

const LIVE_TRANSCRIPT_PLACEHOLDER_ID = "__live-transcript__";

export function TranscriptViewer({
  transcriptIds,
  liveSegments,
  currentActive,
  captureGeneration = 0,
  scrollRef,
}: {
  transcriptIds: string[];
  liveSegments: Segment[];
  currentActive: boolean;
  captureGeneration?: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const handleContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      setScrollElement(node);
      scrollRef.current = node;
    },
    [scrollRef],
  );

  const {
    isAtTop,
    isAtBottom,
    isNearBottom,
    canScroll,
    autoScrollEnabled,
    scrollToTop,
    scrollToBottom,
  } = useScrollDetection(containerRef, currentActive);

  const {
    state: playerState,
    pause,
    resume,
    start,
    seek,
    audioExists,
  } = useAudioPlayer();
  const time = useAudioTime();
  const deferredCurrentMs = useDeferredValue(time.current * 1000);
  const isPlaying = playerState === "playing";

  useHotkeys(
    "space",
    (e) => {
      e.preventDefault();
      if (playerState === "playing") {
        pause();
      } else if (playerState === "paused") {
        resume();
      } else if (playerState === "stopped") {
        start();
      }
    },
    { enableOnFormTags: false },
  );

  usePlaybackAutoScroll(containerRef, deferredCurrentMs, isPlaying);
  const shouldAutoScroll = currentActive && autoScrollEnabled;
  const shouldScrollLastTranscriptToEnd = currentActive && isNearBottom;
  useAutoScroll(
    containerRef,
    [transcriptIds, liveSegments, shouldAutoScroll],
    shouldAutoScroll,
  );
  const visibleTranscriptIds =
    transcriptIds.length > 0
      ? transcriptIds
      : liveSegments.length > 0
        ? [LIVE_TRANSCRIPT_PLACEHOLDER_ID]
        : [];

  const handleSelectionAction = (action: string, selectedText: string) => {
    if (action === "copy") {
      void navigator.clipboard.writeText(selectedText);
    }
  };

  const { t } = useLingui();
  const firstRealTranscriptId = transcriptIds[0] ?? "";
  const hasEdits = useTranscriptHasEdits(firstRealTranscriptId);

  const handleRestore = useCallback(() => {
    if (!firstRealTranscriptId) return;
    if (
      !window.confirm(
        t`Restore original transcript? All segment edits will be lost.`,
      )
    ) {
      return;
    }

    void restoreOriginalTranscript(firstRealTranscriptId)
      .then(() => {
        sonnerToast.success(t`Transcript restored to original`);
      })
      .catch((error) => {
        console.error("[transcript] failed to restore original", error);
        sonnerToast.error(t`Failed to restore transcript`);
      });
  }, [firstRealTranscriptId, t]);

  return (
    <div className="relative h-full">
      <div
        ref={handleContainerRef}
        data-transcript-container
        className={cn([
          "flex h-full flex-col gap-8 overflow-x-hidden overflow-y-auto",
          "scrollbar-hide",
          "scroll-pb-[calc(8rem+env(safe-area-inset-bottom))]",
          "pb-[calc(4rem+env(safe-area-inset-bottom))]",
        ])}
      >
        {visibleTranscriptIds.map((transcriptId, index) => {
          const isLastTranscript = index === visibleTranscriptIds.length - 1;
          const isActiveTranscript = currentActive && isLastTranscript;

          return (
            <div key={transcriptId} className="flex flex-col gap-8">
              <RenderTranscript
                scrollElement={scrollElement}
                isLastTranscript={isLastTranscript}
                shouldScrollToEnd={shouldScrollLastTranscriptToEnd}
                transcriptId={transcriptId}
                currentActive={isActiveTranscript}
                captureGeneration={isActiveTranscript ? captureGeneration : 0}
                liveSegments={isActiveTranscript ? liveSegments : []}
                currentMs={deferredCurrentMs}
                seek={seek}
                startPlayback={start}
                audioExists={audioExists}
              />
              {!isLastTranscript && <TranscriptSeparator />}
            </div>
          );
        })}

        <SelectionMenu
          containerRef={containerRef}
          onAction={handleSelectionAction}
        />
      </div>

      {hasEdits && (
        <button
          type="button"
          onClick={handleRestore}
          title={t`Restore original transcript`}
          className={cn([
            "absolute top-2 left-2 z-40",
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
            "border-border/60 bg-muted/70 text-foreground border",
            "hover:bg-muted/90 transition-colors",
          ])}
        >
          <RotateCcw size={12} />
          <span>{t`Restore`}</span>
        </button>
      )}

      {canScroll && (
        <div
          data-transcript-scroll-controls
          className={cn([
            "absolute top-1/2 right-1 z-40 flex -translate-y-1/2 flex-col overflow-hidden",
            "border-border/60 bg-muted/70 text-foreground rounded-full border",
          ])}
        >
          <button
            type="button"
            aria-label="Scroll to top"
            onClick={scrollToTop}
            disabled={isAtTop}
            className={cn([
              "flex size-8 items-center justify-center",
              "hover:bg-muted/85 active:bg-muted/85",
              "disabled:pointer-events-none disabled:opacity-30",
            ])}
          >
            <ArrowUpIcon aria-hidden="true" className="size-3.5" />
          </button>
          <div className="bg-border/70 h-px w-full" />
          <button
            type="button"
            aria-label="Scroll to bottom"
            onClick={scrollToBottom}
            disabled={isAtBottom}
            className={cn([
              "flex size-8 items-center justify-center",
              "hover:bg-muted/85 active:bg-muted/85",
              "disabled:pointer-events-none disabled:opacity-30",
            ])}
          >
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
