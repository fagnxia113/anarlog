use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SttConfig {
    pub base_url: String,
    pub api_key: String,
    pub language: String,
}

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscribeResult {
    pub text: String,
}

pub async fn transcribe(
    config: &SttConfig,
    audio_bytes: Vec<u8>,
    filename: String,
) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let url = format!("{}/audio/transcriptions", config.base_url.trim_end_matches('/'));

    let mut form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .text("response_format", "json");

    if config.language != "auto" {
        form = form.text("language", config.language.clone());
    }

    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename)
        .mime_str("audio/wav")?;
    form = form.part("file", part);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .multipart(form)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("语音转写失败 ({}): {}", status, text);
    }

    let resp_json: serde_json::Value = resp.json().await?;
    let text = resp_json["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(text)
}
