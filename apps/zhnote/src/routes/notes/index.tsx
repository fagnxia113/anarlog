import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";

import { useLocale } from "@/i18n/provider";
import { api } from "@/lib/tauri";
import { formatRelativeDate } from "@/lib/utils";

export const Route = createFileRoute("/notes/")({
  component: NotesListPage,
});

function NotesListPage() {
  const { i18n } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes(),
  });

  const createMutation = useMutation({
    mutationFn: () => api.createNote(),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <h1 className="text-xl font-semibold">{i18n._("nav.notes")}</h1>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          <Plus size={16} />
          {i18n._("nav.new")}
        </button>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="text-[var(--color-text-muted)]">{i18n._("common.loading")}</div>
        ) : !notes || notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="text-lg font-medium">{i18n._("note.empty.title")}</div>
            <div className="text-sm text-[var(--color-text-muted)]">{i18n._("note.empty.hint")}</div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/notes/$noteId", params: { noteId: note.id } })}
                  className="w-full rounded-lg border border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:border-[var(--color-primary)]"
                >
                  <div className="truncate font-medium">{note.title || i18n._("note.title.placeholder")}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {i18n._("note.list.updated")} {formatRelativeDate(note.updated_at, locale)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
