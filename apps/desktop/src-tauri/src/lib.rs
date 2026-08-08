use std::{error::Error, fs, io::{self, Read, Write}, path::{Path, PathBuf}, process::{Child, Command}, sync::{Arc, Mutex}, sync::atomic::{AtomicBool, Ordering}};

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const SENSEVOICE_MODEL_NAME: &str = "sensevoice-small-q8.gguf";
const FSMN_VAD_MODEL_NAME: &str = "fsmn-vad.gguf";
const SENSEVOICE_MODEL_URLS: &[&str] = &[
    "https://modelscope.cn/models/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/master/sensevoice-small-q8.gguf",
    "https://hf-mirror.com/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf",
];
const FSMN_VAD_MODEL_URLS: &[&str] = &[
    "https://modelscope.cn/models/FunAudioLLM/fsmn-vad-GGUF/resolve/master/fsmn-vad.gguf",
    "https://hf-mirror.com/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf",
];
const SENSEVOICE_EXECUTABLE: &str = "llama-funasr-sensevoice.exe";
const FFMPEG_EXECUTABLE: &str = "ffmpeg.exe";
const MODEL_DOWNLOAD_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Zhiji/1.0";
const ALIYUN_PYPI_INDEX: &str = "https://mirrors.aliyun.com/pypi/simple/";
const OFFICIAL_PYPI_INDEX: &str = "https://pypi.org/simple";
const PYTORCH_CPU_INDEX: &str = "https://download.pytorch.org/whl/cpu";
const TORCH_CPU_VERSION: &str = "torch==2.11.0+cpu";
const TORCHAUDIO_CPU_VERSION: &str = "torchaudio==2.11.0+cpu";
const SPEAKER_ENGINE_VERSION: &str = "2";
const VC_RUNTIME_DLLS: &[&str] = &[
    "concrt140.dll", "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll", "msvcp140_codecvt_ids.dll", "vcomp140.dll",
    "vcruntime140.dll", "vcruntime140_1.dll",
];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PYTHON_EMBED_URL: &str = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";
const GET_PIP_URL: &str = "https://bootstrap.pypa.io/get-pip.py";

struct AppState {
    connection: Mutex<Connection>,
    models_dir: PathBuf,
    recordings_dir: PathBuf,
    runtime_dir: PathBuf,
    ffmpeg_dir: PathBuf,
    vcrt_dir: PathBuf,
    speaker_engine_dir: PathBuf,
    speaker_models_dir: PathBuf,
    cancel_flag: Arc<AtomicBool>,
    cancel_child: Arc<Mutex<Option<Child>>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Meeting {
    id: String,
    notebook_id: Option<String>,
    title: String,
    started_at: String,
    duration_seconds: i64,
    status: String,
    transcript: String,
    minutes: String,
    decisions: String,
    speaker_segments: String,
    audio_path: Option<String>,
    updated_at: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    notes: String,
}

fn default_task_origin() -> String { "manual".to_string() }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    source_type: Option<String>,
    source_id: Option<String>,
    completed: bool,
    due_date: Option<String>,
    created_at: String,
    #[serde(default = "default_task_origin")]
    origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace { meetings: Vec<Meeting>, tasks: Vec<Task> }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiSettings { base_url: String, analysis_model: String, is_configured: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsInput { base_url: String, analysis_model: String, api_key: Option<String> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsrEngineSettings {
    provider: String,
    cloud_base_url: String,
    cloud_model: String,
    cloud_key_saved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsrEngineSettingsInput {
    provider: String,
    cloud_base_url: String,
    cloud_model: String,
    api_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisResponse {
    #[serde(default, deserialize_with = "string_or_seq_to_string")]
    theme: String,
    #[serde(default, deserialize_with = "string_or_seq_to_string")]
    minutes: String,
    #[serde(default, deserialize_with = "string_or_seq_to_string")]
    decisions: String,
    #[serde(default)]
    action_items: Vec<AnalysisActionItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisActionItem {
    #[serde(default, deserialize_with = "string_or_seq_to_string")]
    title: String,
    #[serde(default)]
    due_date: Option<String>,
}

fn string_or_seq_to_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(String::new()),
        Some(serde_json::Value::String(s)) => Ok(s),
        Some(serde_json::Value::Array(arr)) => {
            let items: Vec<String> = arr
                .into_iter()
                .filter_map(|v| match v {
                    serde_json::Value::String(s) => Some(s),
                    _ => v.as_str().map(|s| s.to_string()),
                })
                .collect();
            Ok(items.join("\n"))
        }
        Some(other) => Ok(other.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisResult { meeting: Meeting, tasks: Vec<Task> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAsrStatus { installed: bool, runtime_available: bool, model_size_mb: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerEngineStatus { installed: bool, models_ready: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerTranscript { transcript: String, segments: Vec<SpeakerSegment> }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerSegment { speaker: String, start_ms: i64, end_ms: i64, text: String }

fn now() -> String { Local::now().to_rfc3339() }
fn id() -> String { Uuid::new_v4().to_string() }
fn app_error(error: impl std::fmt::Display) -> String { error.to_string() }

/// 从 RFC3339 时间串取会议日期前缀 YYYYMMDD；解析失败退回当天
fn meeting_date_prefix(started_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .map(|value| value.format("%Y%m%d").to_string())
        .unwrap_or_else(|_| Local::now().format("%Y%m%d").to_string())
}

/// 清洗 AI 返回的会议主题：去空白/换行/书名号/引号，去掉首尾标点，限长 24 字
fn sanitize_theme(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|ch| !matches!(ch, '\n' | '\r' | '\t' | '《' | '》' | '"' | '\u{201C}' | '\u{201D}' | '\'' | '\u{2018}' | '\u{2019}'))
        .collect();
    let trimmed = cleaned.trim().trim_matches(|ch: char| ch == '。' || ch == '，' || ch == '、' || ch == ' ');
    trimmed.chars().take(24).collect()
}

/// 生成规范会议名：YYYYMMDD-主题（日期取开会当天，主题为空时返回 None 不改名）
fn auto_meeting_title(started_at: &str, theme: &str) -> Option<String> {
    let theme = sanitize_theme(theme);
    if theme.is_empty() { return None; }
    Some(format!("{}-{}", meeting_date_prefix(started_at), theme))
}

fn resource_folder(resource_dir: &Path, name: &str, executable: &str) -> PathBuf {
    [resource_dir.join(name), resource_dir.join("resources").join(name)]
        .into_iter()
        .find(|path| path.join(executable).is_file())
        .unwrap_or_else(|| resource_dir.join(name))
}

fn open_state(app: &AppHandle) -> Result<AppState, Box<dyn Error>> {
    let data_dir = app.path().app_data_dir()?;
    let recordings_dir = data_dir.join("recordings");
    let models_dir = data_dir.join("models");
    let speaker_engine_dir = data_dir.join("speaker-engine");
    let speaker_models_dir = models_dir.join("funasr-meeting");
    fs::create_dir_all(&recordings_dir)?;
    fs::create_dir_all(&models_dir)?;
    fs::create_dir_all(&speaker_engine_dir)?;
    let resource_dir = app.path().resource_dir()?;
    let runtime_dir = resource_folder(&resource_dir, "funasr-runtime", SENSEVOICE_EXECUTABLE);
    let ffmpeg_dir = resource_folder(&resource_dir, "ffmpeg", FFMPEG_EXECUTABLE);
    let vcrt_dir = resource_folder(&resource_dir, "vcrt", "vcruntime140.dll");
    let database_path = data_dir.join("zhiji.sqlite3");
    let connection = Connection::open(&database_path)?;
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, notebook_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL,
          tags TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY, notebook_id TEXT, title TEXT NOT NULL, started_at TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL, status TEXT NOT NULL, transcript TEXT NOT NULL,
          minutes TEXT NOT NULL, decisions TEXT NOT NULL, speaker_segments TEXT NOT NULL DEFAULT '[]',
          audio_path TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT, source_id TEXT,
          completed INTEGER NOT NULL, due_date TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON meetings(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
        ",
    )?;
    ensure_column(&connection, "meetings", "speaker_segments", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_column(&connection, "meetings", "context", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(&connection, "meetings", "notes", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(&connection, "tasks", "origin", "TEXT NOT NULL DEFAULT 'manual'")?;
    clean_stored_transcripts(&connection)?;
    Ok(AppState { connection: Mutex::new(connection), models_dir, recordings_dir, runtime_dir, ffmpeg_dir, vcrt_dir, speaker_engine_dir, speaker_models_dir, cancel_flag: Arc::new(AtomicBool::new(false)), cancel_child: Arc::new(Mutex::new(None)) })
}

fn ensure_column(connection: &Connection, table: &str, column: &str, definition: &str) -> Result<(), Box<dyn Error>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = statement.query_map([], |row| row.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?.iter().any(|name| name == column);
    if !exists { connection.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])?; }
    Ok(())
}

fn setting(connection: &Connection, key: &str, default: &str) -> Result<String, String> {
    connection.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .or_else(|error| match error { rusqlite::Error::QueryReturnedNoRows => Ok(default.to_string()), other => Err(other) })
        .map_err(app_error)
}

fn ai_key() -> Result<keyring::Entry, String> { keyring::Entry::new("com.zhiji.meetnote", "ai-api-key").map_err(app_error) }
fn cloud_asr_key() -> Result<keyring::Entry, String> { keyring::Entry::new("com.zhiji.meetnote", "cloud-asr-api-key").map_err(app_error) }

fn has_ai_key() -> bool {
    match ai_key().and_then(|entry| entry.get_password().map_err(app_error)) { Ok(value) => !value.trim().is_empty(), Err(_) => false }
}

fn has_cloud_asr_key() -> bool {
    match cloud_asr_key().and_then(|entry| entry.get_password().map_err(app_error)) { Ok(value) => !value.trim().is_empty(), Err(_) => false }
}

fn ai_settings(connection: &Connection) -> Result<AiSettings, String> {
    Ok(AiSettings { base_url: setting(connection, "ai_base_url", "https://api.openai.com/v1")?, analysis_model: setting(connection, "ai_analysis_model", "gpt-4o-mini")?, is_configured: has_ai_key() })
}

fn asr_engine_settings(connection: &Connection) -> Result<AsrEngineSettings, String> {
    Ok(AsrEngineSettings {
        provider: setting(connection, "asr_provider", "local")?,
        cloud_base_url: setting(connection, "cloud_asr_base_url", "https://api.siliconflow.cn/v1")?,
        cloud_model: setting(connection, "cloud_asr_model", "FunAudioLLM/SenseVoiceSmall")?,
        cloud_key_saved: has_cloud_asr_key(),
    })
}

fn run_cloud_asr(base_url: String, model: String, api_key: String, audio_path: String, prompt_hint: String) -> Result<String, String> {
    if !base_url.starts_with("https://") && !base_url.starts_with("http://") { return Err("云端转写服务地址必须以 http:// 或 https:// 开头".to_string()); }
    let endpoint = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));
    let file_name = PathBuf::from(&audio_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "recording.webm".to_string());
    let file_bytes = fs::read(&audio_path).map_err(|error| format!("读取录音失败：{error}"))?;
    let part = reqwest::blocking::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("application/octet-stream")
        .map_err(app_error)?;
    let mut form = reqwest::blocking::multipart::Form::new()
        .text("model", model)
        .text("response_format", "json");
    // 会前背景作为 prompt 传给兼容 whisper 的服务（如 Groq/OpenAI），帮助识别专有名词；不支持的服务会忽略该字段
    if !prompt_hint.trim().is_empty() {
        let hint: String = prompt_hint.trim().chars().take(800).collect();
        form = form.text("prompt", hint);
    }
    let form = form.part("file", part);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(app_error)?;
    let response = client.post(endpoint).bearer_auth(api_key).multipart(form).send().map_err(app_error)?;
    let response = response_error(response, "云端转写服务")?;
    let body: serde_json::Value = response.json().map_err(app_error)?;
    let transcript = body.get("text").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
    if transcript.is_empty() { return Err("云端转写服务没有返回可用的转写文本".to_string()); }
    Ok(transcript)
}

fn local_asr_status(state: &AppState) -> LocalAsrStatus {
    let model_path = state.models_dir.join(SENSEVOICE_MODEL_NAME);
    let vad_path = state.models_dir.join(FSMN_VAD_MODEL_NAME);
    LocalAsrStatus {
        installed: model_path.is_file() && vad_path.is_file(),
        runtime_available: state.runtime_dir.join(SENSEVOICE_EXECUTABLE).is_file() && state.ffmpeg_dir.join(FFMPEG_EXECUTABLE).is_file(),
        model_size_mb: fs::metadata(model_path).map_or(0, |metadata| metadata.len() / 1024 / 1024),
    }
}

fn configured_ai(state: &AppState) -> Result<(AiSettings, String), String> {
    let settings = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; ai_settings(&connection)? };
    if !settings.base_url.starts_with("https://") && !settings.base_url.starts_with("http://") { return Err("AI 服务地址必须以 http:// 或 https:// 开头".to_string()); }
    let key = ai_key()?.get_password().map_err(|_| "请先在设置中保存 AI API 密钥".to_string())?;
    if key.trim().is_empty() { return Err("请先在设置中保存 AI API 密钥".to_string()); }
    Ok((settings, key))
}

const MEETING_COLUMNS: &str = "id, notebook_id, title, started_at, duration_seconds, status, transcript, minutes, decisions, speaker_segments, audio_path, updated_at, context, notes";

fn meeting_from_row(row: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    Ok(Meeting { id: row.get(0)?, notebook_id: row.get(1)?, title: row.get(2)?, started_at: row.get(3)?, duration_seconds: row.get(4)?, status: row.get(5)?, transcript: row.get(6)?, minutes: row.get(7)?, decisions: row.get(8)?, speaker_segments: row.get(9)?, audio_path: row.get(10)?, updated_at: row.get(11)?, context: row.get(12)?, notes: row.get(13)? })
}

fn meeting_by_id(connection: &Connection, meeting_id: &str) -> Result<Meeting, String> {
    connection.query_row(
        &format!("SELECT {MEETING_COLUMNS} FROM meetings WHERE id = ?1"),
        params![meeting_id],
        meeting_from_row,
    ).map_err(|error| match error { rusqlite::Error::QueryReturnedNoRows => "找不到该会议".to_string(), other => app_error(other) })
}

fn response_error(response: reqwest::blocking::Response, source: &str) -> Result<reqwest::blocking::Response, String> {
    if response.status().is_success() { return Ok(response); }
    let status = response.status();
    let message = response.text().unwrap_or_else(|_| "无法读取服务错误".to_string());
    Err(format!("{source} 返回 {status}：{message}"))
}

fn clean_json(content: &str) -> String {
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    if trimmed.starts_with('{') {
        return trimmed.to_string();
    }

    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end > start {
                return trimmed[start..=end].to_string();
            }
        }
    }

    trimmed.to_string()
}

fn download_file(url: &str, destination: &Path) -> Result<(), String> {
    let temporary = destination.with_file_name(format!(
        "{}.part",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("model")
    ));
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2u64.saturating_pow(attempt)));
        }
        let result = (|| {
            let client = reqwest::blocking::Client::builder()
                .user_agent(MODEL_DOWNLOAD_USER_AGENT)
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(600))
                .build()
                .map_err(app_error)?;
            let response = client
                .get(url)
                .header(
                    reqwest::header::ACCEPT,
                    "application/octet-stream,application/*;q=0.9,*/*;q=0.8",
                )
                .send()
                .map_err(app_error)?;
            let mut body = response_error(response, "模型下载服务")?;
            let mut output = fs::File::create(&temporary).map_err(app_error)?;
            io::copy(&mut body, &mut output).map_err(app_error)?;
            output.sync_all().map_err(app_error)?;
            fs::rename(&temporary, destination).map_err(app_error)
        })();
        match result {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
                let _ = fs::remove_file(&temporary);
            }
        }
    }
    Err(format!("下载失败（已重试 3 次）：{last_error}"))
}

fn download_model(sources: &[&str], destination: &Path) -> Result<(), String> {
    let mut errors = Vec::new();
    for source in sources {
        match download_file(source, destination) {
            Ok(()) => {
                let size = fs::metadata(destination).map_err(app_error)?.len();
                if size > 1_000_000 { return Ok(()); }
                let _ = fs::remove_file(destination);
                errors.push(format!("{source} 返回的文件过小"));
            }
            Err(error) => errors.push(format!("{source}：{error}")),
        }
    }
    Err(format!("无法下载本地语音模型。已依次尝试 ModelScope 和 Hugging Face：{}", errors.join("；")))
}

fn strip_sensevoice_tokens(raw: &str) -> String {
    let mut cleaned = raw.to_string();
    while let Some(start) = cleaned.find("<|") {
        let Some(end) = cleaned[start..].find("|>") else { break; };
        cleaned.replace_range(start..start + end + 2, "");
    }
    cleaned
}

fn clean_speaker_segments(raw: &str) -> String {
    let Ok(mut segments) = serde_json::from_str::<Vec<SpeakerSegment>>(raw) else { return raw.to_string(); };
    for segment in &mut segments { segment.text = strip_sensevoice_tokens(&segment.text).trim().to_string(); }
    segments.retain(|segment| !segment.text.is_empty());
    serde_json::to_string(&segments).unwrap_or_else(|_| raw.to_string())
}

fn clean_stored_transcripts(connection: &Connection) -> Result<(), Box<dyn Error>> {
    let rows = {
        let mut statement = connection.prepare("SELECT id, transcript, speaker_segments FROM meetings")?;
        statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (meeting_id, transcript, segments) in rows {
        let cleaned_transcript = strip_sensevoice_tokens(&transcript);
        let cleaned_segments = clean_speaker_segments(&segments);
        if cleaned_transcript != transcript || cleaned_segments != segments {
            connection.execute(
                "UPDATE meetings SET transcript = ?2, speaker_segments = ?3 WHERE id = ?1",
                params![meeting_id, cleaned_transcript, cleaned_segments],
            )?;
        }
    }
    Ok(())
}

fn clean_local_transcript(raw: &str) -> String {
    raw.lines().filter_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("INFO") || trimmed.starts_with("load_") || trimmed.starts_with("usage:") { return None; }
        let mut cleaned = strip_sensevoice_tokens(trimmed);
        if cleaned.starts_with('[') {
            if let Some(end) = cleaned.find(']') { cleaned = cleaned[end + 1..].trim().to_string(); }
        }
        (!cleaned.is_empty()).then_some(cleaned)
    }).collect::<Vec<_>>().join("\n")
}

fn to_wav(runtime_dir: &Path, ffmpeg_dir: &Path, audio_path: &str) -> Result<(PathBuf, bool), String> {
    let input = PathBuf::from(audio_path);
    if input.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("wav")) { return Ok((input, false)); }
    let ffmpeg = ffmpeg_dir.join(FFMPEG_EXECUTABLE);
    if !ffmpeg.is_file() { return Err("安装包中未找到音频转换组件，请重新安装知记".to_string()); }
    let output = runtime_dir.join(format!("zhiji-{}.wav", Uuid::new_v4()));
    let output_arg = output.to_string_lossy().into_owned();
    let result = Command::new(ffmpeg)
        .args([
            "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", &output_arg,
        ])
        .output()
        .map_err(app_error)?;
    if !result.status.success() { return Err(format!("无法读取录音：{}", String::from_utf8_lossy(&result.stderr).trim())); }
    Ok((output, true))
}

fn probe_audio_duration(ffmpeg_dir: &Path, audio_path: &Path) -> i64 {
    let ffmpeg = ffmpeg_dir.join(FFMPEG_EXECUTABLE);
    if !ffmpeg.is_file() { return 0; }
    let mut command = Command::new(ffmpeg);
    command.arg("-hide_banner").arg("-i").arg(audio_path);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let Ok(output) = command.output() else { return 0; };
    let details = String::from_utf8_lossy(&output.stderr);
    let Some(duration) = details.split("Duration: ").nth(1).and_then(|value| value.split(',').next()) else { return 0; };
    let parts = duration.trim().split(':').collect::<Vec<_>>();
    if parts.len() != 3 { return 0; }
    let Ok(hours) = parts[0].parse::<f64>() else { return 0; };
    let Ok(minutes) = parts[1].parse::<f64>() else { return 0; };
    let Ok(seconds) = parts[2].parse::<f64>() else { return 0; };
    (hours * 3600.0 + minutes * 60.0 + seconds).round() as i64
}

fn remove_managed_recording(recordings_dir: &Path, audio_path: &str) {
    let path = PathBuf::from(audio_path);
    let Ok(root) = fs::canonicalize(recordings_dir) else { return; };
    let Ok(canonical_path) = fs::canonicalize(&path) else { return; };
    if canonical_path.starts_with(root) { let _ = fs::remove_file(canonical_path); }
}

fn run_local_asr(
    runtime_dir: PathBuf,
    ffmpeg_dir: PathBuf,
    models_dir: PathBuf,
    vcrt_dir: PathBuf,
    audio_path: String,
    cancel_flag: Arc<AtomicBool>,
    cancel_child: Arc<Mutex<Option<Child>>>,
) -> Result<String, String> {
    if cancel_flag.load(Ordering::SeqCst) { return Err("已取消转写".to_string()); }
    let executable = runtime_dir.join(SENSEVOICE_EXECUTABLE);
    if !executable.is_file() { return Err("本地语音引擎未随安装包找到，请重新安装知记".to_string()); }
    let model = models_dir.join(SENSEVOICE_MODEL_NAME);
    let vad = models_dir.join(FSMN_VAD_MODEL_NAME);
    if !model.is_file() || !vad.is_file() { return Err("请先在设置中下载本地语音模型".to_string()); }
    let (wav_path, remove_wav) = to_wav(&runtime_dir, &ffmpeg_dir, &audio_path)?;
    let model_arg = model.to_string_lossy().into_owned();
    let vad_arg = vad.to_string_lossy().into_owned();
    let audio_arg = wav_path.to_string_lossy().into_owned();
    let mut command = Command::new(&executable);
    command.current_dir(&runtime_dir).arg("-m").arg(model_arg).arg("--vad").arg(vad_arg).arg("-a").arg(audio_arg);
    let mut paths = vec![vcrt_dir, runtime_dir.clone()];
    if let Some(current_path) = std::env::var_os("PATH") { paths.extend(std::env::split_paths(&current_path)); }
    command.env("PATH", std::env::join_paths(paths).map_err(app_error)?);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    // 用 spawn + 保留子进程句柄，支持转写中取消（kill 子进程）
    let mut child = command.spawn().map_err(app_error)?;
    if let Ok(mut slot) = cancel_child.lock() { *slot = Some(child); }
    let output = {
        let taken = cancel_child.lock().map_err(|_| "进程锁异常".to_string())?.take();
        match taken {
            Some(c) => c.wait_with_output().map_err(app_error)?,
            None => return Err("已取消转写".to_string()),
        }
    };
    if let Ok(mut slot) = cancel_child.lock() { *slot = None; }
    if remove_wav { let _ = fs::remove_file(&wav_path); }
    if cancel_flag.load(Ordering::SeqCst) { return Err("已取消转写".to_string()); }
    if !output.status.success() { return Err(format!("本地语音引擎运行失败：{}", String::from_utf8_lossy(&output.stderr).trim())); }
    let transcript = clean_local_transcript(&String::from_utf8_lossy(&output.stdout));
    if transcript.is_empty() { return Err("本地语音引擎没有返回可用的转写文本".to_string()); }
    Ok(transcript)
}

fn speaker_python(engine_dir: &Path) -> PathBuf { engine_dir.join("python").join("python.exe") }
fn speaker_script(engine_dir: &Path) -> PathBuf { engine_dir.join("diarize.py") }
fn speaker_marker(engine_dir: &Path) -> PathBuf { engine_dir.join(".installed") }
fn speaker_models_marker(models_dir: &Path) -> PathBuf { models_dir.join(".ready") }

fn speaker_engine_installed(engine_dir: &Path) -> bool {
    speaker_python(engine_dir).is_file()
        && speaker_script(engine_dir).is_file()
        && fs::read_to_string(speaker_marker(engine_dir)).is_ok_and(|version| version.trim() == SPEAKER_ENGINE_VERSION)
}

fn speaker_engine_status(state: &AppState) -> SpeakerEngineStatus {
    SpeakerEngineStatus {
        installed: speaker_engine_installed(&state.speaker_engine_dir),
        models_ready: speaker_models_marker(&state.speaker_models_dir).is_file(),
    }
}

fn extract_zip(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(app_error)?;
    let mut zip = zip::ZipArchive::new(file).map_err(app_error)?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(app_error)?;
        let Some(name) = entry.enclosed_name().map(PathBuf::from) else { return Err("Python 运行时压缩包包含不安全路径".to_string()); };
        let output = destination.join(name);
        if entry.is_dir() { fs::create_dir_all(output).map_err(app_error)?; continue; }
        if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(app_error)?; }
        let mut file = fs::File::create(output).map_err(app_error)?;
        io::copy(&mut entry, &mut file).map_err(app_error)?;
        file.flush().map_err(app_error)?;
    }
    Ok(())
}

fn run_python(python: &Path, arguments: &[&str], stage: &str) -> Result<(), String> {
    let mut command = Command::new(python);
    command.args(arguments);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(app_error)?;
    if output.status.success() { return Ok(()); }
    let error = String::from_utf8_lossy(&output.stderr);
    let standard_output = String::from_utf8_lossy(&output.stdout);
    let details = if error.trim().is_empty() { standard_output.trim() } else { error.trim() };
    Err(format!("{stage}失败：{details}"))
}

fn prepare_speaker_runtime(vcrt_dir: &Path, engine_dir: &Path) -> Result<(), String> {
    let python_dir = engine_dir.join("python");
    if !python_dir.is_dir() { return Err("本地 Python 运行时不存在，请重新安装说话人引擎".to_string()); }
    for name in VC_RUNTIME_DLLS {
        let source = vcrt_dir.join(name);
        if !source.is_file() { return Err("安装包缺少 Windows VC++ 运行库，请覆盖安装最新版知记后重试".to_string()); }
        let destination = python_dir.join(name);
        let needs_copy = !destination.is_file()
            || fs::metadata(&source).map_err(app_error)?.len() != fs::metadata(&destination).map_err(app_error)?.len();
        if needs_copy { fs::copy(&source, &destination).map_err(app_error)?; }
    }
    Ok(())
}

fn remove_broken_torch_installation(engine_dir: &Path) -> Result<(), String> {
    let site_packages = engine_dir.join("python").join("Lib").join("site-packages");
    if !site_packages.is_dir() { return Ok(()); }
    for entry in fs::read_dir(&site_packages).map_err(app_error)? {
        let entry = entry.map_err(app_error)?;
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        let is_torch_package = matches!(name.as_str(), "torch" | "torchgen" | "torchaudio" | "functorch")
            || (name.starts_with("torch-") && name.ends_with(".dist-info"))
            || (name.starts_with("torchaudio-") && name.ends_with(".dist-info"));
        if !is_torch_package { continue; }
        let path = entry.path();
        let result = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        result.map_err(|error| format!("清理损坏的本地计算组件失败（{}）：{error}", path.display()))?;
    }
    Ok(())
}

fn install_python_packages(python: &Path, packages: &[&str], index: &str, extra_index: Option<&str>, force_reinstall: bool, stage: &str) -> Result<(), String> {
    let mut arguments = vec![
        "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-warn-script-location", "--prefer-binary",
        "--retries", "12", "--resume-retries", "12", "--timeout", "90", "--index-url", index,
    ];
    if let Some(extra_index) = extra_index { arguments.extend_from_slice(&["--extra-index-url", extra_index]); }
    if force_reinstall { arguments.push("--force-reinstall"); }
    arguments.extend_from_slice(packages);
    run_python(python, &arguments, stage)
}

fn install_python_packages_with_fallback(python: &Path, packages: &[&str], stage: &str) -> Result<(), String> {
    match install_python_packages(python, packages, ALIYUN_PYPI_INDEX, Some(PYTORCH_CPU_INDEX), false, stage) {
        Ok(()) => Ok(()),
        Err(mirror_error) => install_python_packages(python, packages, OFFICIAL_PYPI_INDEX, Some(PYTORCH_CPU_INDEX), false, stage)
            .map_err(|official_error| format!("{official_error}\n\n国内镜像的首次尝试也失败：{mirror_error}")),
    }
}

fn install_speaker_engine(engine_dir: PathBuf, models_dir: PathBuf, vcrt_dir: PathBuf) -> Result<(), String> {
    let python = speaker_python(&engine_dir);
    if speaker_engine_installed(&engine_dir) { return Ok(()); }
    fs::create_dir_all(&engine_dir).map_err(app_error)?;
    fs::create_dir_all(&models_dir).map_err(app_error)?;
    let archive = engine_dir.join("python-embed.zip");
    if !python.is_file() {
        download_file(PYTHON_EMBED_URL, &archive)?;
        extract_zip(&archive, &engine_dir.join("python"))?;
        let _ = fs::remove_file(&archive);
    }
    if !python.is_file() { return Err("本地 Python 运行时下载不完整，请重试".to_string()); }
    let pth = engine_dir.join("python").join("python311._pth");
    let content = fs::read_to_string(&pth).map_err(app_error)?;
    fs::write(&pth, content.replace("#import site", "import site")).map_err(app_error)?;
    prepare_speaker_runtime(&vcrt_dir, &engine_dir)?;
    let get_pip = engine_dir.join("get-pip.py");
    if !get_pip.is_file() { download_file(GET_PIP_URL, &get_pip)?; }
    let get_pip_arg = get_pip.to_string_lossy().into_owned();
    run_python(&python, &[&get_pip_arg, "--disable-pip-version-check"], "准备会议引擎")?;
    remove_broken_torch_installation(&engine_dir)?;
    install_python_packages(&python, &[TORCH_CPU_VERSION, TORCHAUDIO_CPU_VERSION], PYTORCH_CPU_INDEX, None, false, "修复本地计算组件")?;
    install_python_packages_with_fallback(&python, &["funasr", "modelscope", "soundfile", TORCH_CPU_VERSION, TORCHAUDIO_CPU_VERSION], "安装说话人分离组件")?;
    run_python(&python, &["-c", "import torch, torchaudio, torchgen; print(torch.__version__, torchaudio.__version__)"], "验证本地计算组件")?;
    run_python(&python, &["-m", "pip", "check"], "检查说话人引擎依赖")?;
    fs::write(speaker_script(&engine_dir), include_str!("speaker_engine.py")).map_err(app_error)?;
    fs::write(speaker_marker(&engine_dir), SPEAKER_ENGINE_VERSION).map_err(app_error)?;
    Ok(())
}

fn run_speaker_engine(engine_dir: PathBuf, models_dir: PathBuf, runtime_dir: PathBuf, ffmpeg_dir: PathBuf, vcrt_dir: PathBuf, audio_path: String) -> Result<SpeakerTranscript, String> {
    let python = speaker_python(&engine_dir);
    let script = speaker_script(&engine_dir);
    if !speaker_engine_installed(&engine_dir) || !python.is_file() || !script.is_file() { return Err("说话人引擎需要修复，请点击“安装说话人引擎”完成升级".to_string()); }
    prepare_speaker_runtime(&vcrt_dir, &engine_dir)?;
    let (wav_path, remove_wav) = to_wav(&runtime_dir, &ffmpeg_dir, &audio_path)?;
    let result_path = engine_dir.join(format!("speaker-result-{}.json", Uuid::new_v4()));
    let audio_arg = wav_path.to_string_lossy().into_owned();
    let output_arg = result_path.to_string_lossy().into_owned();
    let models_arg = models_dir.to_string_lossy().into_owned();
    let script_arg = script.to_string_lossy().into_owned();
    let result = run_python(&python, &[&script_arg, "--audio", &audio_arg, "--output", &output_arg, "--model-cache", &models_arg], "本地说话人分离");
    if remove_wav { let _ = fs::remove_file(&wav_path); }
    result?;
    let mut input = fs::File::open(&result_path).map_err(app_error)?;
    let mut content = String::new();
    input.read_to_string(&mut content).map_err(app_error)?;
    let _ = fs::remove_file(&result_path);
    let mut transcript: SpeakerTranscript = serde_json::from_str(&content).map_err(|error| format!("本地说话人分离结果无效：{error}"))?;
    for segment in &mut transcript.segments { segment.text = strip_sensevoice_tokens(&segment.text).trim().to_string(); }
    transcript.segments.retain(|segment| !segment.text.is_empty());
    transcript.transcript = transcript.segments.iter()
        .map(|segment| format!("【{}】{}", segment.speaker, segment.text))
        .collect::<Vec<_>>()
        .join("\n");
    if transcript.transcript.trim().is_empty() || transcript.segments.is_empty() { return Err("本地说话人分离没有返回可用结果".to_string()); }
    fs::write(speaker_models_marker(&models_dir), "ready").map_err(app_error)?;
    Ok(transcript)
}

fn meetings(connection: &Connection) -> Result<Vec<Meeting>, String> {
    let mut statement = connection.prepare(&format!("SELECT {MEETING_COLUMNS} FROM meetings ORDER BY started_at DESC")).map_err(app_error)?;
    statement.query_map([], meeting_from_row).map_err(app_error)?.collect::<Result<Vec<_>, _>>().map_err(app_error)
}

fn tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection.prepare("SELECT id, title, source_type, source_id, completed, due_date, created_at, origin FROM tasks ORDER BY completed ASC, created_at DESC").map_err(app_error)?;
    statement.query_map([], |row| Ok(Task { id: row.get(0)?, title: row.get(1)?, source_type: row.get(2)?, source_id: row.get(3)?, completed: row.get::<_, i64>(4)? != 0, due_date: row.get(5)?, created_at: row.get(6)?, origin: row.get(7)? })).map_err(app_error)?.collect::<Result<Vec<_>, _>>().map_err(app_error)
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Workspace, String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    Ok(Workspace { meetings: meetings(&connection)?, tasks: tasks(&connection)? })
}

#[tauri::command]
fn get_ai_settings(state: State<'_, AppState>) -> Result<AiSettings, String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    ai_settings(&connection)
}

#[tauri::command]
fn get_local_asr_status(state: State<'_, AppState>) -> LocalAsrStatus { local_asr_status(&state) }

#[tauri::command]
fn get_speaker_engine_status(state: State<'_, AppState>) -> SpeakerEngineStatus { speaker_engine_status(&state) }

#[tauri::command]
async fn download_local_asr_model(state: State<'_, AppState>) -> Result<LocalAsrStatus, String> {
    let models_dir = state.models_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let model_path = models_dir.join(SENSEVOICE_MODEL_NAME);
        let vad_path = models_dir.join(FSMN_VAD_MODEL_NAME);
        if !model_path.is_file() { download_model(SENSEVOICE_MODEL_URLS, &model_path)?; }
        if !vad_path.is_file() { download_model(FSMN_VAD_MODEL_URLS, &vad_path)?; }
        Ok::<(), String>(())
    }).await.map_err(|error| format!("模型下载任务中断：{error}"))??;
    Ok(local_asr_status(&state))
}

#[tauri::command]
async fn install_speaker_engine_command(state: State<'_, AppState>) -> Result<SpeakerEngineStatus, String> {
    let engine_dir = state.speaker_engine_dir.clone();
    let models_dir = state.speaker_models_dir.clone();
    let vcrt_dir = state.vcrt_dir.clone();
    tauri::async_runtime::spawn_blocking(move || install_speaker_engine(engine_dir, models_dir, vcrt_dir)).await.map_err(|error| format!("说话人引擎安装任务中断：{error}"))??;
    Ok(speaker_engine_status(&state))
}

#[tauri::command]
fn save_ai_settings(state: State<'_, AppState>, settings: AiSettingsInput) -> Result<AiSettings, String> {
    let base_url = settings.base_url.trim_end_matches('/').to_string();
    if !base_url.starts_with("https://") && !base_url.starts_with("http://") { return Err("AI 服务地址必须以 http:// 或 https:// 开头".to_string()); }
    if settings.analysis_model.trim().is_empty() { return Err("请填写纪要模型名称".to_string()); }
    if let Some(api_key) = settings.api_key.filter(|value| !value.trim().is_empty()) { ai_key()?.set_password(api_key.trim()).map_err(app_error)?; }
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    for (key, value) in [("ai_base_url", base_url), ("ai_analysis_model", settings.analysis_model.trim().to_string())] {
        connection.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value]).map_err(app_error)?;
    }
    ai_settings(&connection)
}

#[tauri::command]
fn clear_ai_api_key() -> Result<(), String> {
    match ai_key()?.delete_password() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(error) => Err(app_error(error)) }
}

#[tauri::command]
fn get_asr_engine_settings(state: State<'_, AppState>) -> Result<AsrEngineSettings, String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    asr_engine_settings(&connection)
}

#[tauri::command]
fn save_asr_engine_settings(state: State<'_, AppState>, settings: AsrEngineSettingsInput) -> Result<AsrEngineSettings, String> {
    let provider = settings.provider.trim().to_string();
    if provider != "local" && provider != "cloud" { return Err("转写引擎只能是 local 或 cloud".to_string()); }
    let base_url = settings.cloud_base_url.trim_end_matches('/').to_string();
    if provider == "cloud" {
        if !base_url.starts_with("https://") && !base_url.starts_with("http://") { return Err("云端转写服务地址必须以 http:// 或 https:// 开头".to_string()); }
        if settings.cloud_model.trim().is_empty() { return Err("请填写云端转写模型名称".to_string()); }
    }
    if let Some(api_key) = settings.api_key.filter(|value| !value.trim().is_empty()) { cloud_asr_key()?.set_password(api_key.trim()).map_err(app_error)?; }
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    for (key, value) in [("asr_provider", provider), ("cloud_asr_base_url", base_url), ("cloud_asr_model", settings.cloud_model.trim().to_string())] {
        connection.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value]).map_err(app_error)?;
    }
    asr_engine_settings(&connection)
}

#[tauri::command]
fn clear_cloud_asr_key() -> Result<(), String> {
    match cloud_asr_key()?.delete_password() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(error) => Err(app_error(error)) }
}

#[tauri::command]
fn create_meeting(state: State<'_, AppState>, notebook_id: Option<String>) -> Result<Meeting, String> {
    let timestamp = now();
    let meeting = Meeting { id: id(), notebook_id, title: "未命名会议".to_string(), started_at: timestamp.clone(), duration_seconds: 0, status: "草稿".to_string(), transcript: String::new(), minutes: String::new(), decisions: String::new(), speaker_segments: "[]".to_string(), audio_path: None, updated_at: timestamp, context: String::new(), notes: String::new() };
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute(&format!("INSERT INTO meetings ({MEETING_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"), params![meeting.id, meeting.notebook_id, meeting.title, meeting.started_at, meeting.duration_seconds, meeting.status, meeting.transcript, meeting.minutes, meeting.decisions, meeting.speaker_segments, meeting.audio_path, meeting.updated_at, meeting.context, meeting.notes]).map_err(app_error)?;
    Ok(meeting)
}

#[tauri::command]
fn save_meeting(state: State<'_, AppState>, meeting: Meeting) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("UPDATE meetings SET notebook_id = ?2, title = ?3, started_at = ?4, duration_seconds = ?5, status = ?6, transcript = ?7, minutes = ?8, decisions = ?9, speaker_segments = ?10, audio_path = ?11, updated_at = ?12, context = ?13, notes = ?14 WHERE id = ?1", params![meeting.id, meeting.notebook_id, meeting.title, meeting.started_at, meeting.duration_seconds, meeting.status, meeting.transcript, meeting.minutes, meeting.decisions, meeting.speaker_segments, meeting.audio_path, now(), meeting.context, meeting.notes]).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
fn upsert_task(state: State<'_, AppState>, task: Task) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("INSERT INTO tasks (id, title, source_type, source_id, completed, due_date, created_at, origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET title = excluded.title, source_type = excluded.source_type, source_id = excluded.source_id, completed = excluded.completed, due_date = excluded.due_date", params![task.id, task.title, task.source_type, task.source_id, task.completed, task.due_date, task.created_at, task.origin]).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
fn delete_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("DELETE FROM tasks WHERE id = ?1", params![task_id]).map_err(app_error)?;
    Ok(())
}

fn recording_file(recordings_dir: &Path, meeting_id: &str) -> Result<PathBuf, String> {
    // meeting_id 来自前端，只允许安全字符，防止路径穿越
    if meeting_id.is_empty() || !meeting_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("会议标识无效".to_string());
    }
    Ok(recordings_dir.join(format!("{meeting_id}.webm")))
}

#[tauri::command]
fn begin_recording(state: State<'_, AppState>, meeting_id: String) -> Result<(), String> {
    let path = recording_file(&state.recordings_dir, &meeting_id)?;
    let existing_audio = {
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        meeting_by_id(&connection, &meeting_id)?.audio_path
    };
    // 重新录音前删除该会议在应用内管理的旧录音（导入的或上次录的），避免占用空间
    if let Some(old_audio) = existing_audio.as_deref() {
        if old_audio != path.to_string_lossy() { remove_managed_recording(&state.recordings_dir, old_audio); }
    }
    fs::File::create(&path).map_err(|error| format!("无法创建录音文件：{error}"))?;
    Ok(())
}

#[tauri::command]
fn append_recording_chunk(state: State<'_, AppState>, meeting_id: String, data_url: String) -> Result<(), String> {
    let encoded = data_url.split_once(',').map_or(data_url.as_str(), |(_, data)| data);
    let audio = STANDARD.decode(encoded).map_err(app_error)?;
    if audio.is_empty() { return Ok(()); }
    let path = recording_file(&state.recordings_dir, &meeting_id)?;
    let mut file = fs::OpenOptions::new().create(true).append(true).open(&path)
        .map_err(|error| format!("无法写入录音文件：{error}"))?;
    file.write_all(&audio).map_err(|error| format!("录音写入失败：{error}"))?;
    Ok(())
}

#[tauri::command]
fn finalize_recording(state: State<'_, AppState>, meeting_id: String, duration_seconds: i64) -> Result<Meeting, String> {
    let path = recording_file(&state.recordings_dir, &meeting_id)?;
    let size = fs::metadata(&path).map_err(|error| format!("录音文件不存在：{error}"))?.len();
    if size == 0 { let _ = fs::remove_file(&path); return Err("没有录到任何声音，请检查麦克风后重试".to_string()); }
    let probed = probe_audio_duration(&state.ffmpeg_dir, &path);
    let final_duration = if probed > 0 { probed } else { duration_seconds };
    let path_string = path.to_string_lossy().to_string();
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("UPDATE meetings SET audio_path = ?2, duration_seconds = ?3, status = ?4, updated_at = ?5 WHERE id = ?1", params![meeting_id, path_string, final_duration, "已录音", now()]).map_err(app_error)?;
    meeting_by_id(&connection, &meeting_id)
}

#[tauri::command]
fn get_recording_path(state: State<'_, AppState>, meeting_id: String) -> Result<String, String> {
    let meeting = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; meeting_by_id(&connection, &meeting_id)? };
    let audio_path = meeting.audio_path.ok_or_else(|| "该会议没有录音".to_string())?;
    if !PathBuf::from(&audio_path).is_file() { return Err("录音文件不存在，可能已被移动或删除".to_string()); }
    Ok(audio_path)
}

#[tauri::command]
fn import_meeting_audio(state: State<'_, AppState>, meeting_id: String, audio_path: String) -> Result<Meeting, String> {
    let source = PathBuf::from(&audio_path);
    if !source.is_file() { return Err("找不到选择的录音文件".to_string()); }
    if fs::metadata(&source).map_err(app_error)?.len() == 0 { return Err("选择的录音文件是空文件".to_string()); }
    let extension = source.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase)
        .ok_or_else(|| "录音文件缺少扩展名".to_string())?;
    const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "webm", "wma", "mp4"];
    if !AUDIO_EXTENSIONS.contains(&extension.as_str()) { return Err(format!("暂不支持 .{extension} 格式的录音")); }

    let existing = {
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        meeting_by_id(&connection, &meeting_id)?
    };
    let destination = state.recordings_dir.join(format!("{meeting_id}-import-{}.{}", Local::now().timestamp(), extension));
    fs::copy(&source, &destination).map_err(|error| format!("导入录音失败：{error}"))?;
    let duration_seconds = probe_audio_duration(&state.ffmpeg_dir, &destination);
    let destination_string = destination.to_string_lossy().into_owned();
    let update_result = (|| {
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        connection.execute(
            "UPDATE meetings SET audio_path = ?2, duration_seconds = ?3, status = ?4, updated_at = ?5 WHERE id = ?1",
            params![meeting_id, destination_string, duration_seconds, "已导入录音", now()],
        ).map_err(app_error)?;
        meeting_by_id(&connection, &existing.id)
    })();
    if update_result.is_err() { let _ = fs::remove_file(&destination); }
    let meeting = update_result?;
    if let Some(old_audio) = existing.audio_path.as_deref() {
        if old_audio != destination_string { remove_managed_recording(&state.recordings_dir, old_audio); }
    }
    Ok(meeting)
}

async fn transcribe_audio(state: &State<'_, AppState>, meeting: &Meeting) -> Result<String, String> {
    let audio_path = meeting.audio_path.clone().ok_or_else(|| "请先完成录音，再开始语音转写".to_string())?;
    let engine = {
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        asr_engine_settings(&connection)?
    };
    // 新一轮转写开始，清除上一次的取消标志
    state.cancel_flag.store(false, Ordering::SeqCst);
    if engine.provider == "cloud" {
        let api_key = cloud_asr_key()?.get_password().map_err(|_| "请先在设置中保存云端转写 API 密钥".to_string())?;
        if api_key.trim().is_empty() { return Err("请先在设置中保存云端转写 API 密钥".to_string()); }
        let prompt_hint = meeting.context.clone();
        tauri::async_runtime::spawn_blocking(move || run_cloud_asr(engine.cloud_base_url, engine.cloud_model, api_key, audio_path, prompt_hint))
            .await.map_err(|error| format!("云端转写任务中断：{error}"))?
    } else {
        let runtime_dir = state.runtime_dir.clone();
        let ffmpeg_dir = state.ffmpeg_dir.clone();
        let models_dir = state.models_dir.clone();
        let vcrt_dir = state.vcrt_dir.clone();
        let cancel_flag = state.cancel_flag.clone();
        let cancel_child = state.cancel_child.clone();
        tauri::async_runtime::spawn_blocking(move || run_local_asr(runtime_dir, ffmpeg_dir, models_dir, vcrt_dir, audio_path, cancel_flag, cancel_child))
            .await.map_err(|error| format!("本地转写任务中断：{error}"))?
    }
}

#[tauri::command]
async fn transcribe_meeting(state: State<'_, AppState>, meeting_id: String) -> Result<Meeting, String> {
    let meeting = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; meeting_by_id(&connection, &meeting_id)? };
    let transcript = transcribe_audio(&state, &meeting).await?;
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("UPDATE meetings SET transcript = ?2, status = ?3, updated_at = ?4 WHERE id = ?1", params![meeting_id, transcript, "已转写", now()]).map_err(app_error)?;
    meeting_by_id(&connection, &meeting.id)
}

#[tauri::command]
async fn transcribe_meeting_with_speakers(state: State<'_, AppState>, meeting_id: String) -> Result<Meeting, String> {
    let meeting = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; meeting_by_id(&connection, &meeting_id)? };
    let provider = {
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        asr_engine_settings(&connection)?.provider
    };
    // 云端引擎暂不做说话人分离：退化为纯云端转写，由前端提示用户
    if provider == "cloud" {
        let transcript = transcribe_audio(&state, &meeting).await?;
        let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
        connection.execute("UPDATE meetings SET transcript = ?2, status = ?3, updated_at = ?4 WHERE id = ?1", params![meeting_id, transcript, "已转写", now()]).map_err(app_error)?;
        return meeting_by_id(&connection, &meeting.id);
    }
    let audio_path = meeting.audio_path.clone().ok_or_else(|| "请先完成录音，再开始说话人分离".to_string())?;
    let engine_dir = state.speaker_engine_dir.clone();
    let models_dir = state.speaker_models_dir.clone();
    let runtime_dir = state.runtime_dir.clone();
    let ffmpeg_dir = state.ffmpeg_dir.clone();
    let vcrt_dir = state.vcrt_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || run_speaker_engine(engine_dir, models_dir, runtime_dir, ffmpeg_dir, vcrt_dir, audio_path)).await.map_err(|error| format!("说话人分离任务中断：{error}"))??;
    let segments = serde_json::to_string(&result.segments).map_err(app_error)?;
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("UPDATE meetings SET transcript = ?2, speaker_segments = ?3, status = ?4, updated_at = ?5 WHERE id = ?1", params![meeting_id, result.transcript, segments, "已区分发言人", now()]).map_err(app_error)?;
    meeting_by_id(&connection, &meeting.id)
}

/// 取消当前正在进行的本地转写：置取消标志并杀掉本地语音引擎子进程
#[tauri::command]
async fn cancel_processing(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = state.cancel_child.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

/// 拼智能纪要的 user prompt：有会前背景时带上，让 AI 结合背景理解转写稿
fn build_analysis_user_prompt(meeting: &Meeting) -> String {
    let context_block = if meeting.context.trim().is_empty() {
        String::new()
    } else {
        format!("\n\n会前背景（用户提供的会议材料，供你理解会议，不要在纪要中照抄）：\n{}", meeting.context.trim())
    };
    format!("会议标题：{}\n会议时间：{}{}\n\n转写稿：\n{}", meeting.title, meeting.started_at, context_block, meeting.transcript)
}

const ANALYSIS_SYSTEM_PROMPT: &str = "你是严谨的中文会议纪要助手。仅根据输入内容整理，不要编造事实、负责人或日期。只输出合法 JSON，不要 Markdown 代码围栏。\n\nJSON 格式要求（严格遵循类型）：\n- theme：字符串（4-12 个字的会议主题短语，如「临港三期沟通协调会」「Q3 预算评审」；不要带日期、标点、书名号，不要以「会议」结尾）\n- minutes：字符串（Markdown 格式的完整会议纪要；不要使用 HTML 标签，只用 Markdown 语法，如 ## 标题、**加粗**、- 列表、1. 有序列表）\n- decisions：字符串（关键决策，多项用换行分隔；不要用数组）\n- actionItems：数组，每项为 { \"title\": \"字符串\", \"dueDate\": \"字符串或null\" }\n\n行动项只保留明确或高度可信的事项。decisions 和 minutes 必须是字符串，不能用数组。";

/// 调聊天补全接口并解析出 AnalysisResponse（theme + minutes + decisions + actionItems）
fn request_analysis(settings: &AiSettings, api_key: &str, user_prompt: &str) -> Result<AnalysisResponse, String> {
    let body = json!({
      "model": settings.analysis_model,
      "temperature": 0.2,
      "messages": [
        { "role": "system", "content": ANALYSIS_SYSTEM_PROMPT },
        { "role": "user", "content": user_prompt }
      ]
    });
    let endpoint = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));
    let response: serde_json::Value = response_error(reqwest::blocking::Client::new().post(endpoint).bearer_auth(api_key).json(&body).send().map_err(app_error)?, "智能纪要服务")?.json().map_err(app_error)?;
    let content = response.pointer("/choices/0/message/content").and_then(serde_json::Value::as_str).ok_or_else(|| "智能纪要服务没有返回可解析的内容".to_string())?;
    let cleaned = clean_json(content);
    serde_json::from_str(&cleaned).map_err(|error| {
        let preview: String = cleaned.chars().take(500).collect();
        format!("智能纪要返回的格式无效，请重试：{error}\n\n返回内容前500字符：\n{preview}")
    })
}

#[tauri::command]
fn analyze_meeting(state: State<'_, AppState>, meeting_id: String) -> Result<AnalysisResult, String> {
    let (settings, api_key) = configured_ai(&state)?;
    let meeting = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; meeting_by_id(&connection, &meeting_id)? };
    if meeting.transcript.trim().is_empty() { return Err("请先完成语音转写，或在原始记录中粘贴会议内容".to_string()); }
    let prompt = build_analysis_user_prompt(&meeting);
    let analysis = request_analysis(&settings, &api_key, &prompt)?;
    if analysis.minutes.trim().is_empty() { return Err("智能纪要没有生成内容".to_string()); }
    // 自动命名：仅当标题仍是默认占位时，按「YYYYMMDD-主题」改名；用户改过的标题不动
    let auto_title = if meeting.title.trim() == "未命名会议" || meeting.title.trim().is_empty() {
        auto_meeting_title(&meeting.started_at, &analysis.theme)
    } else { None };
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    if let Some(title) = auto_title {
        connection.execute("UPDATE meetings SET minutes = ?2, decisions = ?3, status = ?4, title = ?5, updated_at = ?6 WHERE id = ?1", params![meeting_id, analysis.minutes.trim(), analysis.decisions.trim(), "已分析", title, now()]).map_err(app_error)?;
    } else {
        connection.execute("UPDATE meetings SET minutes = ?2, decisions = ?3, status = ?4, updated_at = ?5 WHERE id = ?1", params![meeting_id, analysis.minutes.trim(), analysis.decisions.trim(), "已分析", now()]).map_err(app_error)?;
    }
    // 重新生成纪要前先清掉该会议上一轮的 AI 待办，避免重复；手动添加的待办（origin = manual）保留
    connection.execute("DELETE FROM tasks WHERE source_type = 'meeting' AND source_id = ?1 AND origin = 'ai'", params![meeting_id]).map_err(app_error)?;
    let mut created_tasks = Vec::new();
    for item in analysis.action_items.into_iter().filter(|item| !item.title.trim().is_empty()) {
        let task = Task { id: id(), title: item.title.trim().to_string(), source_type: Some("meeting".to_string()), source_id: Some(meeting_id.clone()), completed: false, due_date: item.due_date.filter(|date| !date.trim().is_empty()), created_at: now(), origin: "ai".to_string() };
        connection.execute("INSERT INTO tasks (id, title, source_type, source_id, completed, due_date, created_at, origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![task.id, task.title, task.source_type, task.source_id, task.completed, task.due_date, task.created_at, task.origin]).map_err(app_error)?;
        created_tasks.push(task);
    }
    Ok(AnalysisResult { meeting: meeting_by_id(&connection, &meeting.id)?, tasks: created_tasks })
}

/// AI 重命名：根据转写稿（含会前背景）重新提炼主题，无条件按「YYYYMMDD-主题」覆盖当前标题
#[tauri::command]
fn rename_meeting(state: State<'_, AppState>, meeting_id: String) -> Result<Meeting, String> {
    let (settings, api_key) = configured_ai(&state)?;
    let meeting = { let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?; meeting_by_id(&connection, &meeting_id)? };
    if meeting.transcript.trim().is_empty() { return Err("请先完成语音转写，或在原始记录中粘贴会议内容，再来生成名称".to_string()); }
    let analysis = request_analysis(&settings, &api_key, &build_analysis_user_prompt(&meeting))?;
    let title = auto_meeting_title(&meeting.started_at, &analysis.theme)
        .ok_or_else(|| "智能纪要服务没有给出可用的会议主题，请重试".to_string())?;
    let connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    connection.execute("UPDATE meetings SET title = ?2, updated_at = ?3 WHERE id = ?1", params![meeting_id, title, now()]).map_err(app_error)?;
    meeting_by_id(&connection, &meeting_id)
}

#[tauri::command]
fn delete_meeting(state: State<'_, AppState>, meeting_id: String) -> Result<(), String> {
    let mut connection = state.connection.lock().map_err(|_| "数据库正被占用，请重试".to_string())?;
    let meeting = meeting_by_id(&connection, &meeting_id)?;
    let transaction = connection.transaction().map_err(app_error)?;
    transaction.execute("DELETE FROM tasks WHERE source_type = 'meeting' AND source_id = ?1", params![meeting_id]).map_err(app_error)?;
    let deleted = transaction.execute("DELETE FROM meetings WHERE id = ?1", params![meeting_id]).map_err(app_error)?;
    if deleted == 0 { return Err("找不到要删除的会议".to_string()); }
    transaction.commit().map_err(app_error)?;
    drop(connection);
    if let Some(audio_path) = meeting.audio_path.as_deref() { remove_managed_recording(&state.recordings_dir, audio_path); }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = open_state(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace, get_ai_settings, get_local_asr_status, get_speaker_engine_status,
            download_local_asr_model, install_speaker_engine_command,
            save_ai_settings, clear_ai_api_key,
            get_asr_engine_settings, save_asr_engine_settings, clear_cloud_asr_key,
            create_meeting, save_meeting, upsert_task, delete_task,
            begin_recording, append_recording_chunk, finalize_recording, get_recording_path,
            import_meeting_audio, transcribe_meeting,
            transcribe_meeting_with_speakers, cancel_processing,
            analyze_meeting, rename_meeting, delete_meeting
        ])
        .run(tauri::generate_context!())
        .expect("启动知记时发生错误");
}
