import { Download, X } from "lucide-react";
import { Dialog } from "../ui/Dialog";

type UpdateModalProps = {
  version: string;
  state: "available" | "downloading" | "error";
  progress: number;
  onInstall: () => void;
  onDismiss: () => void;
};

export function UpdateModal({ version, state, progress, onInstall, onDismiss }: UpdateModalProps) {
  return (
    <Dialog onClose={onDismiss} className="update-modal">
      <div className="modal-head">
        <span className="round-icon accent">
          <Download size={19} />
        </span>
        <button className="icon-button" onClick={onDismiss} title="关闭">
          <X size={16} />
        </button>
      </div>
      <h2>发现新版本 {version}</h2>
      <p>已从 GitHub 下载安装包并完成签名校验，安装后重启即可完成升级。</p>
      {state === "downloading" ? (
        <div className="update-progress">
          <div className="progress-bar">
            <div style={{ width: `${progress}%` }} />
          </div>
          <small>正在下载并安装… {progress}%</small>
        </div>
      ) : (
        <div className="modal-actions">
          <button className="secondary-button" onClick={onDismiss}>
            稍后
          </button>
          <button
            className="primary-button"
            onClick={onInstall}
            disabled={state === "error"}
          >
            <Download size={16} />
            下载并安装
          </button>
        </div>
      )}
      {state === "error" && (
        <small className="runtime-warning">
          更新失败，请稍后重试，或去 GitHub 下载安装包。
        </small>
      )}
    </Dialog>
  );
}
