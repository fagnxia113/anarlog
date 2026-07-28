use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

use crate::db::Db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub transcript: String,
    pub segments: String,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_note(r: sqlx::sqlite::SqliteRow) -> Note {
    Note {
        id: r.get("id"),
        title: r.get("title"),
        body: r.get("body"),
        transcript: r.get("transcript"),
        segments: r.try_get("segments").unwrap_or_default(),
        summary: r.get("summary"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }
}

pub async fn list_notes_impl(db: &Db) -> anyhow::Result<Vec<Note>> {
    let rows = sqlx::query(
        "SELECT id, title, body, transcript, segments, summary, created_at, updated_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )
    .fetch_all(db.pool())
    .await?;
    Ok(rows.into_iter().map(row_to_note).collect())
}

pub async fn search_notes_impl(db: &Db, query: &str) -> anyhow::Result<Vec<Note>> {
    let pattern = format!("%{}%", query);
    let rows = sqlx::query(
        "SELECT id, title, body, transcript, segments, summary, created_at, updated_at FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ? OR transcript LIKE ?) ORDER BY updated_at DESC",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(db.pool())
    .await?;
    Ok(rows.into_iter().map(row_to_note).collect())
}

pub async fn list_trashed_notes_impl(db: &Db) -> anyhow::Result<Vec<Note>> {
    let rows = sqlx::query(
        "SELECT id, title, body, transcript, segments, summary, created_at, updated_at FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )
    .fetch_all(db.pool())
    .await?;
    Ok(rows.into_iter().map(row_to_note).collect())
}

pub async fn restore_note_impl(db: &Db, id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE notes SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn get_note_impl(db: &Db, id: &str) -> anyhow::Result<Option<Note>> {
    let row = sqlx::query(
        "SELECT id, title, body, transcript, segments, summary, created_at, updated_at FROM notes WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db.pool())
    .await?;
    Ok(row.map(row_to_note))
}

pub async fn create_note_impl(db: &Db) -> anyhow::Result<Note> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO notes (id) VALUES (?)")
        .bind(&id)
        .execute(db.pool())
        .await?;
    get_note_impl(db, &id).await?.ok_or_else(|| anyhow::anyhow!("刚创建的笔记不存在"))
}

pub async fn update_note_impl(
    db: &Db,
    id: &str,
    title: Option<&str>,
    body: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(t) = title {
        sqlx::query("UPDATE notes SET title = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(t)
            .bind(id)
            .execute(db.pool())
            .await?;
    }
    if let Some(b) = body {
        sqlx::query("UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(b)
            .bind(id)
            .execute(db.pool())
            .await?;
    }
    Ok(())
}

pub async fn delete_note_impl(db: &Db, id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE notes SET deleted_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn save_transcript_impl(db: &Db, id: &str, transcript: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE notes SET transcript = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(transcript)
        .bind(id)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn save_segments_impl(db: &Db, id: &str, segments: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE notes SET segments = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(segments)
        .bind(id)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn save_summary_impl(db: &Db, id: &str, summary: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE notes SET summary = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(summary)
        .bind(id)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn get_setting_impl(db: &Db, key: &str) -> anyhow::Result<Option<String>> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db.pool())
        .await?;
    Ok(row.map(|r| r.get::<String, _>("value")))
}

pub async fn set_setting_impl(db: &Db, key: &str, value: &str) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(db.pool())
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_notes(db: State<'_, Db>) -> Result<Vec<Note>, String> {
    list_notes_impl(&db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_notes(db: State<'_, Db>, query: String) -> Result<Vec<Note>, String> {
    search_notes_impl(&db, &query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_trashed_notes(db: State<'_, Db>) -> Result<Vec<Note>, String> {
    list_trashed_notes_impl(&db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_note(db: State<'_, Db>, id: String) -> Result<(), String> {
    restore_note_impl(&db, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_note(db: State<'_, Db>, id: String) -> Result<Option<Note>, String> {
    get_note_impl(&db, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(db: State<'_, Db>) -> Result<Note, String> {
    create_note_impl(&db).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    update_note_impl(&db, &id, title.as_deref(), body.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_note(db: State<'_, Db>, id: String) -> Result<(), String> {
    delete_note_impl(&db, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_transcript(db: State<'_, Db>, id: String, transcript: String) -> Result<(), String> {
    save_transcript_impl(&db, &id, &transcript)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_segments(db: State<'_, Db>, id: String, segments: String) -> Result<(), String> {
    save_segments_impl(&db, &id, &segments)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_summary(db: State<'_, Db>, id: String, summary: String) -> Result<(), String> {
    save_summary_impl(&db, &id, &summary)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    get_setting_impl(&db, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    set_setting_impl(&db, &key, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_note_markdown(db: State<'_, Db>, id: String) -> Result<String, String> {
    let note = get_note_impl(&db, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("笔记不存在")?;

    let mut md = format!("# {}\n\n", note.title);
    md.push_str(&format!("> 创建时间: {}\n\n", note.created_at));

    if !note.transcript.is_empty() {
        md.push_str("## 转写记录\n\n");
        md.push_str(&note.transcript);
        md.push_str("\n\n");
    }

    if !note.summary.is_empty() {
        md.push_str("## AI 摘要\n\n");
        md.push_str(&note.summary);
        md.push_str("\n\n");
    }

    if !note.body.is_empty() {
        md.push_str("## 笔记内容\n\n");
        md.push_str(&note.body);
        md.push_str("\n");
    }

    Ok(md)
}
