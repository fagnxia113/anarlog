import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  Menu,
  Mic,
  Minimize2,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Square,
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
type Workspace = { notebooks: Notebook[]; notes: Note[]; meetings: Meeting[]; tasks: Task[] };
type View = "home" | "meetings" | "notes" | "tasks" | "settings";

const blankWorkspace: Workspace = { notebooks: [], notes: [], meetings: [], tasks: [] };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function makeTask(title: string, sourceType: string | null = null, sourceId: string | null = null): Task {
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
  const [workspace, setWorkspace] = useState<Workspace>(blankWorkspace);
  const [view, setView] = useState<View>("home");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingSecondsRef = useRef(0);

  const reload = async () => {
    const next = await invoke<Workspace>("load_workspace");
    setWorkspace(next);
    return next;
  };

  useEffect(() => {
    void reload()
      .catch((error: unknown) => setMessage(`无法打开本地资料库：${String(error)}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      recordingSecondsRef.current += 1;
      setRecordingSeconds(recordingSecondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const filteredNotes = useMemo(
    () =>
      workspace.notes.filter((note) => `${note.title} ${note.content} ${note.tags}`.toLowerCase().includes(query.toLowerCase())),
    [query, workspace.notes],
  );
  const filteredMeetings = useMemo(
    () => workspace.meetings.filter((meeting) => `${meeting.title} ${meeting.minutes} ${meeting.transcript}`.toLowerCase().includes(query.toLowerCase())),
    [query, workspace.meetings],
  );

  const notify = (next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage(""), 2600);
  };

  const createNote = async () => {
    const note = await invoke<Note>("create_note", { notebookId: workspace.notebooks[0]?.id ?? null });
    setSelectedNote(note);
    setView("notes");
    await reload();
  };

  const createMeeting = async () => {
    const meeting = await invoke<Meeting>("create_meeting", { notebookId: workspace.notebooks[0]?.id ?? null });
    setSelectedMeeting(meeting);
    setView("meetings");
    await reload();
  };

  const saveNote = async () => {
    if (!selectedNote) return;
    await invoke("save_note", { note: selectedNote });
    await reload();
    notify("笔记已保存到本地");
  };

  const saveMeeting = async () => {
    if (!selectedMeeting) return;
    await invoke("save_meeting", { meeting: selectedMeeting });
    await reload();
    notify("会议纪要已保存到本地");
  };

  const addTask = async (sourceType: string | null = null, sourceId: string | null = null) => {
    const title = window.prompt("待办事项");
    if (!title?.trim()) return;
    await invoke("upsert_task", { task: makeTask(title.trim(), sourceType, sourceId) });
    await reload();
    notify("已加入待办");
  };

  const toggleTask = async (task: Task) => {
    await invoke("upsert_task", { task: { ...task, completed: !task.completed } });
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
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await invoke("save_recording", {
          meetingId: selectedMeeting.id,
          dataUrl,
          durationSeconds: recordingSecondsRef.current,
        });
        const updated = { ...selectedMeeting, audioPath: "已保存在本地", durationSeconds: recordingSecondsRef.current, status: "已录音" };
        setSelectedMeeting(updated);
        await reload();
        notify("录音已保存到本地资料库");
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

  if (loading) {
    return <div className="loading"><LoaderCircle size={26} className="spin" /> 正在打开知记…</div>;
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">知</span><span>知记</span></div>
        <button className="new-button" onClick={() => void createMeeting()}><Plus size={17} /> 新建会议</button>
        <nav className="nav-list">
          <NavItem icon={<House size={18} />} active={view === "home"} onClick={() => setView("home")}>首页</NavItem>
          <NavItem icon={<UsersRound size={18} />} active={view === "meetings"} onClick={() => setView("meetings")}>会议</NavItem>
          <NavItem icon={<NotebookPen size={18} />} active={view === "notes"} onClick={() => setView("notes")}>笔记本</NavItem>
          <NavItem icon={<CheckCircle2 size={18} />} active={view === "tasks"} onClick={() => setView("tasks")}>待办</NavItem>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">笔记本</div>
          {workspace.notebooks.map((notebook) => <div className="notebook-row" key={notebook.id}><span style={{ background: notebook.color }} /><span>{notebook.name}</span><small>{workspace.notes.filter((note) => note.notebookId === notebook.id).length}</small></div>)}
        </div>
        <button className="settings-link" onClick={() => setView("settings")}><Settings size={18} /> 设置与备份</button>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div><p className="eyebrow">个人会议纪要与笔记本</p><h1>{({ home: "今天", meetings: "会议", notes: "笔记本", tasks: "待办", settings: "设置" } as Record<View, string>)[view]}</h1></div>
          <div className="header-actions"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会议和笔记" /></label><button className="icon-button" title="菜单"><Menu size={18} /></button></div>
        </header>
        {message && <div className="toast">{message}</div>}
        {view === "home" && <Home workspace={workspace} onMeeting={() => void createMeeting()} onNote={() => void createNote()} onOpenMeeting={(meeting) => { setSelectedMeeting(meeting); setView("meetings"); }} onOpenNote={(note) => { setSelectedNote(note); setView("notes"); }} />}
        {view === "meetings" && <Meetings meetings={filteredMeetings} meeting={selectedMeeting} onSelect={setSelectedMeeting} onCreate={() => void createMeeting()} onChange={setSelectedMeeting} onSave={() => void saveMeeting()} onTask={() => void addTask("meeting", selectedMeeting?.id ?? null)} recording={recording} recordingSeconds={recordingSeconds} onRecord={() => void startRecording()} onStop={stopRecording} />}
        {view === "notes" && <Notes notes={filteredNotes} notebooks={workspace.notebooks} note={selectedNote} onSelect={setSelectedNote} onCreate={() => void createNote()} onChange={setSelectedNote} onSave={() => void saveNote()} />}
        {view === "tasks" && <Tasks tasks={workspace.tasks} onAdd={() => void addTask()} onToggle={(task) => void toggleTask(task)} />}
        {view === "settings" && <SettingsView workspace={workspace} onCreateNotebook={async () => { const name = window.prompt("笔记本名称"); if (!name?.trim()) return; await invoke("create_notebook", { name: name.trim(), color: "#4f7cff" }); await reload(); notify("笔记本已创建"); }} onBackup={async () => { const path = await invoke<string>("backup_workspace"); notify(`备份已创建：${path}`); }} />}
      </main>
    </div>
  );
}

function TitleBar() {
  const windowHandle = getCurrentWindow();
  return <div className="title-bar" data-tauri-drag-region><span data-tauri-drag-region>知记 · 本地资料库</span><div className="window-controls" data-tauri-drag-region="false"><button onClick={() => void windowHandle.minimize()} title="最小化"><Minimize2 size={15} /></button><button onClick={() => void windowHandle.toggleMaximize()} title="最大化"><Maximize2 size={14} /></button><button className="close-window" onClick={() => void windowHandle.close()} title="关闭"><X size={16} /></button></div></div>;
}

function NavItem({ icon, active, onClick, children }: { icon: ReactNode; active: boolean; onClick: () => void; children: string }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function Home({ workspace, onMeeting, onNote, onOpenMeeting, onOpenNote }: { workspace: Workspace; onMeeting: () => void; onNote: () => void; onOpenMeeting: (meeting: Meeting) => void; onOpenNote: (note: Note) => void }) {
  const openTasks = workspace.tasks.filter((task) => !task.completed);
  return <div className="page-grid home-grid"><section className="welcome-card"><div><span className="eyebrow">本地优先 · 只属于你</span><h2>把一次会议，变成下一步行动。</h2><p>录下会议、整理纪要、提取决策和待办；所有内容只存放在这台 Windows 电脑。</p></div><div className="welcome-actions"><button className="primary-button" onClick={onMeeting}><Mic size={17} /> 开始一场会议</button><button className="secondary-button" onClick={onNote}><FileText size={17} /> 新建笔记</button></div></section><section className="stats-row"><Stat icon={<UsersRound />} label="本周会议" value={workspace.meetings.length} /><Stat icon={<NotebookPen />} label="全部笔记" value={workspace.notes.length} /><Stat icon={<CheckCircle2 />} label="待完成" value={openTasks.length} /></section><section className="panel recent-panel"><div className="panel-title"><h3>最近会议</h3><button onClick={onMeeting}>新建 <Plus size={14} /></button></div>{workspace.meetings.slice(0, 4).map((meeting) => <button className="recent-row" key={meeting.id} onClick={() => onOpenMeeting(meeting)}><span className="round-icon purple"><UsersRound size={16} /></span><span><strong>{meeting.title}</strong><small>{dateTime(meeting.startedAt)} · {meeting.status}</small></span><ChevronRight size={17} /></button>)}{workspace.meetings.length === 0 && <Empty label="还没有会议，开始记录第一场吧。" />}</section><section className="panel recent-panel"><div className="panel-title"><h3>最近笔记</h3><button onClick={onNote}>新建 <Plus size={14} /></button></div>{workspace.notes.slice(0, 4).map((note) => <button className="recent-row" key={note.id} onClick={() => onOpenNote(note)}><span className="round-icon yellow"><FileText size={16} /></span><span><strong>{note.title}</strong><small>{note.content || "空白笔记"}</small></span><ChevronRight size={17} /></button>)}</section></div>;
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) { return <div className="stat-card"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>; }

function Meetings({ meetings, meeting, onSelect, onCreate, onChange, onSave, onTask, recording, recordingSeconds, onRecord, onStop }: { meetings: Meeting[]; meeting: Meeting | null; onSelect: (meeting: Meeting) => void; onCreate: () => void; onChange: (meeting: Meeting) => void; onSave: () => void; onTask: () => void; recording: boolean; recordingSeconds: number; onRecord: () => void; onStop: () => void }) {
  return <div className="split-layout"><section className="list-pane"><div className="pane-heading"><div><h2>全部会议</h2><small>{meetings.length} 场会议</small></div><button className="round-add" onClick={onCreate}><Plus size={18} /></button></div>{meetings.map((item) => <button className={`meeting-item ${meeting?.id === item.id ? "selected" : ""}`} onClick={() => onSelect(item)} key={item.id}><span className="meeting-date">{new Date(item.startedAt).getDate()}</span><span><strong>{item.title}</strong><small>{dateTime(item.startedAt)} · {item.status}</small></span>{item.audioPath && <Mic size={14} />}</button>)}{meetings.length === 0 && <Empty label="未找到会议。" />}</section><section className="editor-pane">{meeting ? <><div className="editor-top"><div><input className="title-input" value={meeting.title} onChange={(event) => onChange({ ...meeting, title: event.target.value })} /><small>{dateTime(meeting.startedAt)} · {meeting.status}</small></div><div className="editor-buttons"><button className="secondary-button" onClick={onTask}><Plus size={15} /> 待办</button><button className="primary-button" onClick={onSave}><Check size={15} /> 保存</button></div></div><div className="recording-bar">{recording ? <><span className="recording-dot" /> 正在录音 <strong>{duration(recordingSeconds)}</strong><button className="danger-button" onClick={onStop}><Square size={13} fill="currentColor" /> 结束录音</button></> : <><Mic size={17} /><span>{meeting.audioPath ? `录音 ${duration(meeting.durationSeconds)} 已保存` : "在会议开始时录音，音频只保存到本地"}</span><button className="record-button" onClick={onRecord}><Mic size={14} /> 开始录音</button></>}</div><div className="meeting-editor"><EditorField label="会议纪要" hint="目标、讨论要点、结论" value={meeting.minutes} onChange={(minutes) => onChange({ ...meeting, minutes })} placeholder="用几条要点写下本次会议的重点…" /><EditorField label="决策与共识" hint="明确记录已达成的决定" value={meeting.decisions} onChange={(decisions) => onChange({ ...meeting, decisions })} placeholder="例如：下周三前交付第一版原型" /><EditorField label="原始记录 / 转写稿" hint="可粘贴转写文本或手写记录" value={meeting.transcript} onChange={(transcript) => onChange({ ...meeting, transcript })} placeholder="在这里保留完整上下文…" /></div></> : <Empty label="选择一场会议，或创建新的会议。" />}</section></div>;
}

function Notes({ notes, notebooks, note, onSelect, onCreate, onChange, onSave }: { notes: Note[]; notebooks: Notebook[]; note: Note | null; onSelect: (note: Note) => void; onCreate: () => void; onChange: (note: Note) => void; onSave: () => void }) {
  return <div className="split-layout"><section className="list-pane"><div className="pane-heading"><div><h2>全部笔记</h2><small>{notes.length} 条笔记</small></div><button className="round-add" onClick={onCreate}><Plus size={18} /></button></div>{notes.map((item) => <button className={`note-item ${note?.id === item.id ? "selected" : ""}`} onClick={() => onSelect(item)} key={item.id}><FileText size={17} /><span><strong>{item.title}</strong><small>{item.content || "空白笔记"}</small></span></button>)}</section><section className="editor-pane note-editor">{note ? <><div className="editor-top"><div><input className="title-input" value={note.title} onChange={(event) => onChange({ ...note, title: event.target.value })} /><small>上次编辑于 {dateTime(note.updatedAt)}</small></div><button className="primary-button" onClick={onSave}><Check size={15} /> 保存</button></div><div className="note-meta"><FolderOpen size={15} /><select value={note.notebookId ?? ""} onChange={(event) => onChange({ ...note, notebookId: event.target.value || null })}><option value="">未分类</option>{notebooks.map((notebook) => <option value={notebook.id} key={notebook.id}>{notebook.name}</option>)}</select><input value={note.tags} onChange={(event) => onChange({ ...note, tags: event.target.value })} placeholder="标签，用逗号分隔" /></div><textarea className="note-content" value={note.content} onChange={(event) => onChange({ ...note, content: event.target.value })} placeholder="开始写作…" /></> : <Empty label="选择一条笔记，或新建笔记。" />}</section></div>;
}

function EditorField({ label, hint, value, onChange, placeholder }: { label: string; hint: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="editor-field"><div><h3>{label}</h3><small>{hint}</small></div><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>; }

function Tasks({ tasks, onAdd, onToggle }: { tasks: Task[]; onAdd: () => void; onToggle: (task: Task) => void }) { const open = tasks.filter((task) => !task.completed); const done = tasks.filter((task) => task.completed); return <div className="tasks-page"><div className="tasks-intro"><div><h2>专注下一步</h2><p>来自会议和笔记的行动项，会统一出现在这里。</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} /> 新建待办</button></div><TaskGroup title="待完成" tasks={open} onToggle={onToggle} /><TaskGroup title="已完成" tasks={done} onToggle={onToggle} /></div>; }

function TaskGroup({ title, tasks, onToggle }: { title: string; tasks: Task[]; onToggle: (task: Task) => void }) { return <section className="task-group"><div className="group-heading"><h3>{title}</h3><span>{tasks.length}</span></div>{tasks.length ? tasks.map((task) => <label className={`task-row ${task.completed ? "done" : ""}`} key={task.id}><input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} /><span className="checkmark">{task.completed && <Check size={13} />}</span><span>{task.title}</span>{task.sourceType && <small>{task.sourceType === "meeting" ? "会议" : "笔记"}</small>}</label>) : <Empty label={title === "待完成" ? "没有待办，给自己留一点空白。" : "完成的事项会保留在这里。"} />}</section>; }

function SettingsView({ workspace, onCreateNotebook, onBackup }: { workspace: Workspace; onCreateNotebook: () => void; onBackup: () => void }) { return <div className="settings-page"><section className="settings-hero"><span className="round-icon purple"><Archive size={19} /></span><div><h2>你的资料，默认只在本地</h2><p>知记不会要求登录，也不会把会议录音、笔记或纪要上传到云端。</p></div></section><section className="settings-card"><div><h3>笔记本</h3><p>用笔记本把会议和普通笔记归类。</p></div><button className="secondary-button" onClick={onCreateNotebook}><Plus size={16} /> 新建笔记本</button></section><section className="settings-card"><div><h3>本地资料库</h3><p>当前保存 {workspace.meetings.length} 场会议、{workspace.notes.length} 条笔记和 {workspace.tasks.length} 项待办。数据使用 SQLite 存储在 Windows 应用资料目录。</p></div></section><section className="settings-card"><div><h3>立即备份</h3><p>创建一个包含 SQLite 资料库与全部会议录音的本机副本。</p></div><button className="secondary-button" onClick={onBackup}><Archive size={16} /> 创建备份</button></section></div>; }

function Empty({ label }: { label: string }) { return <div className="empty-state"><MoreHorizontal size={22} /><p>{label}</p></div>; }
