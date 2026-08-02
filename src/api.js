// api.js

/**
 * webm 오디오 Blob을 파이썬 Whisper API로 전송하고 결과를 받는 함수
 * @param {Blob} audioBlob - 녹음된 webm 오디오 파일
 */
export async function sendWebmAudioToPythonAPI(audioBlob) {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    const response = await fetch("http://127.0.0.1:8000/transcribe", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`서버 오류 발생: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.success) {
        return data.text;
    } else {
        throw new Error("음성 변환 실패");
    }
}