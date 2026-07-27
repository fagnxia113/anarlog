use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

use crate::db::Db;

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub transcript: String,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn list_notes(db: State<'_, Db>) -> Result<Vec<Note>, String> {
    let rows = sqlx::query("SELECT id, title, body, transcript, summary, created_at, updated_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC")
        .fetch_all(db.pool())
        .await
        .map_err(|e| e.to_string())?;

    let notes = rows
        .into_iter()
        .map(|r| Note {
            id: r.get("id"),
            title: r.get("title"),
            body: r.get("body"),
            transcript: r.get("transcript"),
            summary: r.get("summary"),
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        })
        .collect();

    Ok(notes)
}

#[tauri::command]
pub async fn get_note(db: State<'_, Db>, id: String) -> Result<Option<Note>, String> {
    let row = sqlx::query("SELECT id, title, body, transcript, summary, created_at, updated_at FROM notes WHERE id = ? AND deleted_at IS NULL")
        .bind(&id)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| Note {
        id: r.get("id"),
        title: r.get("title"),
        body: r.get("body"),
        transcript: r.get("transcript"),
        summary: r.get("summary"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }))
}

#[tauri::command]
pub async fn create_note(db: State<'_, Db>) -> Result<Note, String> {
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO notes (id) VALUES (?)")
        .bind(&id)
        .execute(db.pool())
        .await
        .map_err(|e| e.to_string())?;

    get_note(db, id).await.map(|n| n.unwrap())
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    if let Some(title) = title {
        sqlx::query("UPDATE notes SET title = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&title)
            .bind(&id)
            .execute(db.pool())
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(body) = body {
        sqlx::query("UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&body)
            .bind(&id)
            .execute(db.pool())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_note(db: State<'_, Db>, id: String) -> Result<(), String> {
    sqlx::query("UPDATE notes SET deleted_at = datetime('now') WHERE id = ?")
        .bind(&id)
        .execute(db.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_transcript(db: State<'_, Db>, id: String, transcript: String) -> Result<(), String> {
    sqlx::query("UPDATE notes SET transcript = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&transcript)
        .bind(&id)
        .execute(db.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_summary(db: State<'_, Db>, id: String, summary: String) -> Result<(), String> {
    sqlx::query("UPDATE notes SET summary = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&summary)
        .bind(&id)
        .execute(db.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(db.pool())
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| r.get::<String, _>("value")))
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&key)
        .bind(&value)
        .execute(db.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
