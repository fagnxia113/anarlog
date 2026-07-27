mod ai;
mod commands;
mod db;
mod stt;

use db::Db;
use tauri::Manager;

#[tauri::command]
async fn generate_summary(db: tauri::State<'_, Db>, note_id: String) -> Result<String, String> {
    let llm_json = commands::get_setting_impl(&db, "llm_config")
        .await
        .map_err(|e| e.to_string())?
        .ok_or("请先在设置中配置 AI 大模型")?;

    let config: ai::LlmConfig =
        serde_json::from_str(&llm_json).map_err(|e| e.to_string())?;

    let note = commands::get_note_impl(&db, &note_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("笔记不存在")?;

    let summary = ai::generate_summary(&config, &note.transcript, &note.body)
        .await
        .map_err(|e| e.to_string())?;

    commands::save_summary_impl(&db, &note_id, &summary)
        .await
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
async fn test_llm_connection(config: ai::LlmConfig) -> Result<(), String> {
    ai::test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn transcribe_audio(db: tauri::State<'_, Db>, audio_path: String) -> Result<String, String> {
    let stt_json = commands::get_setting_impl(&db, "stt_config")
        .await
        .map_err(|e| e.to_string())?
        .ok_or("请先在设置中配置语音转写")?;

    let config: stt::SttConfig =
        serde_json::from_str(&stt_json).map_err(|e| e.to_string())?;

    let bytes = std::fs::read(&audio_path)
        .map_err(|e| format!("读取音频文件失败: {}", e))?;

    let filename = std::path::Path::new(&audio_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.wav")
        .to_string();

    stt::transcribe(&config, bytes, filename)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::block_on(async move {
                let app_data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");

                let db = match db::open_db(app_data_dir).await {
                    Ok(db) => db,
                    Err(e) => {
                        eprintln!("数据库初始化失败: {}", e);
                        std::process::exit(1);
                    }
                };

                app_handle.manage(db);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_notes,
            commands::get_note,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::save_transcript,
            commands::save_summary,
            commands::get_setting,
            commands::set_setting,
            generate_summary,
            test_llm_connection,
            transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zhnote");
}
