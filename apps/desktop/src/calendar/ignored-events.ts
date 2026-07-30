export type IgnoredEventsValue = {
  ignoredIds: Set<string>;
  ignoredSeriesIds: Set<string>;
  isIgnored: (
    eventId: string | null | undefined,
    seriesId?: string | null | undefined,
  ) => boolean;
  ignoreEvent: (eventId: string) => void;
  unignoreEvent: (eventId: string) => void;
  ignoreSeries: (seriesId: string | null | undefined) => void;
  unignoreSeries: (seriesId: string | null | undefined) => void;
};

const emptyValue: IgnoredEventsValue = {
  ignoredIds: new Set<string>(),
  ignoredSeriesIds: new Set<string>(),
  isIgnored: () => false,
  ignoreEvent: () => {},
  unignoreEvent: () => {},
  ignoreSeries: () => {},
  unignoreSeries: () => {},
};

export function useIgnoredEvents(): IgnoredEventsValue {
  return emptyValue;
}

export async function getIgnoredEventSets() {
  return {
    ignoredIds: new Set<string>(),
    ignoredSeriesIds: new Set<string>(),
  };
}
