// 领域类型集中定义：从 App.tsx 抽出，供组件层与页面共享，避免巨型单文件耦合。
export type Meeting = {
  id: string;
  notebookId: string | null;
  title: string;
  startedAt: string;
  durationSeconds: number;
  status: string;
  transcript: string;
  minutes: string;
  decisions: string;
  speakerSegments: string;
  audioPath: string | null;
  updatedAt: string;
  context: string;
  notes: string;
};

export type Task = {
  id: string;
  title: string;
  sourceType: string | null;
  sourceId: string | null;
  completed: boolean;
  dueDate: string | null;
  createdAt: string;
  origin?: string;
};

export type Workspace = {
  meetings: Meeting[];
  tasks: Task[];
};

export type AiSettings = {
  baseUrl: string;
  analysisModel: string;
  isConfigured: boolean;
};

export type LocalAsrStatus = {
  installed: boolean;
  runtimeAvailable: boolean;
  modelSizeMb: number;
};

export type SpeakerEngineStatus = { installed: boolean; modelsReady: boolean };

export type AsrEngineSettings = {
  provider: "local" | "cloud";
  cloudBaseUrl: string;
  cloudModel: string;
  cloudKeySaved: boolean;
};

export type SpeakerSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type AnalysisResult = { meeting: Meeting; tasks: Task[] };

export type View = "home" | "meetings" | "tasks" | "settings";

export type Processing =
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "renaming"
  | "installingSpeaker"
  | "speakerTranscribing"
  | "importing"
  | "deleting"
  | "autoTranscribing"
  | null;
