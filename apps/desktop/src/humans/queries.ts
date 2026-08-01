import type { EventParticipant, SessionEvent } from "@hypr/store";

import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { id } from "~/shared/utils";

type HumanSqlRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  organization_id: string;
  job_title: string;
};

export type HumanRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  organizationId: string;
  jobTitle: string;
};

const EMPTY_HUMANS: HumanRecord[] = [];
const EMPTY_PARTICIPANTS: EventParticipant[] = [];

export function useHumans(): HumanRecord[] {
  const { data = EMPTY_HUMANS } = useLiveQuery<HumanSqlRow, HumanRecord[]>({
    sql: `
      SELECT
        id,
        name,
        email,
        phone,
        organization_id,
        job_title
      FROM humans
      WHERE deleted_at IS NULL
      ORDER BY name, id
    `,
    mapRows: (rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        organizationId: row.organization_id,
        jobTitle: row.job_title,
      })),
  });
  return data;
}

export async function createHuman(params: {
  ownerUserId: string;
  name: string;
  email?: string;
}): Promise<string> {
  const humanId = id();
  const now = new Date().toISOString();
  await enqueueDatabaseWrite(`human:${humanId}`, async () => {
    await executeTransaction([
      {
        sql: `
          INSERT INTO humans (id, owner_user_id, name, email, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        params: [humanId, params.ownerUserId, params.name, params.email ?? "", now, now],
      },
    ]);
  });
  return humanId;
}

export function useSessionEventParticipants(
  sessionId: string,
): EventParticipant[] {
  const { data = EMPTY_PARTICIPANTS } = useLiveQuery<
    { event_json: string | null },
    EventParticipant[]
  >({
    sql: `SELECT event_json FROM sessions WHERE id = ?`,
    params: [sessionId],
    enabled: Boolean(sessionId),
    mapRows: (rows) => {
      const raw = rows[0]?.event_json;
      if (!raw) return [];
      try {
        const event = JSON.parse(raw) as Partial<SessionEvent>;
        const participants = event?.participantsJson;
        if (!Array.isArray(participants)) return [];
        return participants as EventParticipant[];
      } catch {
        return [];
      }
    },
  });
  return data;
}
