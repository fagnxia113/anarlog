import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  House,
  LoaderCircle,
  Maximize2,
  Mic,
  Minimize2,
  MoreHorizontal,
  NotebookPen,
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
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Notebook = { id: string; name: string; color: string; createdAt: string };
type Note = {
  id: string;
  notebookId: string | null;
  title: string;
  content: string;
  tags: string;
  updatedAt: string;
};
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
};
type Task = {
  id: string;
  title: string;
  sourceType: string | null;
  sourceId: string | null;
  completed: boolean;
  dueDate: string | null;
  createdAt: string;
};
type Workspace = {
  notebooks: Notebook[];
  notes: Note[];
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
type SpeakerSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};
type AnalysisResult = { meeting: Meeting; tasks: Task[] };
type View = "home" | "meetings" | "notes" | "tasks" | "settings";
type Processing =
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "installingSpeaker"
  | "speakerTranscribing"
  | "importing"
  | "deleting"
  | "autoTranscribing"
  | null;

const emptyWorkspace: Workspace = {
  notebooks: [],
  notes: [],
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
  const [apiKey, setApiKey] = useState("");
  const [view, setView] = useState<View>("home");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState<Processing>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingSecondsRef = useRef(0);
  const asrStatusRef = useRef(asrStatus);
  const speakerStatusRef = useRef(speakerStatus);

  useEffect(() => {
    asrStatusRef.current = asrStatus;
  }, [asrStatus]);
  useEffect(() => {
    speakerStatusRef.current = speakerStatus;
  }, [speakerStatus]);

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
    ])
      .then(([, settings, asr, speaker]) => {
        if (!active) return;
        setAiSettings(settings);
        setAsrStatus(asr);
        setSpeakerStatus(speaker);
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

  const filteredMeetings = useMemo(
    () =>
      workspace.meetings.filter((meeting) =>
        `${meeting.title} ${meeting.transcript} ${meeting.minutes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, workspace.meetings],
  );
  const filteredNotes = useMemo(
    () =>
      workspace.notes.filter((note) =>
        `${note.title} ${note.content} ${note.tags}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, workspace.notes],
  );

  const createMeeting = async () => {
    const meeting = await invoke<Meeting>("create_meeting", {
      notebookId: workspace.notebooks[0]?.id ?? null,
    });
    setSelectedMeeting(meeting);
    setView("meetings");
    await reload();
  };

  const createNote = async () => {
    const note = await invoke<Note>("create_note", {
      notebookId: workspace.notebooks[0]?.id ?? null,
    });
    setSelectedNote(note);
    setView("notes");
    await reload();
  };

  const saveMeeting = async () => {
    if (!selectedMeeting) return;
    await invoke("save_meeting", { meeting: selectedMeeting });
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

  const saveNote = async () => {
    if (!selectedNote) return;
    await invoke("save_note", { note: selectedNote });
    await reload();
    notify("笔记已保存到本地");
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const meetingId = selectedMeeting.id;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        void (async () => {
          try {
            const blob = new Blob(chunks.current, {
              type: mediaRecorder.mimeType || "audio/webm",
            });
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            await invoke("save_recording", {
              meetingId,
              dataUrl,
              durationSeconds: recordingSecondsRef.current,
            });
            const latest = await reload();
            setSelectedMeeting(
              latest.meetings.find((meeting) => meeting.id === meetingId) ??
                null,
            );

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
      mediaRecorder.start(1000);
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
      notify("本地语音转写完成，已写入原始记录");
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
          新建会议
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
            active={view === "notes"}
            icon={<NotebookPen size={18} />}
            onClick={() => setView("notes")}
          >
            笔记本
          </NavItem>
          <NavItem
            active={view === "tasks"}
            icon={<CheckCircle2 size={18} />}
            onClick={() => setView("tasks")}
          >
            待办
          </NavItem>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">笔记本</div>
          {workspace.notebooks.map((notebook) => (
            <div className="notebook-row" key={notebook.id}>
              <span style={{ background: notebook.color }} />
              <span>{notebook.name}</span>
              <small>
                {
                  workspace.notes.filter(
                    (note) => note.notebookId === notebook.id,
                  ).length
                }
              </small>
            </div>
          ))}
        </div>
        <button className="settings-link" onClick={() => setView("settings")}>
          <Settings size={18} />
          设置与智能功能
        </button>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">个人会议纪要与笔记本</p>
            <h1>
              {
                (
                  {
                    home: "今天",
                    meetings: "会议",
                    notes: "笔记本",
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
              placeholder="搜索会议和笔记"
            />
          </label>
        </header>
        {message && <div className="toast">{message}</div>}
        {view === "home" && (
          <Home
            workspace={workspace}
            onMeeting={() => void createMeeting()}
            onNote={() => void createNote()}
            onOpenMeeting={(meeting) => {
              setSelectedMeeting(meeting);
              setView("meetings");
            }}
            onOpenNote={(note) => {
              setSelectedNote(note);
              setView("notes");
            }}
          />
        )}
        {view === "meetings" && (
          <Meetings
            meetings={filteredMeetings}
            meeting={selectedMeeting}
            onSelect={setSelectedMeeting}
            onCreate={() => void createMeeting()}
            onChange={setSelectedMeeting}
            onSave={() => void saveMeeting()}
            onDelete={() => void deleteMeeting()}
            onImport={() => void importMeetingAudio()}
            onTask={() => void addTask("meeting", selectedMeeting?.id ?? null)}
            recording={recording}
            recordingSeconds={recordingSeconds}
            onRecord={() => void startRecording()}
            onStop={stopRecording}
            asrStatus={asrStatus}
            speakerStatus={speakerStatus}
            aiConfigured={aiSettings.isConfigured}
            processing={processing}
            onTranscribe={() => void transcribeMeeting()}
            onTranscribeWithSpeakers={() => void transcribeWithSpeakers()}
            onAnalyze={() => void analyzeMeeting()}
            onInstallSpeaker={() => void installSpeakerEngine()}
            onOpenSettings={() => setView("settings")}
          />
        )}
        {view === "notes" && (
          <Notes
            notes={filteredNotes}
            notebooks={workspace.notebooks}
            note={selectedNote}
            onSelect={setSelectedNote}
            onCreate={() => void createNote()}
            onChange={setSelectedNote}
            onSave={() => void saveNote()}
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
            apiKey={apiKey}
            processing={processing}
            onAiChange={setAiSettings}
            onApiKeyChange={setApiKey}
            onSaveAi={() => void saveAiSettings()}
            onClearAiKey={() => void clearAiKey()}
            onDownloadAsr={() => void downloadLocalAsr()}
            onCreateNotebook={async () => {
              const name = window.prompt("笔记本名称");
              if (!name?.trim()) return;
              await invoke("create_notebook", {
                name: name.trim(),
                color: "#4f7cff",
              });
              await reload();
              notify("笔记本已创建");
            }}
            onBackup={async () => {
              const path = await invoke<string>("backup_workspace");
              notify(`备份已创建：${path}`);
            }}
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
  onNote,
  onOpenMeeting,
  onOpenNote,
}: {
  workspace: Workspace;
  onMeeting: () => void;
  onNote: () => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onOpenNote: (note: Note) => void;
}) {
  const openTasks = workspace.tasks.filter((task) => !task.completed);
  return (
    <div className="page-grid home-grid">
      <section className="welcome-card">
        <div>
          <span className="eyebrow">录音即转写 · 智能纪要 · 行动</span>
          <h2>点一下录音，说完就有纪要。</h2>
          <p>
            录音停止后自动本地转写并区分说话人，全程不上传音频。需要智能纪要时，再由你主动选择已配置的服务处理文字稿。
          </p>
        </div>
        <div className="welcome-actions">
          <button className="primary-button" onClick={onMeeting}>
            <Mic size={17} />
            开始会议
          </button>
          <button className="secondary-button" onClick={onNote}>
            <FileText size={17} />
            新建笔记
          </button>
        </div>
      </section>
      <section className="stats-row">
        <Stat
          icon={<UsersRound />}
          label="全部会议"
          value={workspace.meetings.length}
        />
        <Stat
          icon={<NotebookPen />}
          label="全部笔记"
          value={workspace.notes.length}
        />
        <Stat icon={<CheckCircle2 />} label="待完成" value={openTasks.length} />
      </section>
      <section className="panel recent-panel">
        <div className="panel-title">
          <h3>最近会议</h3>
          <button onClick={onMeeting}>
            新建 <Plus size={14} />
          </button>
        </div>
        {workspace.meetings.slice(0, 4).map((meeting) => (
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
      <section className="panel recent-panel">
        <div className="panel-title">
          <h3>最近笔记</h3>
          <button onClick={onNote}>
            新建 <Plus size={14} />
          </button>
        </div>
        {workspace.notes.slice(0, 4).map((note) => (
          <button
            className="recent-row"
            key={note.id}
            onClick={() => onOpenNote(note)}
          >
            <span className="round-icon yellow">
              <FileText size={16} />
            </span>
            <span>
              <strong>{note.title}</strong>
              <small>{note.content || "空白笔记"}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
        {workspace.notes.length === 0 && <Empty label="还没有笔记。" />}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
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
  onSelect,
  onCreate,
  onChange,
  onSave,
  onDelete,
  onImport,
  onTask,
  recording,
  recordingSeconds,
  onRecord,
  onStop,
  asrStatus,
  speakerStatus,
  aiConfigured,
  processing,
  onTranscribe,
  onTranscribeWithSpeakers,
  onAnalyze,
  onInstallSpeaker,
  onOpenSettings,
}: {
  meetings: Meeting[];
  meeting: Meeting | null;
  onSelect: (meeting: Meeting) => void;
  onCreate: () => void;
  onChange: (meeting: Meeting) => void;
  onSave: () => void;
  onDelete: () => void;
  onImport: () => void;
  onTask: () => void;
  recording: boolean;
  recordingSeconds: number;
  onRecord: () => void;
  onStop: () => void;
  asrStatus: LocalAsrStatus;
  speakerStatus: SpeakerEngineStatus;
  aiConfigured: boolean;
  processing: Processing;
  onTranscribe: () => void;
  onTranscribeWithSpeakers: () => void;
  onAnalyze: () => void;
  onInstallSpeaker: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="split-layout">
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
            <div className="editor-top">
              <div>
                <input
                  className="title-input"
                  value={meeting.title}
                  onChange={(event) =>
                    onChange({ ...meeting, title: event.target.value })
                  }
                />
                <small>
                  {dateTime(meeting.startedAt)} · {meeting.status}
                </small>
              </div>
              <div className="editor-buttons">
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
            <div className="recording-bar">
              {recording ? (
                <>
                  <span className="recording-dot" />
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
            {!recording && meeting.audioPath ? (
              <AudioPlayer meetingId={meeting.id} audioPath={meeting.audioPath} />
            ) : null}
            <AiWorkflow
              meeting={meeting}
              asrStatus={asrStatus}
              speakerStatus={speakerStatus}
              aiConfigured={aiConfigured}
              processing={processing}
              onTranscribe={onTranscribe}
              onTranscribeWithSpeakers={onTranscribeWithSpeakers}
              onAnalyze={onAnalyze}
              onInstallSpeaker={onInstallSpeaker}
              onOpenSettings={onOpenSettings}
            />
            <SpeakerTimeline segments={meeting.speakerSegments} />
            <div className="meeting-editor">
              <EditorField
                label="会议纪要"
                hint="智能分析会生成主题、关键讨论、结论、风险与下一步"
                value={meeting.minutes}
                onChange={(minutes) => onChange({ ...meeting, minutes })}
                placeholder="可手动记录，或点击智能纪要生成…"
              />
              <EditorField
                label="决策与共识"
                hint="只保留明确决定；不确定项会标记待确认"
                value={meeting.decisions}
                onChange={(decisions) => onChange({ ...meeting, decisions })}
                placeholder="例如：下周三前交付第一版原型"
              />
              <EditorField
                label="原始记录 / 转写稿"
                hint="本地语音转写会写入这里；也可以粘贴文字记录"
                value={meeting.transcript}
                onChange={(transcript) => onChange({ ...meeting, transcript })}
                placeholder="在这里保留完整上下文…"
              />
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
  speakerStatus: SpeakerEngineStatus;
  aiConfigured: boolean;
  processing: Processing;
  onTranscribe: () => void;
  onTranscribeWithSpeakers: () => void;
  onAnalyze: () => void;
  onInstallSpeaker: () => void;
  onOpenSettings: () => void;
}) {
  const speakerReady = speakerStatus.installed;
  const autoTranscribing = processing === "autoTranscribing";
  return (
    <div className="ai-workflow">
      <div className="ai-flow-copy">
        <Sparkles size={18} />
        <span>
          <strong>录音即转写 · 智能纪要</strong>
          <small>
            {autoTranscribing
              ? "录音已保存，正在本地转写并区分说话人，请稍候…"
              : processing === "installingSpeaker"
                ? "首次安装约需 2–5 分钟；正在后台下载组件，请勿关闭知记。"
                : asrStatus.installed
                  ? `录音停止后自动转写${speakerReady ? "并区分说话人" : ""}；${speakerReady ? "说话人分离引擎已就绪。" : "可在设置中安装说话人分离引擎。"}`
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
        ) : !asrStatus.installed ? (
          <button className="secondary-button" onClick={onOpenSettings}>
            下载本地模型
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={!meeting.audioPath || processing !== null}
            onClick={onTranscribe}
          >
            {processing === "transcribing" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Mic size={15} />
            )}
            {processing === "transcribing" ? "正在本地转写" : "重新转写"}
          </button>
        )}
        {speakerReady ? (
          <button
            className="secondary-button"
            disabled={!meeting.audioPath || processing !== null}
            onClick={onTranscribeWithSpeakers}
          >
            {processing === "speakerTranscribing" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <UsersRound size={15} />
            )}
            {processing === "speakerTranscribing"
              ? "正在区分发言人"
              : speakerStatus.modelsReady
                ? "重新区分说话人"
                : "下载会议模型并区分"}
          </button>
        ) : (
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
        )}
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
}: {
  meetingId: string;
  audioPath: string;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPos, setCurrentPos] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioPath) {
      setAudioUrl(null);
      return;
    }
    setLoading(true);
    setCurrentPos(0);
    setIsPlaying(false);
    void invoke<string>("read_recording", { meetingId })
      .then((url) => setAudioUrl(url))
      .catch(() => setAudioUrl(null))
      .finally(() => setLoading(false));
  }, [meetingId, audioPath]);

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

  const progress = totalDuration > 0 ? (currentPos / totalDuration) * 100 : 0;

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setTotalDuration(e.currentTarget.duration)}
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

function SpeakerTimeline({ segments }: { segments: string }) {
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
        <small>发言人编号由本地声纹聚类生成，可用于追溯“谁说了什么”。</small>
      </div>
      {items.map((item, index) => (
        <div className="speaker-row" key={`${item.startMs}-${index}`}>
          <span>{item.speaker}</span>
          <small>
            {duration(Math.floor(item.startMs / 1000))}–
            {duration(Math.floor(item.endMs / 1000))}
          </small>
          <p>{item.text}</p>
        </div>
      ))}
    </section>
  );
}

function Notes({
  notes,
  notebooks,
  note,
  onSelect,
  onCreate,
  onChange,
  onSave,
}: {
  notes: Note[];
  notebooks: Notebook[];
  note: Note | null;
  onSelect: (note: Note) => void;
  onCreate: () => void;
  onChange: (note: Note) => void;
  onSave: () => void;
}) {
  return (
    <div className="split-layout">
      <section className="list-pane">
        <div className="pane-heading">
          <div>
            <h2>全部笔记</h2>
            <small>{notes.length} 条笔记</small>
          </div>
          <button className="round-add" onClick={onCreate}>
            <Plus size={18} />
          </button>
        </div>
        {notes.map((item) => (
          <button
            className={`note-item ${note?.id === item.id ? "selected" : ""}`}
            onClick={() => onSelect(item)}
            key={item.id}
          >
            <FileText size={17} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.content || "空白笔记"}</small>
            </span>
          </button>
        ))}
        {notes.length === 0 && <Empty label="还没有笔记。" />}
      </section>
      <section className="editor-pane note-editor">
        {note ? (
          <>
            <div className="editor-top">
              <div>
                <input
                  className="title-input"
                  value={note.title}
                  onChange={(event) =>
                    onChange({ ...note, title: event.target.value })
                  }
                />
                <small>上次编辑于 {dateTime(note.updatedAt)}</small>
              </div>
              <button className="primary-button" onClick={onSave}>
                <Check size={15} />
                保存
              </button>
            </div>
            <div className="note-meta">
              <FolderOpen size={15} />
              <select
                value={note.notebookId ?? ""}
                onChange={(event) =>
                  onChange({ ...note, notebookId: event.target.value || null })
                }
              >
                <option value="">未分类</option>
                {notebooks.map((notebook) => (
                  <option value={notebook.id} key={notebook.id}>
                    {notebook.name}
                  </option>
                ))}
              </select>
              <input
                value={note.tags}
                onChange={(event) =>
                  onChange({ ...note, tags: event.target.value })
                }
                placeholder="标签，用逗号分隔"
              />
            </div>
            <textarea
              className="note-content"
              value={note.content}
              onChange={(event) =>
                onChange({ ...note, content: event.target.value })
              }
              placeholder="开始书写…"
            />
          </>
        ) : (
          <Empty label="选择一条笔记，或新建笔记。" />
        )}
      </section>
    </div>
  );
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
  apiKey,
  processing,
  onAiChange,
  onApiKeyChange,
  onSaveAi,
  onClearAiKey,
  onDownloadAsr,
  onCreateNotebook,
  onBackup,
}: {
  workspace: Workspace;
  aiSettings: AiSettings;
  asrStatus: LocalAsrStatus;
  apiKey: string;
  processing: Processing;
  onAiChange: (settings: AiSettings) => void;
  onApiKeyChange: (key: string) => void;
  onSaveAi: () => void;
  onClearAiKey: () => void;
  onDownloadAsr: () => void;
  onCreateNotebook: () => void;
  onBackup: () => void;
}) {
  return (
    <div className="settings-page">
      <section className="settings-hero">
        <span className="round-icon purple">
          <Sparkles size={19} />
        </span>
        <div>
          <h2>语音识别在本机，智能纪要由你决定</h2>
          <p>
            录音、自动转写与说话人区分始终在这台电脑完成。只有点击"生成智能纪要"时，才会把转写文字发送给你配置的服务；绝不会上传录音。
          </p>
        </div>
      </section>
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
      <section className="settings-card">
        <div>
          <h3>笔记本</h3>
          <p>用笔记本把会议和普通笔记归类。</p>
        </div>
        <button className="secondary-button" onClick={onCreateNotebook}>
          <Plus size={16} />
          新建笔记本
        </button>
      </section>
      <section className="settings-card">
        <div>
          <h3>本地资料库</h3>
          <p>
            当前保存 {workspace.meetings.length} 场会议、
            {workspace.notes.length} 条笔记和 {workspace.tasks.length}{" "}
            项待办。数据使用 SQLite 存储在 Windows 应用资料目录。
          </p>
        </div>
      </section>
      <section className="settings-card">
        <div>
          <h3>立即备份</h3>
          <p>创建一个包含 SQLite 资料库与全部会议录音的本机副本。</p>
        </div>
        <button className="secondary-button" onClick={onBackup}>
          <Archive size={16} />
          创建备份
        </button>
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
