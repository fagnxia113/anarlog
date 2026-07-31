use std::{
    error::Error,
    fs,
    path::PathBuf,
    sync::Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

struct AppState {
    connection: Mutex<Connection>,
    database_path: PathBuf,
    recordings_dir: PathBuf,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notebook {
    id: String,
    name: String,
    color: String,
    created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    notebook_id: Option<String>,
    title: String,
    content: String,
    tags: String,
    updated_at: String,
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
    audio_path: Option<String>,
    updated_at: String,
}

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    notebooks: Vec<Notebook>,
    notes: Vec<Note>,
    meetings: Vec<Meeting>,
    tasks: Vec<Task>,
}

fn now() -> String {
    Local::now().to_rfc3339()
}

fn id() -> String {
    Uuid::new_v4().to_string()
}

fn app_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn open_state(app: &AppHandle) -> Result<AppState, Box<dyn Error>> {
    let data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let recordings_dir = data_dir.join("recordings");
    fs::create_dir_all(&recordings_dir)?;

    let database_path = data_dir.join("zhiji.sqlite3");
    let connection = Connection::open(&database_path)?;
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          notebook_id TEXT,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY,
          notebook_id TEXT,
          title TEXT NOT NULL,
          started_at TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL,
          status TEXT NOT NULL,
          transcript TEXT NOT NULL,
          minutes TEXT NOT NULL,
          decisions TEXT NOT NULL,
          audio_path TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_type TEXT,
          source_id TEXT,
          completed INTEGER NOT NULL,
          due_date TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON meetings(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
        ",
    )?;

    let count: i64 = connection.query_row("SELECT COUNT(*) FROM notebooks", [], |row| row.get(0))?;
    if count == 0 {
        let notebook_id = id();
        let timestamp = now();
        connection.execute(
            "INSERT INTO notebooks (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![notebook_id, "收集箱", "#4f7cff", timestamp],
        )?;
        connection.execute(
            "INSERT INTO notes (id, notebook_id, title, content, tags, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id(),
                notebook_id,
                "欢迎使用知记",
                "从这里开始记录。你可以创建会议、保存录音、整理纪要，并把行动项统一放进待办。",
                "开始使用",
                now()
            ],
        )?;
    }

    Ok(AppState {
        connection: Mutex::new(connection),
        database_path,
        recordings_dir,
    })
}

fn copy_folder(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(app_error)?;
    for entry in fs::read_dir(source).map_err(app_error)? {
        let entry = entry.map_err(app_error)?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_folder(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(app_error)?;
        }
    }
    Ok(())
}

fn notebooks(connection: &Connection) -> Result<Vec<Notebook>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, color, created_at FROM notebooks ORDER BY created_at ASC")
        .map_err(app_error)?;
    statement
        .query_map([], |row| {
            Ok(Notebook {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(app_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(app_error)
}

fn notes(connection: &Connection) -> Result<Vec<Note>, String> {
    let mut statement = connection
        .prepare("SELECT id, notebook_id, title, content, tags, updated_at FROM notes ORDER BY updated_at DESC")
        .map_err(app_error)?;
    statement
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                notebook_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                tags: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(app_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(app_error)
}

fn meetings(connection: &Connection) -> Result<Vec<Meeting>, String> {
    let mut statement = connection
        .prepare("SELECT id, notebook_id, title, started_at, duration_seconds, status, transcript, minutes, decisions, audio_path, updated_at FROM meetings ORDER BY started_at DESC")
        .map_err(app_error)?;
    statement
        .query_map([], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                notebook_id: row.get(1)?,
                title: row.get(2)?,
                started_at: row.get(3)?,
                duration_seconds: row.get(4)?,
                status: row.get(5)?,
                transcript: row.get(6)?,
                minutes: row.get(7)?,
                decisions: row.get(8)?,
                audio_path: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(app_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(app_error)
}

fn tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare("SELECT id, title, source_type, source_id, completed, due_date, created_at FROM tasks ORDER BY completed ASC, created_at DESC")
        .map_err(app_error)?;
    statement
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                source_type: row.get(2)?,
                source_id: row.get(3)?,
                completed: row.get::<_, i64>(4)? != 0,
                due_date: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(app_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(app_error)
}

#[tauri::command]
fn load_workspace(state: State<'_, AppState>) -> Result<Workspace, String> {
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    Ok(Workspace {
        notebooks: notebooks(&connection)?,
        notes: notes(&connection)?,
        meetings: meetings(&connection)?,
        tasks: tasks(&connection)?,
    })
}

#[tauri::command]
fn create_notebook(state: State<'_, AppState>, name: String, color: String) -> Result<Notebook, String> {
    let notebook = Notebook { id: id(), name, color, created_at: now() };
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "INSERT INTO notebooks (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![notebook.id, notebook.name, notebook.color, notebook.created_at],
    ).map_err(app_error)?;
    Ok(notebook)
}

#[tauri::command]
fn create_note(state: State<'_, AppState>, notebook_id: Option<String>) -> Result<Note, String> {
    let note = Note {
        id: id(), notebook_id, title: "未命名笔记".to_string(), content: String::new(), tags: String::new(), updated_at: now(),
    };
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "INSERT INTO notes (id, notebook_id, title, content, tags, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![note.id, note.notebook_id, note.title, note.content, note.tags, note.updated_at],
    ).map_err(app_error)?;
    Ok(note)
}

#[tauri::command]
fn save_note(state: State<'_, AppState>, note: Note) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "UPDATE notes SET notebook_id = ?2, title = ?3, content = ?4, tags = ?5, updated_at = ?6 WHERE id = ?1",
        params![note.id, note.notebook_id, note.title, note.content, note.tags, now()],
    ).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
fn create_meeting(state: State<'_, AppState>, notebook_id: Option<String>) -> Result<Meeting, String> {
    let timestamp = now();
    let meeting = Meeting {
        id: id(), notebook_id, title: "未命名会议".to_string(), started_at: timestamp.clone(), duration_seconds: 0,
        status: "草稿".to_string(), transcript: String::new(), minutes: String::new(), decisions: String::new(), audio_path: None, updated_at: timestamp,
    };
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "INSERT INTO meetings (id, notebook_id, title, started_at, duration_seconds, status, transcript, minutes, decisions, audio_path, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![meeting.id, meeting.notebook_id, meeting.title, meeting.started_at, meeting.duration_seconds, meeting.status, meeting.transcript, meeting.minutes, meeting.decisions, meeting.audio_path, meeting.updated_at],
    ).map_err(app_error)?;
    Ok(meeting)
}

#[tauri::command]
fn save_meeting(state: State<'_, AppState>, meeting: Meeting) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "UPDATE meetings SET notebook_id = ?2, title = ?3, started_at = ?4, duration_seconds = ?5, status = ?6, transcript = ?7, minutes = ?8, decisions = ?9, audio_path = ?10, updated_at = ?11 WHERE id = ?1",
        params![meeting.id, meeting.notebook_id, meeting.title, meeting.started_at, meeting.duration_seconds, meeting.status, meeting.transcript, meeting.minutes, meeting.decisions, meeting.audio_path, now()],
    ).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
fn upsert_task(state: State<'_, AppState>, task: Task) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "INSERT INTO tasks (id, title, source_type, source_id, completed, due_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET title = excluded.title, source_type = excluded.source_type, source_id = excluded.source_id, completed = excluded.completed, due_date = excluded.due_date",
        params![task.id, task.title, task.source_type, task.source_id, task.completed, task.due_date, task.created_at],
    ).map_err(app_error)?;
    Ok(())
}

#[tauri::command]
fn save_recording(state: State<'_, AppState>, meeting_id: String, data_url: String, duration_seconds: i64) -> Result<String, String> {
    let encoded = data_url.split_once(',').map_or(data_url.as_str(), |(_, data)| data);
    let audio = STANDARD.decode(encoded).map_err(app_error)?;
    let path = state.recordings_dir.join(format!("{meeting_id}-{}.webm", Local::now().timestamp()));
    fs::write(&path, audio).map_err(app_error)?;
    let path_string = path.to_string_lossy().to_string();
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(
        "UPDATE meetings SET audio_path = ?2, duration_seconds = ?3, status = ?4, updated_at = ?5 WHERE id = ?1",
        params![meeting_id, path_string, duration_seconds, "已录音", now()],
    ).map_err(app_error)?;
    Ok(path_string)
}

#[tauri::command]
fn backup_workspace(state: State<'_, AppState>) -> Result<String, String> {
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_root = state
        .database_path
        .parent()
        .ok_or_else(|| "无法定位资料库目录".to_string())?
        .join("backups")
        .join(format!("zhiji-{timestamp}"));
    fs::create_dir_all(&backup_root).map_err(app_error)?;

    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute_batch("PRAGMA wal_checkpoint(FULL);").map_err(app_error)?;
    fs::copy(&state.database_path, backup_root.join("zhiji.sqlite3")).map_err(app_error)?;
    drop(connection);
    copy_folder(&state.recordings_dir, &backup_root.join("recordings"))?;

    Ok(backup_root.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_entity(state: State<'_, AppState>, entity: String, id: String) -> Result<(), String> {
    let table = match entity.as_str() {
        "note" => "notes",
        "meeting" => "meetings",
        "task" => "tasks",
        "notebook" => "notebooks",
        _ => return Err("不支持的删除对象".to_string()),
    };
    let connection = state.connection.lock().map_err(|_| "数据库正在被占用，请重试".to_string())?;
    connection.execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id]).map_err(app_error)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(open_state(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            create_notebook,
            create_note,
            save_note,
            create_meeting,
            save_meeting,
            upsert_task,
            save_recording,
            backup_workspace,
            delete_entity
        ])
        .run(tauri::generate_context!())
        .expect("启动知记时发生错误");
}
