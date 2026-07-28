use serde::{Deserialize, Serialize};
use sherpa_onnx::*;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SttConfig {
    pub language: String,
    pub diarization: bool,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            language: "zh".into(),
            diarization: true,
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

        let vad_config = VoiceActivityDetectorConfig {
            model: model_dir
                .join("silero_vad.onnx")
                .to_str()
                .unwrap_or_default()
                .to_string(),
            threshold: 0.5,
            min_silence_duration: 0.3,
            min_speech_duration: 0.25,
            max_speech_duration: 600.0,
            window_size: 512,
            ..Default::default()
        };

        let vad = VoiceActivityDetector::new(vad_config)?;

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

        tracing::info!("STT 引擎初始化完成 (SenseVoice, diarization={})", diarizer.is_some());

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
