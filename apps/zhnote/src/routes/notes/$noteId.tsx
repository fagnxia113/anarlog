import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Mic, RefreshCw, Square, Trash2 } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import { Editor } from "@/components/Editor";
import { api, type SpeakerSegment } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notes/$noteId")({
  component: NoteEditPage,
});

const SPEAKER_COLORS = [
  "text-blue-600",
  "text-green-600",
  "text-purple-600",
  "text-orange-600",
  "text-pink-600",
  "text-teal-600",
];

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function TranscriptView({ transcript, segmentsJson }: { transcript: string; segmentsJson: string }) {
  const { i18n } = useLingui();

  if (!transcript) return null;

  let segments: SpeakerSegment[] = [];
  try {
    segments = JSON.parse(segmentsJson);
  } catch {
    // ignore
  }

  if (segments.length > 0 && segments.some((s) => s.speaker > 0)) {
    return (
      <div className="flex flex-col gap-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <span className={cn("shrink-0 font-medium", SPEAKER_COLORS[seg.speaker % SPEAKER_COLORS.length])}>
              {i18n._("session.speaker")}{seg.speaker}
            </span>
            <span className="text-[var(--color-text-muted)]">{formatMs(seg.start_ms)}</span>
            <span className="text-[var(--color-text)]">{seg.text}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm text-[var(--color-text-muted)]">
      {transcript}
    </div>
  );
}

function NoteEditPage() {
  const { noteId } = Route.useParams();
  const { i18n } = useLingui();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: note, isLoading } = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => api.getNote(noteId),
  });

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleMutation = useMutation({
    mutationFn: (title: string) => api.updateNote(noteId, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });
  const bodyMutation = useMutation({
    mutationFn: (body: string) => api.updateNote(noteId, undefined, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  useEffect(() => {
    return () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
    };
  }, [noteId]);

  const onTitleChange = (value: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => titleMutation.mutate(value), 300);
  };
  const onBodyChange = (html: string) => {
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => bodyMutation.mutate(html), 500);
  };

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const runPipeline = async (audioPath: string) => {
    setIsTranscribing(true);
    try {
      const result = await api.transcribeAudio(audioPath);
      await api.saveTranscript(noteId, result.text);
      await api.saveSegments(noteId, JSON.stringify(result.segments));
      await queryClient.invalidateQueries({ queryKey: ["note", noteId] });
    } finally {
      setIsTranscribing(false);
    }
    setIsGenerating(true);
    try {
      await api.generateSummary(noteId);
      await queryClient.invalidateQueries({ queryKey: ["note", noteId] });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStop = async () => {
    setIsRecording(false);
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const dir = await appDataDir();
    const fileName = `${noteId}-${Date.now()}.webm`;
    const fullPath = await join(dir, fileName);
    await writeFile(fullPath, buf);
    await runPipeline(fullPath);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void handleStop();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e) {
      console.error(e);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const regenSummary = async () => {
    setIsGenerating(true);
    try {
      await api.generateSummary(noteId);
      await queryClient.invalidateQueries({ queryKey: ["note", noteId] });
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes" });
    },
  });
  const onDelete = () => {
    if (window.confirm(i18n._("note.delete.confirm"))) {
      deleteMutation.mutate();
    }
  };

  if (isLoading || !note) {
    return (
      <div className="p-6 text-[var(--color-text-muted)]">{i18n._("common.loading")}</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
        <input
          key={`title-${note.title}`}
          className="flex-1 bg-transparent text-lg font-semibold focus:outline-none"
          defaultValue={note.title}
          placeholder={i18n._("note.title.placeholder")}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-white",
            isRecording ? "bg-red-500" : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]",
          )}
        >
          {isRecording ? <Square size={14} /> : <Mic size={16} />}
          {isRecording ? i18n._("session.stop_recording") : i18n._("session.start_recording")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          <Trash2 size={16} />
          {i18n._("note.delete")}
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <Editor
            key={noteId}
            content={note.body}
            onChange={onBodyChange}
            placeholder={i18n._("note.body.placeholder")}
          />
        </div>
        <aside className="flex w-80 flex-col gap-4 overflow-auto border-l border-[var(--color-border)] p-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{i18n._("session.summary")}</h3>
              <button
                type="button"
                onClick={regenSummary}
                disabled={isGenerating}
                className="flex items-center gap-1 text-xs text-[var(--color-primary)] disabled:opacity-50"
              >
                <RefreshCw size={12} className={isGenerating ? "animate-spin" : ""} />
                {i18n._("common.retry")}
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm text-[var(--color-text)]">
              {isGenerating && !note.summary
                ? i18n._("session.generating_summary")
                : note.summary}
            </div>
          </section>
          <section>
            <button
              type="button"
              onClick={() => setTranscriptOpen((v) => !v)}
              className="mb-2 flex items-center gap-1 text-sm font-semibold"
            >
              {transcriptOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {i18n._("session.transcript")}
            </button>
            {transcriptOpen && (
              isTranscribing
                ? <div className="text-sm text-[var(--color-text-muted)]">{i18n._("session.transcribing")}</div>
                : <TranscriptView transcript={note.transcript} segmentsJson={note.segments} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
