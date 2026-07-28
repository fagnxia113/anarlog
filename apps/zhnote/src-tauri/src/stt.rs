use serde::{Deserialize, Serialize};
use sherpa_onnx::*;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SttConfig {
    pub mode: String,
    pub language: String,
    pub diarization: bool,
    pub cloud_base_url: String,
    pub cloud_api_key: String,
    pub cloud_model: String,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            mode: "cloud".into(),
            language: "zh".into(),
            diarization: false,
            cloud_base_url: "https://api.openai.com/v1".into(),
            cloud_api_key: String::new(),
            cloud_model: "whisper-1".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerSegment {
    pub speaker: i32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeResult {
    pub text: String,
    pub segments: Vec<SpeakerSegment>,
}

pub struct SttState {
    pub engine: Mutex<Option<SttEngine>>,
    pub model_dir: PathBuf,
}

pub struct SttEngine {
    recognizer: OfflineRecognizer,
    vad: VoiceActivityDetector,
    diarizer: Option<OfflineSpeakerDiarization>,
}

impl SttEngine {
    pub fn new(model_dir: &std::path::Path, enable_diarization: bool) -> anyhow::Result<Self> {
        let sensevoice_model = model_dir.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
        let model_onnx = sensevoice_model.join("model.int8.onnx");
        let tokens_txt = sensevoice_model.join("tokens.txt");

        if !model_onnx.exists() {
            anyhow::bail!(
                "SenseVoice 模型文件不存在: {}\n请将模型放置到 {} 目录下",
                model_onnx.display(),
                model_dir.display()
            );
        }

        let recognizer_config = OfflineRecognizerConfig {
            model_config: OfflineModelConfig {
                sense_voice: SenseVoiceModelConfig {
                    model: model_onnx.to_str().unwrap_or_default().to_string(),
                    language: "auto".to_string(),
                    use_itn: true,
                },
                tokens: tokens_txt.to_str().unwrap_or_default().to_string(),
                num_threads: 4,
                ..Default::default()
            },
            ..Default::default()
        };

        let recognizer = OfflineRecognizer::new(recognizer_config)?;

        let vad_path = model_dir.join("silero_vad.onnx");
        let vad = if vad_path.exists() {
            let vad_config = VoiceActivityDetectorConfig {
                model: vad_path.to_str().unwrap_or_default().to_string(),
                threshold: 0.5,
                min_silence_duration: 0.3,
                min_speech_duration: 0.25,
                max_speech_duration: 600.0,
                window_size: 512,
                ..Default::default()
            };
            VoiceActivityDetector::new(vad_config)?
        } else {
            anyhow::bail!("VAD 模型文件不存在: {}", vad_path.display());
        };

        let diarizer = if enable_diarization {
            let seg_model = model_dir.join("sherpa-onnx-pyannote-segmentation-3-0");
            let emb_model = model_dir.join("3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k");

            if seg_model.exists() && emb_model.exists() {
                let diar_config = OfflineSpeakerDiarizationConfig {
                    segmentation: OfflineSpeakerSegmentationModelConfig {
                        pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                            model: seg_model.to_str().unwrap_or_default().to_string(),
                        },
                        ..Default::default()
                    },
                    embedding: SpeakerEmbeddingExtractorConfig {
                        model: emb_model.to_str().unwrap_or_default().to_string(),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                match OfflineSpeakerDiarization::new(diar_config) {
                    Ok(d) => {
                        tracing::info!("说话人分离模型加载成功");
                        Some(d)
                    }
                    Err(e) => {
                        tracing::warn!("说话人分离模型加载失败: {}, 将不启用说话人分离", e);
                        None
                    }
                }
            } else {
                tracing::info!("说话人分离模型文件不存在,不启用说话人分离");
                None
            }
        } else {
            None
        };

        tracing::info!("本地 STT 引擎初始化完成 (diarization={})", diarizer.is_some());

        Ok(Self {
            recognizer,
            vad,
            diarizer,
        })
    }

    pub fn transcribe(&self, wav_path: &str) -> anyhow::Result<TranscribeResult> {
        let wave = Wave::from_wav_file(wav_path)?;

        if let Some(ref diarizer) = self.diarizer {
            let diar_result = diarizer.process(&wave.samples, wave.sample_rate);

            let mut segments = Vec::new();
            let mut full_text = String::new();

            for seg in &diar_result.segments {
                let start_sample = (seg.start * wave.sample_rate as f64) as usize;
                let end_sample = (seg.end * wave.sample_rate as f64) as usize;
                let end_sample = end_sample.min(wave.samples.len());

                if start_sample >= end_sample {
                    continue;
                }

                let chunk = &wave.samples[start_sample..end_sample];

                let mut stream = self.recognizer.create_stream();
                stream.accept_waveform(wave.sample_rate, chunk.to_vec());
                self.recognizer.decode(&mut stream);
                let result = self.recognizer.get_result(&mut stream);
                let text = result.text.trim().to_string();

                if !text.is_empty() {
                    if !full_text.is_empty() {
                        full_text.push('\n');
                    }
                    full_text.push_str(&format!("[说话人{}] {}", seg.speaker, text));

                    segments.push(SpeakerSegment {
                        speaker: seg.speaker,
                        start_ms: (seg.start * 1000.0) as i64,
                        end_ms: (seg.end * 1000.0) as i64,
                        text,
                    });
                }
            }

            Ok(TranscribeResult {
                text: full_text,
                segments,
            })
        } else {
            self.vad.accept_waveform(wave.sample_rate, wave.samples.clone());

            let mut segments = Vec::new();
            let mut full_text = String::new();
            let mut offset_ms: i64 = 0;

            while !self.vad.empty() {
                let speech = self.vad.front();
                self.vad.pop();

                let mut stream = self.recognizer.create_stream();
                stream.accept_waveform(wave.sample_rate, speech.samples().to_vec());
                self.recognizer.decode(&mut stream);
                let result = self.recognizer.get_result(&mut stream);
                let text = result.text.trim().to_string();

                if !text.is_empty() {
                    let start_ms = (speech.start() as f64 / wave.sample_rate as f64 * 1000.0) as i64;
                    let dur_ms = (speech.samples().len() as f64 / wave.sample_rate as f64 * 1000.0) as i64;

                    if !full_text.is_empty() {
                        full_text.push('\n');
                    }
                    full_text.push_str(&text);

                    segments.push(SpeakerSegment {
                        speaker: 0,
                        start_ms: offset_ms + start_ms,
                        end_ms: offset_ms + start_ms + dur_ms,
                        text,
                    });
                }
                offset_ms += (speech.samples().len() as f64 / wave.sample_rate as f64 * 1000.0) as i64;
            }

            Ok(TranscribeResult {
                text: full_text,
                segments,
            })
        }
    }
}

pub async fn transcribe_cloud(
    config: &SttConfig,
    audio_bytes: Vec<u8>,
    filename: String,
) -> anyhow::Result<TranscribeResult> {
    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename)
        .mime_str("audio/webm")?;

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", config.cloud_model.clone())
        .text("language", config.language.clone())
        .text("response_format", "verbose_json");

    let client = reqwest::Client::new();
    let url = format!(
        "{}/audio/transcriptions",
        config.cloud_base_url.trim_end_matches('/')
    );

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.cloud_api_key))
        .multipart(form)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("云端转写请求失败 ({}): {}", status, text);
    }

    let resp_json: serde_json::Value = resp.json().await?;
    let text = resp_json["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let segments: Vec<SpeakerSegment> = resp_json["segments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let seg_text = s["text"].as_str()?.trim().to_string();
                    if seg_text.is_empty() {
                        return None;
                    }
                    Some(SpeakerSegment {
                        speaker: 0,
                        start_ms: (s["start"].as_f64()? * 1000.0) as i64,
                        end_ms: (s["end"].as_f64()? * 1000.0) as i64,
                        text: seg_text,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(TranscribeResult { text, segments })
}
