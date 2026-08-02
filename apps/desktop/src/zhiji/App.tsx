import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  House,
  LoaderCircle,
  Maximize2,
  Mic,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UsersRound,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Meeting = {
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
type Task = {
  id: string;
  title: string;
  sourceType: string | null;
  sourceId: string | null;
  completed: boolean;
  dueDate: string | null;
  createdAt: string;
  origin?: string;
};
type Workspace = {
  meetings: Meeting[];
  tasks: Task[];
};
type AiSettings = {
  baseUrl: string;
  analysisModel: string;
  isConfigured: boolean;
};
type LocalAsrStatus = {
  installed: boolean;
  runtimeAvailable: boolean;
  modelSizeMb: number;
};
type SpeakerEngineStatus = { installed: boolean; modelsReady: boolean };
type AsrEngineSettings = {
  provider: "local" | "cloud";
  cloudBaseUrl: string;
  cloudModel: string;
  cloudKeySaved: boolean;
};
type SpeakerSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};
type AnalysisResult = { meeting: Meeting; tasks: Task[] };
type View = "home" | "meetings" | "tasks" | "settings";
type Processing =
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

const emptyWorkspace: Workspace = {
  meetings: [],
  tasks: [],
};
const defaultAiSettings: AiSettings = {
  baseUrl: "https://api.openai.com/v1",
  analysisModel: "gpt-4o-mini",
  isConfigured: false,
};
const defaultAsrStatus: LocalAsrStatus = {
  installed: false,
  runtimeAvailable: false,
  modelSizeMb: 0,
};
const defaultSpeakerStatus: SpeakerEngineStatus = {
  installed: false,
  modelsReady: false,
};
const defaultAsrEngine: AsrEngineSettings = {
  provider: "local",
  cloudBaseUrl: "https://api.siliconflow.cn/v1",
  cloudModel: "FunAudioLLM/SenseVoiceSmall",
  cloudKeySaved: false,
};
const CLOUD_ASR_PRESETS = [
  {
    label: "硅基流动 · SenseVoiceSmall（有免费额度）",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "FunAudioLLM/SenseVoiceSmall",
  },
  {
    label: "OpenAI · whisper-1",
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
  },
  {
    label: "Groq · whisper-large-v3",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3",
  },
];

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function duration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function newTask(
  title: string,
  sourceType: string | null = null,
  sourceId: string | null = null,
): Task {
  return {
    id: crypto.randomUUID(),
    title,
    sourceType,
    sourceId,
    completed: false,
    dueDate: null,
    createdAt: new Date().toISOString(),
  };
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const [asrStatus, setAsrStatus] = useState<LocalAsrStatus>(defaultAsrStatus);
  const [speakerStatus, setSpeakerStatus] =
    useState<SpeakerEngineStatus>(defaultSpeakerStatus);
  const [asrEngine, setAsrEngine] = useState<AsrEngineSettings>(defaultAsrEngine);
  const [asrKeyInput, setAsrKeyInput] = useState("");
  const [autoSaveHint, setAutoSaveHint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [view, setView] = useState<View>("home");
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState<Processing>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingSecondsRef = useRef(0);
  const asrStatusRef = useRef(asrStatus);
  const speakerStatusRef = useRef(speakerStatus);
  const asrEngineRef = useRef(asrEngine);
  const savedSnapshot = useRef<{ id: string; json: string }>({ id: "", json: "" });

  useEffect(() => {
    asrStatusRef.current = asrStatus;
  }, [asrStatus]);
  useEffect(() => {
    speakerStatusRef.current = speakerStatus;
  }, [speakerStatus]);
  useEffect(() => {
    asrEngineRef.current = asrEngine;
  }, [asrEngine]);

  const reload = async () => {
    const next = await invoke<Workspace>("load_workspace");
    setWorkspace(next);
    return next;
  };

  const notify = (next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage(""), 4200);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      reload(),
      invoke<AiSettings>("get_ai_settings"),
      invoke<LocalAsrStatus>("get_local_asr_status"),
      invoke<SpeakerEngineStatus>("get_speaker_engine_status"),
      invoke<AsrEngineSettings>("get_asr_engine_settings"),
    ])
      .then(([, settings, asr, speaker, engine]) => {
        if (!active) return;
        setAiSettings(settings);
        setAsrStatus(asr);
        setSpeakerStatus(speaker);
        setAsrEngine(engine);
      })
      .catch(
        (error: unknown) =>
          active && notify(`无法打开本地资料库：${String(error)}`),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      recordingSecondsRef.current += 1;
      setRecordingSeconds(recordingSecondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // 自动保存：选中会议内容变化后 1.5 秒无操作即静默保存（不打断输入，不刷新列表）
  useEffect(() => {
    if (!selectedMeeting) return;
    const target = { id: selectedMeeting.id, json: JSON.stringify(selectedMeeting) };
    const snap = savedSnapshot.current;
    if (snap.id !== target.id) {
      savedSnapshot.current = target;
      setAutoSaveHint("");
      return;
    }
    if (snap.json === target.json) return;
    setAutoSaveHint("有未保存更改…");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await invoke("save_meeting", { meeting: selectedMeeting });
          savedSnapshot.current = target;
          setAutoSaveHint("已自动保存");
        } catch (error) {
          setAutoSaveHint(`自动保存失败：${String(error)}`);
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [selectedMeeting]);

  const filteredMeetings = useMemo(
    () =>
      workspace.meetings.filter((meeting) =>
        `${meeting.title} ${meeting.transcript} ${meeting.minutes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, workspace.meetings],
  );

  const createMeeting = async () => {
    const meeting = await invoke<Meeting>("create_meeting", { notebookId: null });
    setSelectedMeeting(meeting);
    setView("meetings");
    await reload();
  };

  const saveMeeting = async () => {
    if (!selectedMeeting) return;
    await invoke("save_meeting", { meeting: selectedMeeting });
    savedSnapshot.current = {
      id: selectedMeeting.id,
      json: JSON.stringify(selectedMeeting),
    };
    setAutoSaveHint("已保存到本地");
    await reload();
    notify("会议内容已保存到本地");
  };

  const importMeetingAudio = async () => {
    if (!selectedMeeting) return;
    if (
      selectedMeeting.audioPath &&
      !window.confirm(
        "这场会议已有录音。继续导入会替换应用内的旧录音，是否继续？",
      )
    )
      return;
    try {
      const audioPath = await open({
        multiple: false,
        directory: false,
        title: "导入会议录音",
        filters: [
          {
            name: "音频文件",
            extensions: [
              "wav",
              "mp3",
              "m4a",
              "aac",
              "flac",
              "ogg",
              "opus",
              "webm",
              "wma",
              "mp4",
            ],
          },
        ],
      });
      if (!audioPath) return;
      setProcessing("importing");
      const meeting = await invoke<Meeting>("import_meeting_audio", {
        meetingId: selectedMeeting.id,
        audioPath,
      });
      setSelectedMeeting(meeting);
      await reload();
      notify("录音已导入到本地资料库，可以开始转写");
    } catch (error) {
      notify(`导入录音失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const deleteMeeting = async () => {
    if (!selectedMeeting) return;
    if (
      !window.confirm(
        `确定删除“${selectedMeeting.title}”吗？\n\n会议、应用内录音和该会议生成的待办将被删除，此操作无法撤销。`,
      )
    )
      return;
    try {
      setProcessing("deleting");
      const deletedId = selectedMeeting.id;
      await invoke("delete_meeting", { meetingId: deletedId });
      const latest = await reload();
      setSelectedMeeting(
        latest.meetings.find((meeting) => meeting.id !== deletedId) ?? null,
      );
      notify("会议已删除");
    } catch (error) {
      notify(`删除会议失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const addTask = async (
    sourceType: string | null = null,
    sourceId: string | null = null,
  ) => {
    const title = window.prompt("待办事项");
    if (!title?.trim()) return;
    await invoke("upsert_task", {
      task: newTask(title.trim(), sourceType, sourceId),
    });
    await reload();
    notify("已加入待办");
  };

  const toggleTask = async (task: Task) => {
    await invoke("upsert_task", {
      task: { ...task, completed: !task.completed },
    });
    await reload();
  };

  const startRecording = async () => {
    if (!selectedMeeting) {
      notify("请先新建或打开一场会议");
      return;
    }
    try {
      const meetingId = selectedMeeting.id;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 先在后端建好空文件，录音过程中每 30 秒追加一段，崩溃也最多只丢 30 秒
      await invoke("begin_recording", { meetingId });
      const mediaRecorder = new MediaRecorder(stream);
      let chunkQueue: Promise<void> = Promise.resolve();
      let chunkFailed = "";
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const blob = event.data;
        chunkQueue = chunkQueue.then(async () => {
          if (chunkFailed) return;
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            await invoke("append_recording_chunk", { meetingId, dataUrl });
          } catch (error) {
            chunkFailed = String(error);
          }
        });
      };
      mediaRecorder.onstop = () => {
        void (async () => {
          try {
            await chunkQueue;
            if (chunkFailed) {
              notify(`录音写入失败：${chunkFailed}。已保留写入成功的部分。`);
            }
            const meeting = await invoke<Meeting>("finalize_recording", {
              meetingId,
              durationSeconds: recordingSecondsRef.current,
            });
            setSelectedMeeting(meeting);
            await reload();

            const engine = asrEngineRef.current;
            if (engine.provider === "cloud") {
              if (!engine.cloudKeySaved) {
                notify("录音已保存。请先在设置中配置云端转写密钥。");
                return;
              }
              setProcessing("autoTranscribing");
              try {
                const transcribed = await invoke<Meeting>("transcribe_meeting", {
                  meetingId,
                });
                setSelectedMeeting(transcribed);
                await reload();
                notify("录音已保存，并自动完成云端转写（录音已按你的配置上传处理）。");
              } catch (error) {
                notify(`云端转写失败：${String(error)}。可手动点击转写按钮重试。`);
              } finally {
                setProcessing(null);
              }
              return;
            }

            if (!asrStatusRef.current.installed) {
              notify("录音已保存。请在设置中下载本地语音模型后再转写。");
              return;
            }

            setProcessing("autoTranscribing");
            try {
              if (speakerStatusRef.current.installed) {
                const meeting = await invoke<Meeting>(
                  "transcribe_meeting_with_speakers",
                  { meetingId },
                );
                setSelectedMeeting(meeting);
                setSpeakerStatus((status) => ({
                  ...status,
                  modelsReady: true,
                }));
                notify("录音已保存，并自动完成转写与说话人区分。");
              } else {
                const meeting = await invoke<Meeting>("transcribe_meeting", {
                  meetingId,
                });
                setSelectedMeeting(meeting);
                notify(
                  "录音已保存，并自动完成转写。可在设置中安装说话人引擎以区分发言人。",
                );
              }
              await reload();
            } catch (error) {
              notify(
                `自动转写失败：${String(error)}。可手动点击转写按钮重试。`,
              );
            } finally {
              setProcessing(null);
            }
          } catch (error) {
            notify(`保存录音失败：${String(error)}`);
          } finally {
            stream.getTracks().forEach((track) => track.stop());
          }
        })();
      };
      recorder.current = mediaRecorder;
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      setRecording(true);
      mediaRecorder.start(30000);
    } catch (error) {
      notify(`无法启用麦克风：${String(error)}`);
    }
  };

  const stopRecording = () => {
    recorder.current?.stop();
    setRecording(false);
  };

  const transcribeMeeting = async () => {
    if (!selectedMeeting) return;
    try {
      setProcessing("transcribing");
      const meeting = await invoke<Meeting>("transcribe_meeting", {
        meetingId: selectedMeeting.id,
      });
      setSelectedMeeting(meeting);
      await reload();
      notify(
        asrEngine.provider === "cloud"
          ? "云端转写完成，已写入原始记录"
          : "本地语音转写完成，已写入原始记录",
      );
    } catch (error) {
      notify(`转写失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const downloadLocalAsr = async () => {
    try {
      setProcessing("downloading");
      const status = await invoke<LocalAsrStatus>("download_local_asr_model");
      setAsrStatus(status);
      notify(`本地中文语音模型已就绪（${status.modelSizeMb} MB）`);
    } catch (error) {
      notify(`下载本地语音模型失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const analyzeMeeting = async () => {
    if (!selectedMeeting) return;
    try {
      setProcessing("analyzing");
      const result = await invoke<AnalysisResult>("analyze_meeting", {
        meetingId: selectedMeeting.id,
      });
      setSelectedMeeting(result.meeting);
      await reload();
      notify(`智能纪要已生成，并提取了 ${result.tasks.length} 项待办`);
    } catch (error) {
      notify(`智能分析失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const renameMeeting = async () => {
    if (!selectedMeeting) return;
    try {
      setProcessing("renaming");
      const meeting = await invoke<Meeting>("rename_meeting", {
        meetingId: selectedMeeting.id,
      });
      setSelectedMeeting(meeting);
      await reload();
      notify(`已重命名为「${meeting.title}」`);
    } catch (error) {
      notify(`AI 重命名失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const installSpeakerEngine = async () => {
    try {
      setProcessing("installingSpeaker");
      const status = await invoke<SpeakerEngineStatus>(
        "install_speaker_engine_command",
      );
      setSpeakerStatus(status);
      notify("本地说话人分离引擎已就绪。首次区分发言人时会下载会议模型。");
    } catch (error) {
      notify(`安装说话人分离引擎失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const transcribeWithSpeakers = async () => {
    if (!selectedMeeting) return;
    if (asrEngine.provider === "cloud") {
      // 云端引擎暂不含说话人分离，退化为纯云端转写
      await transcribeMeeting();
      return;
    }
    try {
      setProcessing("speakerTranscribing");
      const meeting = await invoke<Meeting>(
        "transcribe_meeting_with_speakers",
        { meetingId: selectedMeeting.id },
      );
      setSelectedMeeting(meeting);
      setSpeakerStatus((status) => ({ ...status, modelsReady: true }));
      await reload();
      notify("已完成本地转写与说话人区分，可继续生成智能纪要。");
    } catch (error) {
      notify(`说话人分离失败：${String(error)}`);
    } finally {
      setProcessing(null);
    }
  };

  const saveAiSettings = async () => {
    try {
      const saved = await invoke<AiSettings>("save_ai_settings", {
        settings: { ...aiSettings, apiKey: apiKey.trim() || null },
      });
      setAiSettings(saved);
      setApiKey("");
      notify(
        saved.isConfigured
          ? "智能纪要服务已保存，密钥已存入 Windows 凭据库"
          : "服务地址已保存；填写 API 密钥后才会启用智能纪要",
      );
    } catch (error) {
      notify(`无法保存智能纪要设置：${String(error)}`);
    }
  };

  const clearAiKey = async () => {
    try {
      await invoke("clear_ai_api_key");
      setAiSettings((settings) => ({ ...settings, isConfigured: false }));
      setApiKey("");
      notify("已从 Windows 凭据库删除 API 密钥");
    } catch (error) {
      notify(`无法删除密钥：${String(error)}`);
    }
  };

  const saveAsrEngine = async (next: AsrEngineSettings, withKey: boolean) => {
    try {
      const saved = await invoke<AsrEngineSettings>("save_asr_engine_settings", {
        settings: {
          provider: next.provider,
          cloudBaseUrl: next.cloudBaseUrl,
          cloudModel: next.cloudModel,
          apiKey: withKey ? asrKeyInput.trim() || null : null,
        },
      });
      setAsrEngine(saved);
      setAsrKeyInput("");
      notify(
        saved.provider === "cloud"
          ? "已切换为云端转写，录音将按你的配置上传处理"
          : "已切换为本地转写，录音不会离开本机",
      );
    } catch (error) {
      notify(`无法保存转写引擎设置：${String(error)}`);
    }
  };

  const clearCloudAsrKey = async () => {
    try {
      await invoke("clear_cloud_asr_key");
      setAsrEngine((settings) => ({ ...settings, cloudKeySaved: false }));
      setAsrKeyInput("");
      notify("已从 Windows 凭据库删除云端转写密钥");
    } catch (error) {
      notify(`无法删除密钥：${String(error)}`);
    }
  };

  if (loading)
    return (
      <div className="loading">
        <LoaderCircle size={26} className="spin" />
        正在打开知记…
      </div>
    );

  return (
    <div className="app-shell">
      <TitleBar />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">知</span>
          <span>知记</span>
        </div>
        <button className="new-button" onClick={() => void createMeeting()}>
          <Plus size={17} />
          <span>新建会议</span>
        </button>
        <nav className="nav-list">
          <NavItem
            active={view === "home"}
            icon={<House size={18} />}
            onClick={() => setView("home")}
          >
            首页
          </NavItem>
          <NavItem
            active={view === "meetings"}
            icon={<UsersRound size={18} />}
            onClick={() => setView("meetings")}
          >
            会议
          </NavItem>
          <NavItem
            active={view === "tasks"}
            icon={<CheckCircle2 size={18} />}
            onClick={() => setView("tasks")}
          >
            待办
          </NavItem>
        </nav>
        <button className="settings-link" onClick={() => setView("settings")}>
          <Settings size={18} />
          <span>设置与智能功能</span>
        </button>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <h1>
              {
                (
                  {
                    home: "今天",
                    meetings: "会议",
                    tasks: "待办",
                    settings: "设置",
                  } as Record<View, string>
                )[view]
              }
            </h1>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会议标题、纪要与原文"
            />
          </label>
        </header>
        {message && <div className="toast">{message}</div>}
        {view === "home" && (
          <Home
            workspace={workspace}
            onMeeting={() => void createMeeting()}
            onOpenMeeting={(meeting) => {
              setSelectedMeeting(meeting);
              setView("meetings");
            }}
          />
        )}
        {view === "meetings" && (
          <Meetings
            meetings={filteredMeetings}
            meeting={selectedMeeting}
            tasks={workspace.tasks}
            onSelect={setSelectedMeeting}
            onCreate={() => void createMeeting()}
            onChange={setSelectedMeeting}
            onSave={() => void saveMeeting()}
            onDelete={() => void deleteMeeting()}
            onImport={() => void importMeetingAudio()}
            onTask={() => void addTask("meeting", selectedMeeting?.id ?? null)}
            onToggleTask={(task) => void toggleTask(task)}
            recording={recording}
            recordingSeconds={recordingSeconds}
            onRecord={() => void startRecording()}
            onStop={stopRecording}
            asrStatus={asrStatus}
            asrEngine={asrEngine}
            speakerStatus={speakerStatus}
            aiConfigured={aiSettings.isConfigured}
            processing={processing}
            autoSaveHint={autoSaveHint}
            onTranscribe={() => void transcribeMeeting()}
            onTranscribeWithSpeakers={() => void transcribeWithSpeakers()}
            onAnalyze={() => void analyzeMeeting()}
            onRename={() => void renameMeeting()}
            onInstallSpeaker={() => void installSpeakerEngine()}
            onOpenSettings={() => setView("settings")}
          />
        )}
        {view === "tasks" && (
          <Tasks
            tasks={workspace.tasks}
            onAdd={() => void addTask()}
            onToggle={(task) => void toggleTask(task)}
          />
        )}
        {view === "settings" && (
          <SettingsView
            workspace={workspace}
            aiSettings={aiSettings}
            asrStatus={asrStatus}
            asrEngine={asrEngine}
            asrKeyInput={asrKeyInput}
            apiKey={apiKey}
            processing={processing}
            onAiChange={setAiSettings}
            onApiKeyChange={setApiKey}
            onSaveAi={() => void saveAiSettings()}
            onClearAiKey={() => void clearAiKey()}
            onDownloadAsr={() => void downloadLocalAsr()}
            onAsrEngineChange={setAsrEngine}
            onAsrKeyInputChange={setAsrKeyInput}
            onSaveAsrEngine={(next, withKey) => void saveAsrEngine(next, withKey)}
            onClearCloudAsrKey={() => void clearCloudAsrKey()}
          />
        )}
      </main>
    </div>
  );
}

function TitleBar() {
  const appWindow = getCurrentWindow();
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span data-tauri-drag-region>知记 · 本地资料库</span>
      <div className="window-controls" data-tauri-drag-region="false">
        <button onClick={() => void appWindow.minimize()} title="最小化">
          <Minimize2 size={15} />
        </button>
        <button onClick={() => void appWindow.toggleMaximize()} title="最大化">
          <Maximize2 size={14} />
        </button>
        <button
          className="close-window"
          onClick={() => void appWindow.close()}
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function NavItem({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: string;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Home({
  workspace,
  onMeeting,
  onOpenMeeting,
}: {
  workspace: Workspace;
  onMeeting: () => void;
  onOpenMeeting: (meeting: Meeting) => void;
}) {
  const openTasks = workspace.tasks.filter((task) => !task.completed);
  return (
    <div className="page-grid home-grid">
      <section className="home-quickbar">
        <button className="primary-button" onClick={onMeeting}>
          <Mic size={17} /> 开始会议
        </button>
      </section>
      <section className="stats-row">
        <Stat
          icon={<UsersRound />}
          label="全部会议"
          value={workspace.meetings.length}
          tone="brand"
        />
        <Stat
          icon={<CheckCircle2 />}
          label="待完成"
          value={openTasks.length}
          tone="warning"
        />
      </section>
      <section className="panel recent-panel recent-panel-full">
        <div className="panel-title">
          <h3>最近会议</h3>
          <button onClick={onMeeting}>
            新建 <Plus size={14} />
          </button>
        </div>
        {workspace.meetings.slice(0, 6).map((meeting) => (
          <button
            className="recent-row"
            key={meeting.id}
            onClick={() => onOpenMeeting(meeting)}
          >
            <span className="round-icon purple">
              <UsersRound size={16} />
            </span>
            <span>
              <strong>{meeting.title}</strong>
              <small>
                {dateTime(meeting.startedAt)} · {meeting.status}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
        {workspace.meetings.length === 0 && (
          <Empty label="还没有会议，开始记录第一场吧。" />
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = "brand",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "brand" | "info" | "warning";
}) {
  return (
    <div className="stat-card">
      <span className={tone}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function Meetings({
  meetings,
  meeting,
  tasks,
  onSelect,
  onCreate,
  onChange,
  onSave,
  onDelete,
  onImport,
  onTask,
  onToggleTask,
  recording,
  recordingSeconds,
  onRecord,
  onStop,
  asrStatus,
  asrEngine,
  speakerStatus,
  aiConfigured,
  processing,
  autoSaveHint,
  onTranscribe,
  onTranscribeWithSpeakers,
  onAnalyze,
  onRename,
  onInstallSpeaker,
  onOpenSettings,
}: {
  meetings: Meeting[];
  meeting: Meeting | null;
  tasks: Task[];
  onSelect: (meeting: Meeting | null) => void;
  onCreate: () => void;
  onChange: (meeting: Meeting) => void;
  onSave: () => void;
  onDelete: () => void;
  onImport: () => void;
  onTask: () => void;
  onToggleTask: (task: Task) => void;
  recording: boolean;
  recordingSeconds: number;
  onRecord: () => void;
  onStop: () => void;
  asrStatus: LocalAsrStatus;
  asrEngine: AsrEngineSettings;
  speakerStatus: SpeakerEngineStatus;
  aiConfigured: boolean;
  processing: Processing;
  autoSaveHint: string;
  onTranscribe: () => void;
  onTranscribeWithSpeakers: () => void;
  onAnalyze: () => void;
  onRename: () => void;
  onInstallSpeaker: () => void;
  onOpenSettings: () => void;
}) {
  // 音文联动：seekRequest 用于点击说话人段落后跳转音频时间，currentMs 用于高亮当前播放段落
  const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number } | null>(null);
  const [currentMs, setCurrentMs] = useState(-1);
  // 会议详情页 Tab 状态（保留在父级，避免切 Tab 丢状态；AudioPlayer 在 sticky 顶部不进 Tab）
  const [activeTab, setActiveTab] = useState<"notes" | "minutes" | "transcript" | "speakers" | "tasks">(
    "minutes",
  );
  // 会前背景条：默认收起；有内容时收起并显示首行预览，空时展开引导填写
  const [contextOpen, setContextOpen] = useState<boolean | null>(null);
  const contextExpanded = contextOpen ?? !meeting?.context?.trim();

  // 解析说话人段数用于 Tab 计数徽章
  const speakerSegments = useMemo<SpeakerSegment[]>(() => {
    if (!meeting?.speakerSegments) return [];
    try {
      return JSON.parse(meeting.speakerSegments) as SpeakerSegment[];
    } catch {
      return [];
    }
  }, [meeting?.speakerSegments]);

  // 本会议关联待办
  const meetingTasks = useMemo(
    () =>
      meeting
        ? tasks.filter(
            (task) => task.sourceType === "meeting" && task.sourceId === meeting.id,
          )
        : [],
    [tasks, meeting],
  );

  return (
    <div className={`split-layout ${meeting ? "has-meeting" : ""}`}>
      <section className="list-pane">
        <div className="pane-heading">
          <div>
            <h2>全部会议</h2>
            <small>{meetings.length} 场会议</small>
          </div>
          <button className="round-add" onClick={onCreate}>
            <Plus size={18} />
          </button>
        </div>
        {meetings.map((item) => (
          <button
            className={`meeting-item ${meeting?.id === item.id ? "selected" : ""}`}
            onClick={() => onSelect(item)}
            key={item.id}
          >
            <span className="meeting-date">
              {new Date(item.startedAt).getDate()}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>
                {dateTime(item.startedAt)} · {item.status}
              </small>
            </span>
            {item.audioPath && <Mic size={14} />}
          </button>
        ))}
        {meetings.length === 0 && <Empty label="未找到会议。" />}
      </section>
      <section className="editor-pane">
        {meeting ? (
          <>
            <button className="back-to-list" onClick={() => onSelect(null)}>← 会议</button>
            <div className="editor-top">
              <div>
                <div className="title-row">
                  <input
                    className="title-input"
                    value={meeting.title}
                    onChange={(event) =>
                      onChange({ ...meeting, title: event.target.value })
                    }
                  />
                  <button
                    className="secondary-button compact-button"
                    disabled={!aiConfigured || !meeting.transcript.trim() || processing !== null}
                    onClick={onRename}
                    title="根据会议内容，自动按「日期-主题」重新命名"
                  >
                    {processing === "renaming" ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    {processing === "renaming" ? "命名中" : "AI 重命名"}
                  </button>
                </div>
                <div className="meeting-meta">
                  <span>{dateTime(meeting.startedAt)}</span>
                  <span>·</span>
                  <StatusBadge status={meeting.status} />
                </div>
              </div>
              <div className="editor-buttons">
                {autoSaveHint && (
                  <small className="autosave-hint">{autoSaveHint}</small>
                )}
                <button
                  className="icon-danger-button"
                  disabled={recording || processing !== null}
                  onClick={onDelete}
                  title="删除会议"
                >
                  <Trash2 size={16} />
                </button>
                <button className="secondary-button" onClick={onTask}>
                  <Plus size={15} />
                  待办
                </button>
                <button className="primary-button" onClick={onSave}>
                  <Check size={15} />
                  保存
                </button>
              </div>
            </div>
            {/* 会前背景：会议材料/议程/背景说明，转写与生成纪要时作为参考 */}
            <div className={`context-strip ${contextExpanded ? "open" : ""}`}>
              <button
                className="context-strip-head"
                onClick={() => setContextOpen(!contextExpanded)}
              >
                <ChevronRight
                  size={14}
                  style={{
                    transform: contextExpanded ? "rotate(90deg)" : "none",
                    transition: "transform 120ms",
                  }}
                />
                <span>会前背景</span>
                {!contextExpanded && meeting.context.trim() && (
                  <small>{meeting.context.trim().split("\n")[0]}</small>
                )}
                {!contextExpanded && !meeting.context.trim() && (
                  <small className="context-empty">粘贴会议材料/议程，纪要更准</small>
                )}
              </button>
              {contextExpanded && (
                <textarea
                  className="context-input"
                  value={meeting.context}
                  onChange={(event) =>
                    onChange({ ...meeting, context: event.target.value })
                  }
                  placeholder="粘贴会议背景、议程，作为转写与纪要参考"
                  rows={4}
                />
              )}
            </div>
            <div className={`recording-bar ${recording ? "recording" : ""}`}>
              {recording ? (
                <>
                  <span className="recording-wave">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  正在录音 <strong>{duration(recordingSeconds)}</strong>
                  <button className="danger-button" onClick={onStop}>
                    <Square size={13} fill="currentColor" />
                    结束录音并转写
                  </button>
                </>
              ) : processing === "autoTranscribing" ? (
                <>
                  <LoaderCircle size={17} className="spin" />
                  <span>录音已保存，正在本地转写并区分说话人…</span>
                </>
              ) : (
                <>
                  <Mic size={17} />
                  <span>
                    {meeting.audioPath
                      ? meeting.durationSeconds > 0
                        ? `录音 ${duration(meeting.durationSeconds)} 已保存`
                        : "录音已保存"
                      : "在会议开始时录音，音频只保存到本地"}
                  </span>
                  <button
                    className="secondary-button compact-button"
                    disabled={processing !== null}
                    onClick={onImport}
                  >
                    {processing === "importing" ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Upload size={14} />
                    )}
                    {processing === "importing" ? "正在导入" : "导入录音"}
                  </button>
                  <button
                    className="record-button"
                    disabled={processing !== null}
                    onClick={onRecord}
                  >
                    <Mic size={14} />
                    录音并转写
                  </button>
                </>
              )}
            </div>
            {/* sticky 播放器 + AI 工作流：始终常驻 DOM，不进 Tab，保证音文联动不中断 */}
            <div className="sticky-player-bar">
              {!recording && meeting.audioPath ? (
                <AudioPlayer
                  meetingId={meeting.id}
                  audioPath={meeting.audioPath}
                  seekRequest={seekRequest}
                  onTimeUpdate={(seconds) => setCurrentMs(seconds * 1000)}
                />
              ) : null}
              <AiWorkflow
                meeting={meeting}
                asrStatus={asrStatus}
                asrEngine={asrEngine}
                speakerStatus={speakerStatus}
                aiConfigured={aiConfigured}
                processing={processing}
                onTranscribe={onTranscribe}
                onTranscribeWithSpeakers={onTranscribeWithSpeakers}
                onAnalyze={onAnalyze}
                onInstallSpeaker={onInstallSpeaker}
                onOpenSettings={onOpenSettings}
              />
            </div>
            {/* 双栏：左「我的笔记」常驻（开会时随手记，AI 不会覆盖）；右 AI 产出 Tabs */}
            <div className="meeting-dual">
              <section className="my-notes-pane">
                <div className="my-notes-head">
                  <h3>我的笔记</h3>
                  <small>开会时随手记，一直显示在这里，不会被智能纪要覆盖</small>
                </div>
                <textarea
                  className="my-notes-input"
                  value={meeting.notes}
                  onChange={(event) =>
                    onChange({ ...meeting, notes: event.target.value })
                  }
                  placeholder="随时记下你的观察与想法"
                />
              </section>
              <section className="meeting-tabs">
                <div className="tab-bar">
                  <button
                    className={`tab-item tab-notes ${activeTab === "notes" ? "active" : ""}`}
                    onClick={() => setActiveTab("notes")}
                  >
                    我的笔记
                  </button>
                  <button
                    className={`tab-item ${activeTab === "minutes" ? "active" : ""}`}
                    onClick={() => setActiveTab("minutes")}
                  >
                    智能纪要
                  </button>
                  <button
                    className={`tab-item ${activeTab === "transcript" ? "active" : ""}`}
                    onClick={() => setActiveTab("transcript")}
                  >
                    原文转写
                    <span className="count-pill">{meeting.transcript.length}</span>
                  </button>
                  <button
                    className={`tab-item ${activeTab === "speakers" ? "active" : ""}`}
                    onClick={() => setActiveTab("speakers")}
                  >
                    说话人时间线
                    <span className="count-pill">{speakerSegments.length}</span>
                  </button>
                  <button
                    className={`tab-item ${activeTab === "tasks" ? "active" : ""}`}
                    onClick={() => setActiveTab("tasks")}
                  >
                    决策与待办
                    <span className="count-pill">{meetingTasks.length}</span>
                  </button>
                </div>
                <div className="tab-panel" key={activeTab}>
                  {activeTab === "notes" && (
                    <div className="meeting-editor">
                      <div className="editor-field">
                        <h3>我的笔记</h3>
                        <small>开会时随手记，一直显示在这里，不会被智能纪要覆盖</small>
                        <textarea
                          value={meeting.notes}
                          onChange={(event) =>
                            onChange({ ...meeting, notes: event.target.value })
                          }
                          placeholder="随时记下你的观察与想法"
                          style={{ minHeight: 320 }}
                        />
                      </div>
                    </div>
                  )}
                  {activeTab === "minutes" && (
                    <div className="tab-panel-doc">
                      {meeting.minutes.trim() || aiConfigured ? (
                        <EditorField
                          label="会议纪要"
                          hint="智能分析会生成主题、关键讨论、结论、风险与下一步"
                          value={meeting.minutes}
                          onChange={(minutes) => onChange({ ...meeting, minutes })}
                          placeholder="生成纪要后显示在这里"
                        />
                      ) : (
                        <div className="tab-panel-empty">
                          点击上方「生成智能纪要」，AI 会基于转写稿自动生成结构化纪要。
                        </div>
                      )}
                    </div>
                  )}
                  {activeTab === "transcript" && (
                    <EditorField
                      label="原始记录 / 转写稿"
                      hint="本地语音转写会写入这里；也可以粘贴文字记录"
                      value={meeting.transcript}
                      onChange={(transcript) => onChange({ ...meeting, transcript })}
                      placeholder="转写完成后显示在这里"
                    />
                  )}
                  {activeTab === "speakers" &&
                    (speakerSegments.length > 0 ? (
                      <SpeakerTimeline
                        segments={meeting.speakerSegments}
                        currentMs={currentMs}
                        onSeek={(ms) =>
                          setSeekRequest({ time: ms / 1000, nonce: Date.now() })
                        }
                      />
                    ) : (
                      <div className="tab-panel-empty">
                        转写并区分说话人后，这里会显示带发言人的时间线。
                      </div>
                    ))}
                  {activeTab === "tasks" && (
                    <div className="meeting-editor">
                      <EditorField
                        label="决策与共识"
                        hint="只保留明确决定；不确定项会标记待确认"
                        value={meeting.decisions}
                        onChange={(decisions) => onChange({ ...meeting, decisions })}
                        placeholder="例如：周五前交付初稿"
                      />
                      <div>
                        <div className="section-heading">
                          <h3>本会议待办</h3>
                          <button className="secondary-button compact-button" onClick={onTask}>
                            <Plus size={14} />
                            添加
                          </button>
                        </div>
                        {meetingTasks.length > 0 ? (
                          <section className="task-group">
                            {meetingTasks.map((task) => (
                              <label
                                className={`task-row ${task.completed ? "done" : ""}`}
                                key={task.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={task.completed}
                                  onChange={() => onToggleTask(task)}
                                />
                                <span className="checkmark">
                                  {task.completed && <Check size={13} />}
                                </span>
                                <span>{task.title}</span>
                              </label>
                            ))}
                          </section>
                        ) : (
                          <div className="tab-panel-empty">
                            智能纪要生成后会自动提取行动项到这里。也可以手动添加。
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <Empty label="选择一场会议，或创建新的会议。" />
        )}
      </section>
    </div>
  );
}

function AiWorkflow({
  meeting,
  asrStatus,
  asrEngine,
  speakerStatus,
  aiConfigured,
  processing,
  onTranscribe,
  onTranscribeWithSpeakers,
  onAnalyze,
  onInstallSpeaker,
  onOpenSettings,
}: {
  meeting: Meeting;
  asrStatus: LocalAsrStatus;
  asrEngine: AsrEngineSettings;
  speakerStatus: SpeakerEngineStatus;
  aiConfigured: boolean;
  processing: Processing;
  onTranscribe: () => void;
  onTranscribeWithSpeakers: () => void;
  onAnalyze: () => void;
  onInstallSpeaker: () => void;
  onOpenSettings: () => void;
}) {
  const cloud = asrEngine.provider === "cloud";
  const speakerReady = !cloud && speakerStatus.installed;
  const engineReady = cloud ? asrEngine.cloudKeySaved : asrStatus.installed;
  const autoTranscribing = processing === "autoTranscribing";
  const transcribing =
    processing === "transcribing" || processing === "speakerTranscribing";
  // 统一工作流：本地且装了说话人引擎就一起做转写+分离，其余情况只做转写
  const handleTranscribe = speakerReady ? onTranscribeWithSpeakers : onTranscribe;
  return (
    <div className="ai-workflow">
      <div className="ai-flow-copy">
        <Sparkles size={18} />
        <span>
          <strong>录音即转写 · 智能纪要</strong>
          <small>
            {autoTranscribing
              ? cloud
                ? "录音已保存，正在云端转写，请稍候…"
                : "录音已保存，正在本地转写并区分说话人，请稍候…"
              : processing === "installingSpeaker"
                ? "首次安装约需 2–5 分钟；正在后台下载组件，请勿关闭知记。"
                : transcribing
                  ? cloud
                    ? "正在云端转写，录音按你的配置上传处理…"
                    : speakerReady
                      ? "正在本地转写并区分说话人…"
                      : "正在本地转写…"
                  : cloud
                    ? engineReady
                      ? "云端转写已就绪：速度快、不占本机算力；整场录音会发送给你配置的服务商。"
                      : "请在设置中配置云端转写密钥，录音后即可自动转写。"
                    : asrStatus.installed
                      ? speakerReady
                        ? "点击「开始转写」会一次性完成转写与说话人分离。"
                        : "点击「开始转写」即可；安装说话人引擎后会同时区分发言人。"
                      : "请先在设置中下载本地中文语音模型，录音后即可自动转写。"}
          </small>
        </span>
      </div>
      <div className="ai-flow-actions">
        {autoTranscribing ? (
          <button className="secondary-button" disabled>
            <LoaderCircle className="spin" size={15} />
            正在自动转写…
          </button>
        ) : !engineReady ? (
          <button className="secondary-button" onClick={onOpenSettings}>
            {cloud ? "配置云端转写" : "下载本地模型"}
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={!meeting.audioPath || processing !== null}
            onClick={handleTranscribe}
            title={
              cloud
                ? "上传录音到云端服务完成转写"
                : speakerReady
                  ? "一次性完成转写与说话人分离"
                  : "本地转写；安装说话人引擎后会同时区分发言人"
            }
          >
            {transcribing ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Mic size={15} />
            )}
            {transcribing
              ? "正在转写…"
              : cloud
                ? "开始云端转写"
                : speakerReady
                  ? "开始转写（含说话人分离）"
                  : "开始转写"}
          </button>
        )}
        {!cloud && !speakerReady && asrStatus.installed && !autoTranscribing ? (
          <button
            className="secondary-button"
            disabled={processing !== null}
            onClick={onInstallSpeaker}
          >
            {processing === "installingSpeaker" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <UsersRound size={15} />
            )}
            {processing === "installingSpeaker"
              ? "正在安装（请稍候）"
              : "安装说话人引擎"}
          </button>
        ) : null}
        {!aiConfigured ? (
          <button
            className="primary-button"
            disabled={!meeting.transcript.trim()}
            onClick={onOpenSettings}
          >
            <Sparkles size={15} />
            配置智能纪要
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={!meeting.transcript.trim() || processing !== null}
            onClick={onAnalyze}
          >
            {processing === "analyzing" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {processing === "analyzing" ? "正在分析" : "生成智能纪要"}
          </button>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function AudioPlayer({
  meetingId,
  audioPath,
  seekRequest,
  onTimeUpdate,
}: {
  meetingId: string;
  audioPath: string;
  seekRequest: { time: number; nonce: number } | null;
  onTimeUpdate: (seconds: number) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPos, setCurrentPos] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [waitingForMetadata, setWaitingForMetadata] = useState<{
    time: number;
    nonce: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioPath) {
      setAudioUrl(null);
      return;
    }
    setLoading(true);
    setCurrentPos(0);
    setIsPlaying(false);
    setWaitingForMetadata(null);
    void invoke<string>("get_recording_path", { meetingId })
      .then((path) => setAudioUrl(convertFileSrc(path)))
      .catch(() => setAudioUrl(null))
      .finally(() => setLoading(false));
  }, [meetingId, audioPath]);

  // 音文联动：收到 seekRequest 后跳转播放位置并自动播放
  useEffect(() => {
    if (!seekRequest) return;
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      // 元数据尚未加载完成，先记下目标时间，等 onLoadedMetadata 触发后再应用
      setWaitingForMetadata(seekRequest);
      return;
    }
    const target = Math.max(
      0,
      Math.min(totalDuration, seekRequest.time),
    );
    audio.currentTime = target;
    setCurrentPos(target);
    onTimeUpdate(target);
    void audio.play().catch(() => {
      // 浏览器可能拒绝自动播放，忽略错误；用户可手动点击播放
    });
  }, [seekRequest, audioUrl, totalDuration, onTimeUpdate]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !totalDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * totalDuration;
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const seconds = event.currentTarget.currentTime;
    setCurrentPos(seconds);
    onTimeUpdate(seconds);
  };

  const handleLoadedMetadata = (
    event: React.SyntheticEvent<HTMLAudioElement>,
  ) => {
    const duration = event.currentTarget.duration;
    setTotalDuration(duration);
    // 处理等待元数据时挂起的跳转请求
    if (waitingForMetadata) {
      const target = Math.max(0, Math.min(duration, waitingForMetadata.time));
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = target;
        setCurrentPos(target);
        onTimeUpdate(target);
        void audio.play().catch(() => undefined);
      }
      setWaitingForMetadata(null);
    }
  };

  const progress = totalDuration > 0 ? (currentPos / totalDuration) * 100 : 0;

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      <button
        className="audio-play-btn"
        onClick={togglePlay}
        disabled={loading || !audioUrl}
      >
        {loading ? (
          <LoaderCircle className="spin" size={18} />
        ) : isPlaying ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" />
        )}
      </button>
      <span className="audio-time">{formatTime(currentPos)}</span>
      <div className="audio-seek" onClick={handleSeek}>
        <div className="audio-progress" style={{ width: `${progress}%` }} />
      </div>
      <span className="audio-time">{formatTime(totalDuration)}</span>
    </div>
  );
}

function SpeakerTimeline({
  segments,
  currentMs,
  onSeek,
}: {
  segments: string;
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  let items: SpeakerSegment[] = [];
  try {
    items = JSON.parse(segments) as SpeakerSegment[];
  } catch {
    return null;
  }
  if (!items.length) return null;
  return (
    <section className="speaker-timeline">
      <div>
        <h3>说话人时间线</h3>
        <small>
          点击任意段落即可跳转到对应录音时间点；播放时当前段落会高亮。
        </small>
      </div>
      {items.map((item, index) => {
        const active =
          currentMs >= 0 && currentMs >= item.startMs && currentMs < item.endMs;
        return (
          <button
            type="button"
            className={`speaker-row ${active ? "active" : ""}`}
            key={`${item.startMs}-${index}`}
            onClick={() => onSeek(item.startMs)}
            title={`跳转到 ${duration(Math.floor(item.startMs / 1000))}`}
          >
            <span>{item.speaker}</span>
            <small>
              {duration(Math.floor(item.startMs / 1000))}–
              {duration(Math.floor(item.endMs / 1000))}
            </small>
            <p>{item.text}</p>
          </button>
        );
      })}
    </section>
  );
}

// 状态徽章：根据会议 status 字符串返回对应配色的 pill
function StatusBadge({ status }: { status: string }) {
  let cls = "neutral";
  if (status.includes("区分") || status.includes("发言人")) {
    cls = "brand";
  } else if (status.includes("纪要") || status.includes("分析")) {
    cls = "success";
  } else if (status.includes("转写")) {
    cls = "info";
  } else if (status.includes("录音") || status.includes("导入")) {
    cls = "info";
  } else if (status === "草稿") {
    cls = "neutral";
  }
  return <span className={`status-badge ${cls}`}>{status}</span>;
}


function EditorField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="editor-field">
      <div>
        <h3>{label}</h3>
        <small>{hint}</small>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Tasks({
  tasks,
  onAdd,
  onToggle,
}: {
  tasks: Task[];
  onAdd: () => void;
  onToggle: (task: Task) => void;
}) {
  const open = tasks.filter((task) => !task.completed);
  const done = tasks.filter((task) => task.completed);
  return (
    <div className="tasks-page">
      <div className="tasks-intro">
        <div>
          <h2>专注下一步</h2>
          <p>智能纪要提取的行动项，会自动出现在这里。</p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={16} />
          新建待办
        </button>
      </div>
      <TaskGroup title="待完成" tasks={open} onToggle={onToggle} />
      <TaskGroup title="已完成" tasks={done} onToggle={onToggle} />
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  onToggle,
}: {
  title: string;
  tasks: Task[];
  onToggle: (task: Task) => void;
}) {
  return (
    <section className="task-group">
      <div className="group-heading">
        <h3>{title}</h3>
        <span>{tasks.length}</span>
      </div>
      {tasks.length ? (
        tasks.map((task) => (
          <label
            className={`task-row ${task.completed ? "done" : ""}`}
            key={task.id}
          >
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => onToggle(task)}
            />
            <span className="checkmark">
              {task.completed && <Check size={13} />}
            </span>
            <span>{task.title}</span>
            {task.sourceType && (
              <small>{task.sourceType === "meeting" ? "会议" : "笔记"}</small>
            )}
          </label>
        ))
      ) : (
        <Empty
          label={
            title === "待完成"
              ? "没有待办，给自己留一点空白。"
              : "完成的事项会保留在这里。"
          }
        />
      )}
    </section>
  );
}

function SettingsView({
  workspace,
  aiSettings,
  asrStatus,
  asrEngine,
  asrKeyInput,
  apiKey,
  processing,
  onAiChange,
  onApiKeyChange,
  onSaveAi,
  onClearAiKey,
  onDownloadAsr,
  onAsrEngineChange,
  onAsrKeyInputChange,
  onSaveAsrEngine,
  onClearCloudAsrKey,
}: {
  workspace: Workspace;
  aiSettings: AiSettings;
  asrStatus: LocalAsrStatus;
  asrEngine: AsrEngineSettings;
  asrKeyInput: string;
  apiKey: string;
  processing: Processing;
  onAiChange: (settings: AiSettings) => void;
  onApiKeyChange: (key: string) => void;
  onSaveAi: () => void;
  onClearAiKey: () => void;
  onDownloadAsr: () => void;
  onAsrEngineChange: (settings: AsrEngineSettings) => void;
  onAsrKeyInputChange: (key: string) => void;
  onSaveAsrEngine: (next: AsrEngineSettings, withKey: boolean) => void;
  onClearCloudAsrKey: () => void;
}) {
  const cloud = asrEngine.provider === "cloud";
  const presetValue =
    CLOUD_ASR_PRESETS.find(
      (preset) =>
        preset.baseUrl === asrEngine.cloudBaseUrl &&
        preset.model === asrEngine.cloudModel,
    )?.label ?? "custom";
  return (
    <div className="settings-page">
      <section className="settings-hero">
        <span className="round-icon purple">
          <Sparkles size={19} />
        </span>
        <div>
          <h2>引擎由你选，数据在你手里</h2>
          <p>
            转写可以在本机离线完成，也可以走你配置的云端服务（录音只发给该服务商）；智能纪要只发送转写文字。录音与资料库始终保存在这台电脑。
          </p>
        </div>
      </section>
      <h3 className="settings-section-title">转写引擎</h3>
      <section className="settings-card ai-settings">
        <div>
          <h3>引擎选择</h3>
          <p>
            本地：离线免费、录音不出本机，首次需下载模型。云端：更快，整场录音发往你配置的服务商。
          </p>
        </div>
        <div className="engine-switch">
          <label className={cloud ? "" : "active"}>
            <input
              type="radio"
              name="asr-provider"
              checked={!cloud}
              onChange={() =>
                onSaveAsrEngine({ ...asrEngine, provider: "local" }, false)
              }
            />
            本地转写
          </label>
          <label className={cloud ? "active" : ""}>
            <input
              type="radio"
              name="asr-provider"
              checked={cloud}
              onChange={() =>
                onAsrEngineChange({ ...asrEngine, provider: "cloud" })
              }
            />
            云端转写
          </label>
        </div>
        {cloud && !asrEngine.cloudKeySaved && (
          <small className="runtime-warning">
            保存密钥后，云端转写生效。
          </small>
        )}
      </section>
      {!cloud && (
        <section className="settings-card ai-settings">
          <div>
            <h3>本地中文语音模型</h3>
            <p>
              SenseVoiceSmall Q8 +
              FSMN-VAD。模型仅首次下载，之后离线运行；适合普通 Windows
              电脑的中文会议转写。
            </p>
          </div>
          <span className={`ai-status ${asrStatus.installed ? "ready" : ""}`}>
            {asrStatus.installed
              ? `已安装 ${asrStatus.modelSizeMb} MB`
              : "尚未下载"}
          </span>
          <div className="settings-actions">
            <button
              className="primary-button"
              disabled={processing !== null || asrStatus.installed}
              onClick={onDownloadAsr}
            >
              {processing === "downloading" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Mic size={16} />
              )}
              {processing === "downloading"
                ? "正在下载模型"
                : asrStatus.installed
                  ? "模型已就绪"
                  : "下载本地模型"}
            </button>
            {!asrStatus.runtimeAvailable && (
              <small className="runtime-warning">
                语音运行时将在 Windows 安装包中提供。
              </small>
            )}
          </div>
        </section>
      )}
      {cloud && (
        <section className="settings-card ai-settings">
          <div>
            <h3>云端转写服务</h3>
            <p>
              兼容 OpenAI 的 /audio/transcriptions
              接口。点转写后整场录音会发送到该服务商处理；API 密钥存入
              Windows 凭据库，不写入 SQLite。
            </p>
          </div>
          <span
            className={`ai-status ${asrEngine.cloudKeySaved ? "ready" : ""}`}
          >
            {asrEngine.cloudKeySaved ? "已配置" : "未配置"}
          </span>
          <div className="ai-grid">
            <label>
              服务商预设
              <select
                value={presetValue}
                onChange={(event) => {
                  const preset = CLOUD_ASR_PRESETS.find(
                    (item) => item.label === event.target.value,
                  );
                  if (preset) {
                    onAsrEngineChange({
                      ...asrEngine,
                      cloudBaseUrl: preset.baseUrl,
                      cloudModel: preset.model,
                    });
                  }
                }}
              >
                {CLOUD_ASR_PRESETS.map((preset) => (
                  <option value={preset.label} key={preset.label}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">自定义</option>
              </select>
            </label>
            <label>
              服务地址
              <input
                value={asrEngine.cloudBaseUrl}
                onChange={(event) =>
                  onAsrEngineChange({
                    ...asrEngine,
                    cloudBaseUrl: event.target.value,
                  })
                }
                placeholder="https://api.siliconflow.cn/v1"
              />
            </label>
            <label>
              转写模型
              <input
                value={asrEngine.cloudModel}
                onChange={(event) =>
                  onAsrEngineChange({
                    ...asrEngine,
                    cloudModel: event.target.value,
                  })
                }
                placeholder="FunAudioLLM/SenseVoiceSmall"
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                value={asrKeyInput}
                onChange={(event) => onAsrKeyInputChange(event.target.value)}
                placeholder={
                  asrEngine.cloudKeySaved
                    ? "已保存；留空即可保留原密钥"
                    : "粘贴 API 密钥"
                }
              />
            </label>
          </div>
          <div className="settings-actions">
            <button
              className="primary-button"
              disabled={processing !== null}
              onClick={() => onSaveAsrEngine({ ...asrEngine, provider: "cloud" }, true)}
            >
              <Check size={16} />
              保存云端转写设置
            </button>
            {asrEngine.cloudKeySaved && (
              <button className="secondary-button" onClick={onClearCloudAsrKey}>
                删除密钥
              </button>
            )}
          </div>
        </section>
      )}
      <h3 className="settings-section-title">智能纪要（云端）</h3>
      <section className="settings-card ai-settings">
        <div>
          <h3>智能纪要服务（可选）</h3>
          <p>
            兼容 OpenAI
            的聊天补全接口。只在你点击分析后发送转写文本，不发送录音；API
            密钥保存到 Windows 凭据库，不写入 SQLite。
          </p>
        </div>
        <span className={`ai-status ${aiSettings.isConfigured ? "ready" : ""}`}>
          {aiSettings.isConfigured ? "已配置" : "未配置"}
        </span>
        <div className="ai-grid">
          <label>
            服务地址
            <input
              value={aiSettings.baseUrl}
              onChange={(event) =>
                onAiChange({ ...aiSettings, baseUrl: event.target.value })
              }
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            纪要模型
            <input
              value={aiSettings.analysisModel}
              onChange={(event) =>
                onAiChange({ ...aiSettings, analysisModel: event.target.value })
              }
              placeholder="gpt-4o-mini"
            />
          </label>
          <label>
            API 密钥
            <input
              type="password"
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={
                aiSettings.isConfigured
                  ? "已保存；留空即可保留原密钥"
                  : "粘贴 API 密钥"
              }
            />
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary-button" onClick={onSaveAi}>
            <Check size={16} />
            保存智能纪要设置
          </button>
          {aiSettings.isConfigured && (
            <button className="secondary-button" onClick={onClearAiKey}>
              删除密钥
            </button>
          )}
        </div>
      </section>
      <h3 className="settings-section-title">数据</h3>
      <section className="settings-card">
        <div>
          <h3>本地资料库</h3>
          <p>
            当前保存 {workspace.meetings.length} 场会议和{" "}
            {workspace.tasks.length} 项待办。数据使用 SQLite
            存储在 Windows 应用资料目录。
          </p>
        </div>
      </section>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <MoreHorizontal size={22} />
      <p>{label}</p>
    </div>
  );
}
