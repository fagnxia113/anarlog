import type { MentionConfig } from "@hypr/editor/note";

export function useMentionConfig(): MentionConfig {
  return {
    trigger: "@",
    handleSearch: async () => [],
  };
}
