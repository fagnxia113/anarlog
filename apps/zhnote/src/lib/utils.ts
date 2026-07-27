import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(date: Date | string, locale = "zh-CN"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return locale === "zh-CN" ? "今天" : "Today";
  if (target.getTime() === yesterday.getTime()) return locale === "zh-CN" ? "昨天" : "Yesterday";

  const diff = today.getTime() - target.getTime();
  if (diff < 7 * 86400000) return locale === "zh-CN" ? "本周" : "This week";

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
  }).format(d);
}

export function formatTime(date: Date | string, locale = "zh-CN"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
