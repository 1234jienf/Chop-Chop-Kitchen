from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import pipeline
import torch
import numpy as np
import io
import os
import av
import re

try:
    from .review_api import router as review_router
except ImportError:
    from review_api import router as review_router

app = FastAPI()
app.include_router(review_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Whisper 파이프라인 모델 로딩 중...")
device = 0 if torch.cuda.is_available() else -1

speech_recognizer = pipeline(
    "automatic-speech-recognition",
    model="openai/whisper-small",
    device=device
)
print(f"모델 로딩 완료! (디바이스: {'cuda' if device == 0 else 'cpu'})")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        print(f"수신된 파일 크기: {len(audio_bytes)} 바이트")

        container = av.open(io.BytesIO(audio_bytes))
        audio_stream = next((s for s in container.streams if s.type == 'audio'), None)
        if not audio_stream:
            raise HTTPException(status_code=400, detail="오디오 스트림을 찾을 수 없습니다.")

        original_sample_rate = audio_stream.rate or 48000

        frames = []
        for frame in container.decode(audio_stream):
            arr = frame.to_ndarray()
            if np.issubdtype(arr.dtype, np.integer):
                arr = arr.astype(np.float32) / 32768.0
            else:
                arr = arr.astype(np.float32)
            frames.append(arr)
                
        if not frames:
            raise HTTPException(status_code=400, detail="디코딩된 오디오 프레임이 없습니다.")
            
        audio_array = np.concatenate(frames, axis=1).squeeze()
        if audio_array.ndim > 1:
            audio_array = audio_array.mean(axis=0)

        if original_sample_rate != 16000:
            duration = len(audio_array) / original_sample_rate
            new_length = int(duration * 16000)
            audio_array = np.interp(
                np.linspace(0, len(audio_array) - 1, new_length),
                np.arange(len(audio_array)),
                audio_array
            )

        print(f"최종 audio_array - 길이: {len(audio_array)}, 최솟값: {np.min(audio_array)}, 최댓값: {np.max(audio_array)}")

        result = speech_recognizer(
            audio_array,
            return_timestamps="word",
            generate_kwargs={"language": "en", "task": "transcribe"}
        )

        transcription = result.get("text", "").strip()
        raw_chunks = result.get("chunks", [])

        refined_chunks = []
        current_word = ""
        start_time = None
        end_time = None

        for chunk in raw_chunks:
            text_piece = chunk.get("text", "")
            timestamp = chunk.get("timestamp", (None, None))
            c_start, c_end = timestamp if isinstance(timestamp, (list, tuple)) else (None, None)

            if not text_piece:
                continue

            if text_piece.startswith("-") and current_word:
                current_word += text_piece
                if c_end is not None:
                    end_time = float(c_end)
            else:
                if current_word:
                    clean_word = re.sub(r'[,.]', '', current_word).strip()
                    if clean_word and start_time is not None and end_time is not None:
                        refined_chunks.append({
                            "text": clean_word,
                            "start": start_time,
                            "end": end_time
                        })
                current_word = text_piece
                start_time = float(c_start) if c_start is not None else 0.0
                end_time = float(c_end) if c_end is not None else start_time

        if current_word:
            clean_word = re.sub(r'[,.]', '', current_word).strip()
            if clean_word and start_time is not None and end_time is not None:
                refined_chunks.append({
                    "text": clean_word,
                    "start": start_time,
                    "end": end_time
                })

        refined_chunks = [chunk for chunk in refined_chunks if chunk['start'] < chunk['end']]
        print(f"인식된 텍스트: {transcription}")
        print(f"timestamp: {refined_chunks}")

        peak_amplitude = float(np.max(np.abs(audio_array)))
        mean_amplitude = float(np.mean(np.abs(audio_array)))
        rms_volume = float(np.sqrt(np.mean(audio_array**2)))

        return {
            "success": True, 
            "text": transcription,
            "chunks": refined_chunks,
            "volume_stats": {
                "peak": peak_amplitude,
                "mean": mean_amplitude,
                "rms": rms_volume
            }
        }

    except Exception as e:
        print(f"에러 발생 상세: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
