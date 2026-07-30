type Permission =
  | "calendar"
  | "microphone"
  | "systemAudio"
  | "screenRecording"
  | "accessibility";
type PermissionStatus = "authorized" | "denied" | "notDetermined";

export function usePermissions() {
  return {
    permissions: [] as Permission[],
    hasPermission: (_permission: Permission) => true,
    requestPermission: async (_permission: Permission) => true,
  };
}

export function usePermission(_type: Permission) {
  return {
    status: "authorized" as PermissionStatus,
    isPending: false,
    open: async () => {},
    request: () => {},
    reset: () => {},
  };
}
