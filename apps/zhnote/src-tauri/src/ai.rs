use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "gpt-4o-mini";

const ZH_ENHANCE_SYSTEM: &str = r#"你是一个中文笔记助手。请根据用户提供的转写文本和手写笔记，生成结构化的中文摘要。

要求：
1. 使用简体中文输出
2. 不要写"摘要"或"会议总结"这类开头，直接进入内容
3. 全部使用全角标点（，。：；""（）等）
4. 中英文之间不加空格
5. 专有名词首次出现用"中文（English）"格式，后续用中文
6. 不要英文化标题
7. 用 Markdown 格式，包含：要点、待办事项（如有）、关键决策
8. 保持客观简洁，不要添加主观评价

输出格式要求（严格遵守）：
第一行以 TITLE: 开头，写一个简短的会议/笔记标题（不超过20字，不要包含日期时间，不要加书名号或引号）
第二行写 ---
从第三行开始写摘要正文

输出格式示例：
TITLE: 产品周会讨论下季度计划
---
## 要点
- ...

## 待办
- [ ] ...

## 关键决策
- ...
"#;

#[derive(Debug, Serialize, Deserialize)]
pub struct EnhanceRequest {
    pub transcript: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TitleSummary {
    pub title: String,
    pub summary: String,
}

pub async fn generate_title_and_summary(
    config: &LlmConfig,
    transcript: &str,
    notes: &str,
) -> anyhow::Result<TitleSummary> {
    let user_content = format!(
        "转写文本：\n{}\n\n手写笔记：\n{}",
        transcript, notes
    );

    let body = serde_json::json!({
        "model": &config.model,
        "messages": [
            {"role": "system", "content": ZH_ENHANCE_SYSTEM},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.3,
    });

    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("LLM 请求失败 ({}): {}", status, text);
    }

    let resp_json: serde_json::Value = resp.json().await?;
    let content = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let (title, summary) = parse_title_summary(&content);

    Ok(TitleSummary { title, summary })
}

fn parse_title_summary(content: &str) -> (String, String) {
    let mut lines = content.lines();

    let first_line = lines.next().unwrap_or("").trim();

    let title = if let Some(rest) = first_line.strip_prefix("TITLE:") {
        rest.trim().to_string()
    } else if !first_line.is_empty() && !first_line.starts_with("## ") && !first_line.starts_with("# ") {
        first_line.to_string()
    } else {
        String::new()
    };

    let mut rest: Vec<&str> = lines.collect();

    if !rest.is_empty() && rest[0].trim() == "---" {
        rest.remove(0);
    }

    let summary = rest.join("\n").trim().to_string();

    (title, summary)
}

pub async fn test_connection(config: &LlmConfig) -> anyhow::Result<()> {
    let body = serde_json::json!({
        "model": &config.model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
    });

    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("连接失败 ({}): {}", status, text);
    }

    Ok(())
}
