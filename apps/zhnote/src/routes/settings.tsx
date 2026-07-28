import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { useLocale } from "@/i18n/provider";
import { api, type LlmConfig, type SttConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const createDefaultLlm = (): LlmConfig => ({
  base_url: "https://api.openai.com/v1",
  api_key: "",
  model: "gpt-4o-mini",
});
const createDefaultStt = (): SttConfig => ({
  mode: "cloud",
  language: "zh",
  diarization: false,
  cloud_base_url: "https://api.openai.com/v1",
  cloud_api_key: "",
  cloud_model: "whisper-1",
});

const inputClass =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none";

const CLOUD_MODELS = [
  { value: "whisper-1", label: "Whisper-1 (OpenAI)" },
  { value: "whisper-large-v3", label: "Whisper Large V3" },
  { value: "whisper-large-v3-turbo", label: "Whisper Large V3 Turbo" },
  { value: "distil-whisper-large-v3-en", label: "Distil Whisper Large V3 EN" },
];

function SettingsPage() {
  const { i18n } = useLingui();
  const { locale, setLocale } = useLocale();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");

  const llmQuery = useQuery({
    queryKey: ["setting", "llm_config"],
    queryFn: async () => {
      const raw = await api.getSetting("llm_config");
      return raw ? (JSON.parse(raw) as LlmConfig) : null;
    },
  });
  const sttQuery = useQuery({
    queryKey: ["setting", "stt_config"],
    queryFn: async () => {
      const raw = await api.getSetting("stt_config");
      return raw ? (JSON.parse(raw) as SttConfig) : null;
    },
  });

  const form = useForm({
    defaultValues: {
      llm: createDefaultLlm(),
      stt: createDefaultStt(),
    },
    onSubmit: async ({ value }) => {
      await api.setSetting("llm_config", JSON.stringify(value.llm));
      await api.setSetting("stt_config", JSON.stringify(value.stt));
      queryClient.invalidateQueries({ queryKey: ["setting"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  useEffect(() => {
    if (llmQuery.data) {
      form.setFieldValue("llm.base_url", llmQuery.data.base_url);
      form.setFieldValue("llm.api_key", llmQuery.data.api_key);
      form.setFieldValue("llm.model", llmQuery.data.model);
    }
  }, [llmQuery.data]);
  useEffect(() => {
    if (sttQuery.data) {
      form.setFieldValue("stt.mode", sttQuery.data.mode);
      form.setFieldValue("stt.language", sttQuery.data.language);
      form.setFieldValue("stt.diarization", sttQuery.data.diarization);
      form.setFieldValue("stt.cloud_base_url", sttQuery.data.cloud_base_url);
      form.setFieldValue("stt.cloud_api_key", sttQuery.data.cloud_api_key);
      form.setFieldValue("stt.cloud_model", sttQuery.data.cloud_model);
    }
  }, [sttQuery.data]);

  const onTest = async () => {
    setTestStatus("testing");
    try {
      await api.testLlmConnection(form.state.values.llm);
      setTestStatus("success");
    } catch {
      setTestStatus("failed");
    }
  };

  if (llmQuery.isLoading || sttQuery.isLoading) {
    return (
      <div className="p-6 text-[var(--color-text-muted)]">{i18n._("common.loading")}</div>
    );
  }

  const isLocalMode = form.state.values.stt.mode === "local";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold">{i18n._("settings.title")}</h1>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{i18n._("settings.language")}</h2>
          <div className="flex gap-2">
            {(["zh-CN", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  locale === l
                    ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                    : "border-[var(--color-border)]",
                )}
              >
                {l === "zh-CN" ? i18n._("settings.language.zh") : i18n._("settings.language.en")}
              </button>
            ))}
          </div>
        </section>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-6"
        >
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{i18n._("settings.ai")}</h2>
            <form.Field name="llm.base_url">
              {(field) => (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{i18n._("settings.ai.base_url")}</span>
                  <input
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              )}
            </form.Field>
            <form.Field name="llm.api_key">
              {(field) => (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{i18n._("settings.ai.api_key")}</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              )}
            </form.Field>
            <form.Field name="llm.model">
              {(field) => (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{i18n._("settings.ai.model")}</span>
                  <input
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              )}
            </form.Field>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onTest}
                disabled={testStatus === "testing"}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {i18n._("settings.ai.test")}
              </button>
              {testStatus === "success" && (
                <span className="text-sm text-green-600">{i18n._("settings.ai.test_success")}</span>
              )}
              {testStatus === "failed" && (
                <span className="text-sm text-red-600">{i18n._("settings.ai.test_failed")}</span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{i18n._("settings.stt")}</h2>

            <form.Field name="stt.mode">
              {(field) => (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{i18n._("settings.stt.mode")}</span>
                  <select
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <option value="cloud">{i18n._("settings.stt.mode.cloud")}</option>
                    <option value="local">{i18n._("settings.stt.mode.local")}</option>
                  </select>
                </label>
              )}
            </form.Field>

            {isLocalMode && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {i18n._("settings.stt.local_hint")}
              </p>
            )}

            {isLocalMode && (
              <form.Field name="stt.diarization">
                {(field) => (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.state.value}
                      onChange={(e) => field.handleChange(e.target.checked)}
                      className="rounded"
                    />
                    <div className="flex flex-col">
                      <span>{i18n._("settings.stt.diarization")}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {i18n._("settings.stt.diarization.hint")}
                      </span>
                    </div>
                  </label>
                )}
              </form.Field>
            )}

            {!isLocalMode && (
              <>
                <form.Field name="stt.cloud_base_url">
                  {(field) => (
                    <label className="flex flex-col gap-1 text-sm">
                      <span>{i18n._("settings.stt.base_url")}</span>
                      <input
                        className={inputClass}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </label>
                  )}
                </form.Field>
                <form.Field name="stt.cloud_api_key">
                  {(field) => (
                    <label className="flex flex-col gap-1 text-sm">
                      <span>{i18n._("settings.stt.api_key")}</span>
                      <input
                        type="password"
                        className={inputClass}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </label>
                  )}
                </form.Field>
                <form.Field name="stt.cloud_model">
                  {(field) => (
                    <label className="flex flex-col gap-1 text-sm">
                      <span>{i18n._("settings.stt.model")}</span>
                      <select
                        className={inputClass}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      >
                        {CLOUD_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </form.Field>
              </>
            )}

            <form.Field name="stt.language">
              {(field) => (
                <label className="flex flex-col gap-1 text-sm">
                  <span>{i18n._("settings.stt.language")}</span>
                  <select
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <option value="zh">{i18n._("settings.stt.language.zh")}</option>
                    <option value="en">{i18n._("settings.stt.language.en")}</option>
                    <option value="auto">{i18n._("settings.stt.language.auto")}</option>
                  </select>
                </label>
              )}
            </form.Field>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--color-primary-hover)]"
            >
              {i18n._("settings.save")}
            </button>
            {saved && <span className="text-sm text-green-600">{i18n._("settings.saved")}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
