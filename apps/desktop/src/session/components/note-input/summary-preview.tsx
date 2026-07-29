import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { Streamdown } from "streamdown";

import { json2md, parseJsonContent } from "@hypr/editor/markdown";
import { Spinner } from "@hypr/ui/components/ui/spinner";
import { cn } from "@hypr/utils";

import { streamdownComponents } from "../streamdown";

import { useAITaskTask } from "~/ai/hooks";
import { useEnhancedNote, useEnhancedNoteRecords } from "~/session/queries";
import { createTaskId } from "~/store/zustand/ai-task/task-configs";

function contentToMarkdown(content: string | undefined): string {
  const trimmed = content?.trim() ?? "";
  if (!trimmed) return "";
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    return json2md(parseJsonContent(trimmed)).trim();
  } catch {
    return trimmed;
  }
}

export function SummaryPreview({
  sessionId,
  onOpenSummary,
}: {
  sessionId: string;
  onOpenSummary?: () => void;
}) {
  const { t } = useLingui();
  const records = useEnhancedNoteRecords(sessionId);
  const primaryId = records[0]?.id ?? "";
  const enhancedNote = useEnhancedNote(primaryId);
  const taskId = createTaskId(primaryId, "enhance");
  const { status, streamedText } = useAITaskTask(taskId, "enhance");
  const [collapsed, setCollapsed] = useState(false);

  if (!primaryId) return null;

  const storedMd = contentToMarkdown(enhancedNote?.content);
  const isGenerating = status === "generating";
  const visibleMd = streamedText.trim() || storedMd;

  if (!visibleMd && !isGenerating) return null;

  return (
    <section data-summary-preview className="mt-8 border-border/70 border-t pt-3">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={cn([
          "group flex w-full items-center gap-1.5",
          "text-muted-foreground hover:text-foreground transition-colors",
        ])}
      >
        {collapsed
          ? <ChevronRightIcon className="size-3.5 shrink-0" />
          : <ChevronDownIcon className="size-3.5 shrink-0" />}
        <SparklesIcon className="size-3.5 shrink-0" />
        <span className="text-xs font-medium tracking-wide uppercase">
          {t`Summary`}
        </span>
        {isGenerating
          ? <Spinner size={12} className="ml-0.5 shrink-0" />
          : null}
      </button>

      {!collapsed
        ? (
          <div className="mt-2">
            {visibleMd
              ? (
                <Streamdown
                  components={streamdownComponents}
                  className={cn(["flex flex-col"])}
                  isAnimating={isGenerating}
                >
                  {visibleMd}
                </Streamdown>
              )
              : isGenerating
                ? (
                  <p className="text-muted-foreground py-1 text-sm">
                    <Trans>Generating summary...</Trans>
                  </p>
                )
                : null}

            {onOpenSummary
              ? (
                <button
                  type="button"
                  onClick={onOpenSummary}
                  className={cn([
                    "text-muted-foreground hover:text-foreground mt-3 text-xs",
                    "transition-colors",
                  ])}
                >
                  <Trans>Edit in Summary tab</Trans>
                </button>
              )
              : null}
          </div>
        )
        : null}
    </section>
  );
}
