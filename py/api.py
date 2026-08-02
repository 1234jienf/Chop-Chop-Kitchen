from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import torch
import numpy as np
import io
import os
import av
import wave
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. WAV 파일이 저장될 폴더 지정 (현재 스크립트 경로 기준 'wav_uploads' 폴더)
# UPLOAD_DIR = "wav_uploads"
# os.makedirs(UPLOAD_DIR, exist_ok=True)

print("Whisper 모델 로딩 중...")
processor = WhisperProcessor.from_pretrained("openai/whisper-small")
model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-small")

device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)
print(f"모델 로딩 완료! (디바이스: {device})")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        
        # 파일이 제대로 들어왔는지 확인용 로그
        print(f"수신된 파일 크기: {len(audio_bytes)} 바이트")

        # PyAV 컨테이너 오픈
        container = av.open(io.BytesIO(audio_bytes))
        
        # [수정] 첫 번째 스트림 대신 명시적으로 오디오 스트림 찾기
        audio_stream = next((s for s in container.streams if s.type == 'audio'), None)
        if not audio_stream:
            raise HTTPException(status_code=400, detail="오디오 스트림을 찾을 수 없습니다.")

        original_sample_rate = audio_stream.rate
        if not original_sample_rate:
            original_sample_rate = 48000 # 기본값 fallback

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
            
        # 배열 결합
        audio_array = np.concatenate(frames, axis=1).squeeze()
        
        # 다채널인 경우 모노로 변환
        if audio_array.ndim > 1:
            audio_array = audio_array.mean(axis=0)

        # [디버깅] 최종 디코딩된 오디오 배열의 통계 출력
        print(f"최종 audio_array - 길이: {len(audio_array)}, 최솟값: {np.min(audio_array)}, 최댓값: {np.max(audio_array)}")

        # 16kHz 리샘플링
        if original_sample_rate != 16000:
            duration = len(audio_array) / original_sample_rate
            new_length = int(duration * 16000)
            audio_array = np.interp(
                np.linspace(0, len(audio_array) - 1, new_length),
                np.arange(len(audio_array)),
                audio_array
            )

        # WAV 파일 저장 로직 (필요시 유지)
        filename = f"recording.wav"
        file_path = os.path.join(filename)
        wav_pcm_data = (np.clip(audio_array, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        with wave.open(file_path, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            wav_file.writeframes(wav_pcm_data)

        # Whisper 특징 추출
        input_features = processor(
            audio_array, 
            sampling_rate=16000, 
            return_tensors="pt"
        ).input_features.to(device)

        if device == "cuda":
            input_features = input_features.half()
            model.half()

        with torch.no_grad():
            predicted_ids = model.generate(
                input_features, 
                language="en", 
                task="transcribe",
                num_beams=1,
                do_sample=False
            )

        transcription = processor.batch_decode(
            predicted_ids, 
            skip_special_tokens=True, 
            clean_up_tokenization_spaces=False
        )[0]

        peak_amplitude = float(np.max(np.abs(audio_array)))  # 최대 진폭
        mean_amplitude = float(np.mean(np.abs(audio_array))) # 평균 진폭
        rms_volume = float(np.sqrt(np.mean(audio_array**2))) # 소리의 크기 (RMS)

        print(f"음성 크기 분석 - 최대 진폭: {peak_amplitude:.4f}, RMS 음량: {rms_volume:.4f}")

        return {
            "success": True, 
            "text": transcription,
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