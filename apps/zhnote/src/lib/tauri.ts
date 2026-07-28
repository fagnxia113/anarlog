import { invoke } from "@tauri-apps/api/core";

export interface Note {
  id: string;
  title: string;
  body: string;
  transcript: string;
  segments: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

export interface LlmConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface SttConfig {
  mode: string;
  language: string;
  diarization: boolean;
  cloud_base_url: string;
  cloud_api_key: string;
  cloud_model: string;
}

export interface SpeakerSegment {
  speaker: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranscribeResult {
  text: string;
  segments: SpeakerSegment[];
}

export const api = {
  listNotes: () => invoke<Note[]>("list_notes"),
  getNote: (id: string) => invoke<Note | null>("get_note", { id }),
  createNote: () => invoke<Note>("create_note"),
  updateNote: (id: string, title?: string, body?: string) =>
    invoke<void>("update_note", { id, title, body }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  saveTranscript: (id: string, transcript: string) =>
    invoke<void>("save_transcript", { id, transcript }),
  saveSegments: (id: string, segments: string) =>
    invoke<void>("save_segments", { id, segments }),
  saveSummary: (id: string, summary: string) =>
    invoke<void>("save_summary", { id, summary }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  generateSummary: (noteId: string) =>
    invoke<string>("generate_summary", { noteId }),
  testLlmConnection: (config: LlmConfig) =>
    invoke<void>("test_llm_connection", { config }),
  transcribeAudio: (audioPath: string) =>
    invoke<TranscribeResult>("transcribe_audio", { audioPath }),
};
