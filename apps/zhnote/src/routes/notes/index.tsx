import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { useLocale } from "@/i18n/provider";
import { api } from "@/lib/tauri";
import { cn, formatRelativeDate } from "@/lib/utils";

export const Route = createFileRoute("/notes/")({
  component: NotesListPage,
});

function NotesListPage() {
  const { i18n } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);

  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes(),
  });

  const { data: searchResults } = useQuery({
    queryKey: ["notes", "search", searchQuery],
    queryFn: () => api.searchNotes(searchQuery),
    enabled: searchQuery.length > 0,
  });

  const { data: trashedNotes } = useQuery({
    queryKey: ["notes", "trash"],
    queryFn: () => api.listTrashedNotes(),
    enabled: showTrash,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createNote(),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restoreNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "trash"] });
    },
  });

  const displayNotes = searchQuery.length > 0
    ? (searchResults ?? [])
    : showTrash
      ? (trashedNotes ?? [])
      : (notes ?? []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            {showTrash ? i18n._("nav.trash") : i18n._("nav.notes")}
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTrash((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                showTrash
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] hover:bg-[var(--color-border)]",
              )}
            >
              <Trash2 size={16} />
              {i18n._("nav.trash")}
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              <Plus size={16} />
              {i18n._("nav.new")}
            </button>
          </div>
        </div>
        {!showTrash && (
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={i18n._("nav.search")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 pl-10 pr-4 text-sm focus:border-[var(--color-primary)] focus:outline-none"
            />
          </div>
        )}
      </header>
      <div className="flex-1 overflow-auto p-6">
        {isLoading
          ? <div className="text-[var(--color-text-muted)]">{i18n._("common.loading")}</div>
          : displayNotes.length === 0
            ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                  <div className="text-lg font-medium">
                    {searchQuery
                      ? i18n._("note.search.empty")
                      : showTrash
                        ? i18n._("note.trash.empty")
                        : i18n._("note.empty.title")}
                  </div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {searchQuery
                      ? i18n._("note.search.empty_hint")
                      : showTrash
                        ? i18n._("note.trash.empty_hint")
                        : i18n._("note.empty.hint")}
                  </div>
                </div>
              )
            : (
                <ul className="flex flex-col gap-2">
                  {displayNotes.map((note) => (
                    <li key={note.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          showTrash
                            ? undefined
                            : navigate({ to: "/notes/$noteId", params: { noteId: note.id } })
                        }
                        disabled={showTrash}
                        className={cn(
                          "flex-1 rounded-lg border border-[var(--color-border)] px-4 py-3 text-left transition-colors",
                          showTrash
                            ? "opacity-60"
                            : "hover:border-[var(--color-primary)]",
                        )}
                      >
                        <div className="truncate font-medium">{note.title || i18n._("note.title.placeholder")}</div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {i18n._("note.list.updated")} {formatRelativeDate(note.updated_at, locale)}
                        </div>
                      </button>
                      {showTrash && (
                        <button
                          type="button"
                          onClick={() => restoreMutation.mutate(note.id)}
                          className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-border)]"
                          title={i18n._("note.restore")}
                        >
                          <RotateCcw size={16} />
                          {i18n._("note.restore")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
      </div>
    </div>
  );
}
