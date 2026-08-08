// 状态色点：根据状态文案映射到语义色（品牌/成功/信息/中性）。
// 用于会议列表与详情的状态提示，hover 出说明（title）。
export function StatusDot({ status }: { status: string }) {
  let cls = "neutral";
  if (status.includes("区分") || status.includes("发言人")) cls = "brand";
  else if (status.includes("纪要") || status.includes("分析")) cls = "success";
  else if (status.includes("转写") || status.includes("录音") || status.includes("导入")) cls = "info";
  return <span className={`status-dot ${cls}`} title={status} />;
}
