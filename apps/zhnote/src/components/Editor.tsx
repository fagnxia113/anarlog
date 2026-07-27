import { EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface EditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function Editor({ content, onChange, placeholder }: EditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isComposing = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editorProps: {
      attributes: {
        class: "px-4 py-3 min-h-[200px] leading-7 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      setIsEmpty(editor.isEmpty);
      if (isComposing.current) return;
      onChangeRef.current(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor) setIsEmpty(editor.isEmpty);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleStart = () => {
      isComposing.current = true;
    };
    const handleEnd = () => {
      isComposing.current = false;
      window.setTimeout(() => {
        onChangeRef.current(editor.getHTML());
        setIsEmpty(editor.isEmpty);
      }, 0);
    };
    dom.addEventListener("compositionstart", handleStart);
    dom.addEventListener("compositionend", handleEnd);
    return () => {
      dom.removeEventListener("compositionstart", handleStart);
      dom.removeEventListener("compositionend", handleEnd);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <Toolbar editor={editor} />
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-4 top-3 text-[var(--color-text-muted)]">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const items: Array<{ icon: typeof Bold; action: () => void; active: boolean }> = [
    { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
    { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
    { icon: List, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList") },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5">
      {items.map(({ icon: Icon, action, active }, i) => (
        <button
          key={i}
          type="button"
          onClick={action}
          className={cn(
            "rounded p-1.5 hover:bg-[var(--color-border)]",
            active && "bg-[var(--color-border)]",
          )}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
