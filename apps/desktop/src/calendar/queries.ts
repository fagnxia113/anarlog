export type NearbyCalendarEvent = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string;
  meetingLink: string;
  location: string;
  description: string;
  participantNames: string[];
};

export type TimelineEvent = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string;
  has_recurrence_rules: boolean;
};

export type TimelineSession = {
  id: string;
  title: string;
  created_at: string;
};

export type SessionEventParticipant = {
  id: string;
  name: string;
  email: string;
  is_current_user: boolean;
  source?: string;
};

export function useTimelineTables() {
  return {
    events: [] as TimelineEvent[],
    upcomingEvents: [] as TimelineEvent[],
    pastEvents: [] as TimelineEvent[],
    timelineEventsTable: {} as Record<string, TimelineEvent>,
    timelineSessionsTable: {} as Record<string, TimelineSession>,
  };
}

export function useTimelineEventsTable() {
  return null;
}

export function useSessionEventParticipants(
  _sessionId: string,
): SessionEventParticipant[] {
  return [];
}

export function getCalendarEventStartedAt(_eventId: string) {
  return null;
}

export async function searchCalendarEvents(_query: string) {
  return [];
}

export function useNearbyCalendarEvents(_now: number) {
  return [];
}

export function getNearbyCalendarEvents(
  _now: number,
  _windowMs?: number,
): NearbyCalendarEvent[] {
  return [];
}
