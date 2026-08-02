export class AudioMeter {
  constructor(onLevel) {
    this.onLevel = onLevel;
    this.stream = null;
    this.frame = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 마이크 입력을 지원하지 않습니다.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(samples);
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      this.onLevel(Math.min(100, average * 1.8));
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.onLevel(0);
  }
}
