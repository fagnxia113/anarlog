import type { Segment, SegmentWord } from "~/stt/live-segment";

export const SEGMENT_SPLIT_HINT_TYPE = "user_segment_split";
export const WORD_DELETED_HINT_TYPE = "user_word_deleted";

export type SegmentEditHint = {
  word_id?: string;
  type?: string;
  value?: unknown;
};

export type SegmentEditHints = {
  splitWordIds: Set<string>;
  deletedWordIds: Set<string>;
};

const EMPTY_HINTS: SegmentEditHints = {
  splitWordIds: new Set(),
  deletedWordIds: new Set(),
};

export function parseSegmentEditHints(
  hints: readonly SegmentEditHint[],
): SegmentEditHints {
  if (!hints || hints.length === 0) {
    return EMPTY_HINTS;
  }

  const splitWordIds = new Set<string>();
  const deletedWordIds = new Set<string>();

  for (const hint of hints) {
    if (
      hint.type === SEGMENT_SPLIT_HINT_TYPE &&
      typeof hint.word_id === "string" &&
      hint.word_id
    ) {
      splitWordIds.add(hint.word_id);
    } else if (
      hint.type === WORD_DELETED_HINT_TYPE &&
      typeof hint.word_id === "string" &&
      hint.word_id
    ) {
      deletedWordIds.add(hint.word_id);
    }
  }

  if (splitWordIds.size === 0 && deletedWordIds.size === 0) {
    return EMPTY_HINTS;
  }

  return { splitWordIds, deletedWordIds };
}

export function hasSegmentEdits(hints: readonly SegmentEditHint[]): boolean {
  return hints.some(
    (hint) =>
      hint.type === SEGMENT_SPLIT_HINT_TYPE ||
      hint.type === WORD_DELETED_HINT_TYPE,
  );
}

export function applyUserSegmentEdits(
  segments: Segment[],
  hints: readonly SegmentEditHint[],
): Segment[] {
  if (!hints || hints.length === 0) {
    return segments;
  }

  const editHints = parseSegmentEditHints(hints);
  if (
    editHints.splitWordIds.size === 0 &&
    editHints.deletedWordIds.size === 0
  ) {
    return segments;
  }

  const result: Segment[] = [];

  for (const segment of segments) {
    const filteredWords = filterDeletedWords(segment, editHints);
    if (filteredWords.length === 0) {
      continue;
    }

    const fragments = splitSegmentAtWords(segment, filteredWords, editHints);
    for (const fragment of fragments) {
      if (fragment.words.length > 0) {
        result.push(fragment);
      }
    }
  }

  return result;
}

function filterDeletedWords(
  segment: Segment,
  editHints: SegmentEditHints,
): SegmentWord[] {
  if (editHints.deletedWordIds.size === 0) {
    return segment.words;
  }

  return segment.words.filter(
    (word) => !word.id || !editHints.deletedWordIds.has(word.id),
  );
}

function splitSegmentAtWords(
  segment: Segment,
  words: SegmentWord[],
  editHints: SegmentEditHints,
): Segment[] {
  if (editHints.splitWordIds.size === 0 || words.length <= 1) {
    return [{ ...segment, words }];
  }

  const fragments: Segment[] = [];
  let currentWords: SegmentWord[] = [];

  for (const word of words) {
    if (
      word.id &&
      editHints.splitWordIds.has(word.id) &&
      currentWords.length > 0
    ) {
      fragments.push(createSegmentFragment(segment, currentWords, "split"));
      currentWords = [];
    }
    currentWords.push(word);
  }

  if (currentWords.length > 0) {
    fragments.push(createSegmentFragment(segment, currentWords, "split"));
  }

  return fragments.length > 0
    ? fragments
    : [{ ...segment, words }];
}

function createSegmentFragment(
  segment: Segment,
  words: SegmentWord[],
  fragmentKind: string,
): Segment {
  const first = words[0]!;
  const last = words[words.length - 1]!;
  return {
    ...segment,
    id: [
      segment.id || "segment",
      fragmentKind,
      first.id ?? first.start_ms,
      last.id ?? last.end_ms,
    ].join(":"),
    start_ms: first.start_ms,
    end_ms: last.end_ms,
    text: words
      .map((word) => word.text)
      .join("")
      .trim(),
    words,
  };
}
