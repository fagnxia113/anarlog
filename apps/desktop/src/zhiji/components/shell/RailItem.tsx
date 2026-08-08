import { type ReactNode } from "react";

type RailItemProps = {
  active: boolean;
  icon: ReactNode;
  title: string;
  onClick: () => void;
};

export function RailItem({ active, icon, title, onClick }: RailItemProps) {
  return (
    <button
      className={`rail-item ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
