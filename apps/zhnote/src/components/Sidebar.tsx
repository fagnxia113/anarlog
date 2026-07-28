import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { FileText, Moon, Plus, Settings, Sun } from "lucide-react";
import { useLingui } from "@lingui/react/macro";

import { api } from "@/lib/tauri";
import { cn, useTheme } from "@/lib/utils";

export function Sidebar() {
  const { i18n } = useLingui();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { location } = useRouterState();
  const { theme, toggleTheme } = useTheme();
  const onNotes = location.pathname.startsWith("/notes");
  const onSettings = location.pathname.startsWith("/settings");

  const createMutation = useMutation({
    mutationFn: () => api.createNote(),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    },
  });

  return (
    <aside className="flex h-full w-60 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="px-4 py-4 text-lg font-semibold">{i18n._("app.name")}</div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        <Link
          to="/notes"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
            onNotes ? "bg-[var(--color-border)]" : "hover:bg-[var(--color-border)]",
          )}
        >
          <FileText size={16} />
          {i18n._("nav.notes")}
        </Link>
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
            onSettings ? "bg-[var(--color-border)]" : "hover:bg-[var(--color-border)]",
          )}
        >
          <Settings size={16} />
          {i18n._("nav.settings")}
        </Link>
      </nav>
      <div className="flex flex-col gap-2 p-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-border)]"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {theme === "dark" ? i18n._("settings.theme.light") : i18n._("settings.theme.dark")}
        </button>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          <Plus size={16} />
          {i18n._("nav.new")}
        </button>
      </div>
    </aside>
  );
}
