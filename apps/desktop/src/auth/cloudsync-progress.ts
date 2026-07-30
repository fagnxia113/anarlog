export type CloudsyncInitialSyncProgress = {
  progress: number | null;
  isInitialSync: boolean;
  state: string | null;
  toastId: string | null;
};

export function useCloudsyncInitialSyncProgress(): CloudsyncInitialSyncProgress {
  return { progress: null, isInitialSync: false, state: null, toastId: null };
}
