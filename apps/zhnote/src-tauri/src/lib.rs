mod ai;
mod commands;
mod db;
mod stt;

use db::Db;
use stt::SttState;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tracing::Level;
use tracing_subscriber::FmtSubscriber;

fn init_logging() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .with_target(false)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);
}

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

    let result = ai::generate_title_and_summary(&config, &note.transcript, &note.body)
        .await
        .map_err(|e| e.to_string())?;

    commands::save_summary_impl(&db, &note_id, &result.summary)
        .await
        .map_err(|e| e.to_string())?;

    if !result.title.is_empty() {
        let time_part = format_note_time(&note.created_at);
        let new_title = if note.title.is_empty() || is_auto_title(&note.title) {
            format!("{} {}", result.title, time_part)
        } else {
            note.title.clone()
        };

        if new_title != note.title {
            commands::update_note_impl(&db, &note_id, Some(&new_title), None)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(result.summary)
}

fn format_note_time(created_at: &str) -> String {
    let cleaned = created_at.split('.').next().unwrap_or(created_at);
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(cleaned, "%Y-%m-%d %H:%M:%S") {
        dt.format("%m-%d %H:%M").to_string()
    } else if cleaned.len() >= 10 {
        cleaned[..10].to_string()
    } else {
        cleaned.to_string()
    }
}

fn is_auto_title(title: &str) -> bool {
    title.trim().is_empty()
}

#[tauri::command]
async fn test_llm_connection(config: ai::LlmConfig) -> Result<(), String> {
    ai::test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn transcribe_audio(
    db: tauri::State<'_, Db>,
    stt_state: tauri::State<'_, SttState>,
    audio_path: String,
) -> Result<stt::TranscribeResult, String> {
    let stt_json = commands::get_setting_impl(&db, "stt_config")
        .await
        .map_err(|e| e.to_string())?
        .ok_or("请先在设置中配置语音转写")?;

    let config: stt::SttConfig =
        serde_json::from_str(&stt_json).map_err(|e| e.to_string())?;

    if config.mode == "local" {
        let mut guard = stt_state.engine.lock().map_err(|e| e.to_string())?;

        if guard.is_none() {
            let engine = stt::SttEngine::new(&stt_state.model_dir, config.diarization)
                .map_err(|e| format!("本地引擎初始化失败: {}", e))?;
            *guard = Some(engine);
        }

        let engine = guard.as_ref().ok_or("本地引擎未初始化")?;

        let wav_path = if audio_path.ends_with(".wav") {
            audio_path.clone()
        } else {
            let wav_path = audio_path.rsplit_once('.').map_or(
                format!("{}.wav", audio_path),
                |(stem, _)| format!("{}.wav", stem),
            );
            convert_to_wav(&audio_path, &wav_path)
                .map_err(|e| format!("音频格式转换失败: {}", e))?;
            wav_path
        };

        engine.transcribe(&wav_path).map_err(|e| e.to_string())
    } else {
        let bytes = std::fs::read(&audio_path)
            .map_err(|e| format!("读取音频文件失败: {}", e))?;

        let filename = std::path::Path::new(&audio_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("audio.webm")
            .to_string();

        stt::transcribe_cloud(&config, bytes, filename)
            .await
            .map_err(|e| e.to_string())
    }
}

fn convert_to_wav(input: &str, output: &str) -> anyhow::Result<()> {
    let status = std::process::Command::new("ffmpeg")
        .args(["-y", "-i", input, "-ar", "16000", "-ac", "1", "-f", "wav", output])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;

    if !status.success() {
        anyhow::bail!("ffmpeg 转换失败");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    tracing::info!("启动 Zhnote...");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let app_data_dir = match app_handle.path().app_data_dir() {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("获取 app_data_dir 失败: {}", e);
                    let msg = format!("无法获取应用数据目录：{}\n\n应用即将退出。", e);
                    app_handle
                        .dialog()
                        .message(msg)
                        .title("Zhnote 启动失败")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::Ok)
                        .blocking_show();
                    std::process::exit(1);
                }
            };
            tracing::info!("app_data_dir = {}", app_data_dir.display());

            let db = tauri::async_runtime::block_on(db::open_db(app_data_dir.clone()));
            match db {
                Ok(db) => {
                    tracing::info!("数据库初始化成功");
                    app_handle.manage(db);
                }
                Err(e) => {
                    tracing::error!("数据库初始化失败: {}", e);
                    let msg = format!("数据库初始化失败：{}\n\n应用即将退出。", e);
                    app_handle
                        .dialog()
                        .message(msg)
                        .title("Zhnote 启动失败")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::Ok)
                        .blocking_show();
                    std::process::exit(1);
                }
            }

            let model_dir = app_data_dir.join("models");
            let _ = std::fs::create_dir_all(&model_dir);

            app_handle.manage(SttState {
                engine: std::sync::Mutex::new(None),
                model_dir,
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
            commands::save_segments,
            commands::get_setting,
            commands::set_setting,
            generate_summary,
            test_llm_connection,
            transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zhnote");
}
