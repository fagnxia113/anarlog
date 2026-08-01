import { Merge, Scissors, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { useLingui } from "@lingui/react/macro";

import { cn } from "@hypr/utils";
import { sonnerToast } from "@hypr/ui/components/ui/toast";

import type { Segment, SegmentWord } from "~/stt/live-segment";
import {
  deleteTranscriptSegment,
  mergeTranscriptSegmentWithNext,
  saveTranscriptSnapshotIfMissing,
  splitTranscriptSegment,
} from "~/stt/queries";

const TOOLBAR_BUTTON_CLASSES = [
  "flex h-6 w-6 items-center justify-center",
  "rounded-xs text-muted-foreground",
  "hover:bg-accent hover:text-foreground",
  "transition-colors",
  "disabled:pointer-events-none disabled:opacity-30",
];

function findSplitAnchorWordId(words: SegmentWord[]): string | null {
  if (words.length < 4) return null;

  for (let i = 1; i < words.length; i += 1) {
    const prevText = words[i - 1]!.text.trim();
    if (/[。.!??！]$/.test(prevText)) {
      const wordId = words[i]!.id;
      if (wordId) return wordId;
    }
  }

  const midIndex = Math.floor(words.length / 2);
  const wordId = words[midIndex]?.id;
  return wordId ?? null;
}

export function SegmentToolbar({
  segment,
  transcriptId,
  nextSegment,
  className,
}: {
  segment: Segment;
  transcriptId: string;
  nextSegment?: Segment;
  className?: string;
}) {
  const { t } = useLingui();
  const splitAnchorId = findSplitAnchorWordId(segment.words);
  const canSplit = Boolean(splitAnchorId);
  const canMerge = Boolean(nextSegment);

  const handleSplit = useCallback(() => {
    if (!splitAnchorId) return;

    void saveTranscriptSnapshotIfMissing(transcriptId)
      .then(() => splitTranscriptSegment(transcriptId, splitAnchorId))
      .catch((error) => {
        console.error("[transcript] failed to split segment", error);
        sonnerToast.error(t`Failed to split segment`);
      });
  }, [splitAnchorId, t, transcriptId]);

  const handleMerge = useCallback(() => {
    if (!nextSegment) return;

    const secondWordIds = nextSegment.words
      .map((word) => word.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const splitWordId = secondWordIds[0];
    if (!splitWordId) return;

    const targetHumanId = segment.key.speaker_human_id ?? null;

    void saveTranscriptSnapshotIfMissing(transcriptId)
      .then(() =>
        mergeTranscriptSegmentWithNext(transcriptId, {
          splitWordId,
          targetHumanId,
          secondSegmentWordIds: secondWordIds,
          secondSegmentKey: nextSegment.key,
        }),
      )
      .catch((error) => {
        console.error("[transcript] failed to merge segment", error);
        sonnerToast.error(t`Failed to merge segments`);
      });
  }, [nextSegment, segment.key.speaker_human_id, t, transcriptId]);

  const handleDelete = useCallback(() => {
    const wordIds = segment.words
      .map((word) => word.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (wordIds.length === 0) return;

    void saveTranscriptSnapshotIfMissing(transcriptId)
      .then(() => deleteTranscriptSegment(transcriptId, wordIds))
      .catch((error) => {
        console.error("[transcript] failed to delete segment", error);
        sonnerToast.error(t`Failed to delete segment`);
      });
  }, [segment.words, t, transcriptId]);

  return (
    <div
      className={cn([
        "flex items-center gap-0.5",
        "opacity-0 transition-opacity group-hover/segment:opacity-100",
        className,
      ])}
    >
      <button
        type="button"
        title={t`Split segment`}
        disabled={!canSplit}
        onClick={handleSplit}
        className={cn(TOOLBAR_BUTTON_CLASSES)}
      >
        <Scissors size={14} />
      </button>
      <button
        type="button"
        title={t`Merge with next`}
        disabled={!canMerge}
        onClick={handleMerge}
        className={cn(TOOLBAR_BUTTON_CLASSES)}
      >
        <Merge size={14} />
      </button>
      <button
        type="button"
        title={t`Delete segment`}
        onClick={handleDelete}
        className={cn(TOOLBAR_BUTTON_CLASSES, "hover:text-destructive")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
