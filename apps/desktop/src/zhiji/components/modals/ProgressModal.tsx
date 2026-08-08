import { LoaderCircle } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import type { Processing } from "../../types";

const PROCESSING_LABELS: Record<Exclude<Processing, null>, string> = {
  downloading: "正在下载本地语音模型…",
  transcribing: "正在本地语音转写…",
  analyzing: "AI 正在生成智能纪要…",
  renaming: "AI 正在重命名会议…",
  installingSpeaker: "正在安装说话人分离引擎…",
  speakerTranscribing: "正在转写并区分说话人…",
  importing: "正在导入录音…",
  deleting: "正在删除会议…",
  autoTranscribing: "录音已保存，正在本地转写…",
};

type ProgressModalProps = {
  stage: Exclude<Processing, null>;
  onCancel: () => void;
};

export function ProgressModal({ stage, onCancel }: ProgressModalProps) {
  // 仅本地语音转写（含录音后自动转写）可中途取消：后端会杀掉转写子进程
  const cancelable = stage === "transcribing" || stage === "autoTranscribing";
  return (
    <Dialog closeOnEsc={false} closeOnBackdrop={false} className="progress-modal" ariaLabel="处理中">
      <div className="progress-modal-body">
        <LoaderCircle size={26} className="spin" />
        <div>
          <h3>{PROCESSING_LABELS[stage]}</h3>
          <p>处理期间请勿关闭窗口。</p>
        </div>
      </div>
      {cancelable && (
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>
            取消
          </button>
        </div>
      )}
    </Dialog>
  );
}
