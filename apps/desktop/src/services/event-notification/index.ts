export const EVENT_NOTIFICATION_TASK_ID = "eventNotification";
export const EVENT_NOTIFICATION_INTERVAL = 30 * 1000;
export type NotifiedEventsMap = Map<string, number>;

export async function checkEventNotifications(
  _notificationEnabled: boolean,
  _notifiedEvents: NotifiedEventsMap,
): Promise<void> {}
