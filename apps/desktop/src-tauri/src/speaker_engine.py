import argparse
import json
import os
import re


def value(item, *keys):
    for key in keys:
        candidate = item.get(key)
        if candidate not in (None, ""):
            return candidate
    return ""


def clean_text(text):
    return re.sub(r"<\|[^>]*\|>", "", str(text)).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-cache", required=True)
    args = parser.parse_args()

    os.environ["MODELSCOPE_CACHE"] = args.model_cache
    os.environ["HF_HOME"] = args.model_cache
    from funasr import AutoModel

    model = AutoModel(
        model="iic/SenseVoiceSmall",
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        spk_model="cam++",
        device="cpu",
    )
    result = model.generate(
        input=args.audio,
        cache={},
        language="auto",
        use_itn=True,
        batch_size_s=60,
        merge_vad=True,
        merge_length_s=15,
    )
    payload = result[0] if isinstance(result, list) else result
    segments = []
    for item in payload.get("sentence_info", []):
        text = clean_text(value(item, "text", "sentence"))
        if not text:
            continue
        speaker = value(item, "spk", "speaker")
        segments.append(
            {
                "speaker": f"发言人 {int(speaker) + 1}"
                if str(speaker).isdigit()
                else f"发言人 {speaker or 1}",
                "startMs": int(value(item, "start") or 0),
                "endMs": int(value(item, "end") or 0),
                "text": text,
            }
        )
    if not segments:
        raise RuntimeError("会议引擎没有返回可用的说话人分段")
    transcript = "\n".join(f"【{item['speaker']}】{item['text']}" for item in segments)
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(
            {"transcript": transcript, "segments": segments}, output, ensure_ascii=False
        )


if __name__ == "__main__":
    main()
