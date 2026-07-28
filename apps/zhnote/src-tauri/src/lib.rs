mod ai;
mod commands;
mod db;
mod stt;

use db::Db;
use stt::SttState;
use tauri::{Emitter, Manager};
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

#[tauri::command]
fn check_stt_models(stt_state: tauri::State<'_, SttState>) -> Result<stt::ModelStatus, String> {
    Ok(stt::check_models(&stt_state.model_dir))
}

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    file_name: String,
    current: u64,
    total: u64,
    percent: u32,
    file_index: usize,
    file_count: usize,
}

#[tauri::command]
async fn download_stt_models(
    stt_state: tauri::State<'_, SttState>,
    app_handle: tauri::AppHandle,
    include_diarization: bool,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let model_dir = stt_state.model_dir.clone();

    struct DownloadItem {
        url: &'static str,
        display_name: &'static str,
        kind: &'static str,
        dest_rel_path: &'static str,
    }

    let mut items = vec![
        DownloadItem {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
            display_name: "SenseVoice 模型 (228MB)",
            kind: "tarbz2",
            dest_rel_path: "",
        },
        DownloadItem {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
            display_name: "VAD 模型 (1.8MB)",
            kind: "file",
            dest_rel_path: "silero_vad.onnx",
        },
    ];

    if include_diarization {
        items.push(DownloadItem {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
            display_name: "说话人分割模型 (5MB)",
            kind: "tarbz2",
            dest_rel_path: "",
        });
        items.push(DownloadItem {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            display_name: "说话人嵌入模型 (118MB)",
            kind: "file",
            dest_rel_path: "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k/model.onnx",
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Zhnote/0.1.6")
        .build()
        .map_err(|e| e.to_string())?;

    let item_count = items.len();

    for (i, item) in items.iter().enumerate() {
        let _ = app_handle.emit("stt-download-progress", DownloadProgress {
            file_name: item.display_name.to_string(),
            current: 0,
            total: 0,
            percent: 0,
            file_index: i,
            file_count: item_count,
        });

        let resp = client.get(item.url).send().await.map_err(|e| format!("下载失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("下载失败: HTTP {} ({})", resp.status(), item.url));
        }

        let total = resp.content_length().unwrap_or(0);
        let temp_path = model_dir.join(format!("__download_{}", i));

        let mut file = tokio::fs::File::create(&temp_path).await.map_err(|e| e.to_string())?;
        let mut resp = resp;
        let mut downloaded: u64 = 0;

        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;

            let percent = if total > 0 { (downloaded * 100 / total) as u32 } else { 0 };
            let _ = app_handle.emit("stt-download-progress", DownloadProgress {
                file_name: item.display_name.to_string(),
                current: downloaded,
                total,
                percent,
                file_index: i,
                file_count: item_count,
            });
        }
        drop(file);

        if item.kind == "tarbz2" {
            extract_tar_bz2(&temp_path, &model_dir)
                .map_err(|e| format!("解压失败: {}", e))?;
            std::fs::remove_file(&temp_path).ok();
        } else {
            let dest = model_dir.join(item.dest_rel_path);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::rename(&temp_path, &dest).map_err(|e| e.to_string())?;
        }
    }

    let mut guard = stt_state.engine.lock().map_err(|e| e.to_string())?;
    *guard = None;

    Ok(())
}

fn extract_tar_bz2(archive_path: &std::path::Path, dest_dir: &std::path::Path) -> anyhow::Result<()> {
    use bzip2::read::BzDecoder;
    use std::fs::File;
    use std::io::BufReader;

    let file = File::open(archive_path)?;
    let bz = BzDecoder::new(BufReader::new(file));
    let mut archive = tar::Archive::new(bz);
    archive.unpack(dest_dir)?;
    Ok(())
}

#[tauri::command]
fn open_model_dir(stt_state: tauri::State<'_, SttState>) -> Result<(), String> {
    let path = &stt_state.model_dir;
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
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
            commands::search_notes,
            commands::list_trashed_notes,
            commands::restore_note,
            commands::get_note,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::save_transcript,
            commands::save_summary,
            commands::save_segments,
            commands::get_setting,
            commands::set_setting,
            commands::export_note_markdown,
            generate_summary,
            test_llm_connection,
            transcribe_audio,
            check_stt_models,
            download_stt_models,
            open_model_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zhnote");
}
