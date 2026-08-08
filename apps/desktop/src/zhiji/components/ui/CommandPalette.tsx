import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
};

// ⌘K 命令面板骨架：键盘优先的全局命令入口，契合「顺手」的个人工具定位。
// 当前为可复用组件，尚未在 App 内接全局快捷键；后续接 useHotkeys 即可启用。
export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "输入命令…",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? commands.filter((command) => command.label.toLowerCase().includes(normalized))
    : commands;

  return (
    <div className="modal-overlay command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette-input">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
          />
        </div>
        <ul className="command-palette-list">
          {filtered.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => {
                  command.run();
                  onClose();
                }}
              >
                {command.icon}
                <span>{command.label}</span>
                {command.hint && <small>{command.hint}</small>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="command-palette-empty">无匹配命令</li>}
        </ul>
      </div>
    </div>
  );
}
