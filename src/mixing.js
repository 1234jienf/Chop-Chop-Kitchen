/**
 * 섞기 미니게임:
 * 1. 보울이 중심 기준 시계방향 공전
 * 2. 섞기 이미지가 안에서 빠르게 자전
 * 3. 사용자의 말 속도에 따라 공전/자전 속도 조절
 * 4. 사용자가 가이드 대본을 따라 읽으며 정확도 채점
 * 5. 정확도가 낮으면 섞기 이미지가 화면 밖으로 날아감
 */

export const DEFAULT_SCRIPT = '동구리오 타돗테모 츠키마센';
export const SCRIPT_DURATION = 25; // 대본을 읽어야 할 목표 시간(초)

// 모션 파라미터
export const ORBIT_SPEED_BASE = 39; // 기본 공전 속도(도/초)
export const SPIN_SPEED_BASE = 108; // 기본 자전 속도(도/초)
export const VOLUME_MIN = 5;
export const VOLUME_MAX = 80;

export function createMixingSession() {
  return {
    scriptText: DEFAULT_SCRIPT,
    guideScript: DEFAULT_SCRIPT,
    elapsed: 0,
    active: false,
    done: false,
    
    // 모션 상태
    bowlOrbitAngle: 0,
    mixingSpinAngle: 0,
    
    // 음성 추적
    lastVolume: 0,
    volumeHistory: [], // 최근 음량 기록
    recognizedText: '', // 현재 인식된 음성 텍스트
    
    // 정확도 추적
    accuracy: 0, // 0~100
    accuracyHistory: [],
    accuracyDropRate: 0,
    scriptMatchProgress: 0, // 대본 일치도 (0~1)
    
    // 실패 상태
    hasFailedOut: false, // 섞기 이미지가 튀어나갔는지 여부
    failOutStart: 0, // 실패 애니메이션 시작 시간
    failOutVelX: 0, // 튀어나갈 때 X 속도
    failOutVelY: 0, // 튀어나갈 때 Y 속도
    failOutX: 0, // 현재 X 위치 (오프셋)
    failOutY: 0, // 현재 Y 위치 (오프셋)
  };
}

/**
 * 현재 음량에 따라 모션 속도 계산
 * volume: 0~100
 * 반환: 0~1 범위의 속도 계수
 */
function getSpeedMultiplier(volume) {
  if (volume < VOLUME_MIN) return 0;
  if (volume > VOLUME_MAX) return 1;
  return (volume - VOLUME_MIN) / (VOLUME_MAX - VOLUME_MIN);
}

/**
 * @param {number} volumePercent 0~100
 * @param {number} dtSec
 */
export function tickMixing(session, volumePercent, dtSec) {
  if (!session?.active || session.done) return;
  
  session.elapsed += dtSec;
  session.lastVolume = volumePercent;
  
  // 음량 히스토리 업데이트 (최근 1초)
  session.volumeHistory.push({ volume: volumePercent, time: session.elapsed });
  session.volumeHistory = session.volumeHistory.filter((v) => session.elapsed - v.time < 1);
  
  const speedMult = getSpeedMultiplier(volumePercent);
  
  if (!session.hasFailedOut) {
    // 정상 상태: 보울 공전 + 섞기 이미지 자전
    const orbitSpeed = ORBIT_SPEED_BASE * Math.max(0.55, speedMult);
    const spinSpeed = SPIN_SPEED_BASE * Math.max(0.13, speedMult);
    
    // 공전/자전 속도 불일치에 따른 보너스 속도 (차이가 클수록 빠르게)
    const speedDiff = Math.abs(orbitSpeed - spinSpeed) / Math.max(orbitSpeed, spinSpeed);
    const bonusSpeedMult = 1 + speedDiff * 0.5; // 불일치 정도에 따라 최대 1.5배 증가
    
    session.bowlOrbitAngle += orbitSpeed * bonusSpeedMult * dtSec;
    session.mixingSpinAngle += spinSpeed * bonusSpeedMult * dtSec;
    
    // 각도 정규화 (360도 이상이면 초기화)
    session.bowlOrbitAngle = session.bowlOrbitAngle % 360;
    session.mixingSpinAngle = session.mixingSpinAngle % 360;
    
    // 정확도 갱신 (음량 및 속도 불일치 기반)
    // 정상 범위: VOLUME_MIN ~ VOLUME_MAX
    // 범위를 벗어나면 정확도 감소
    const isInRange = volumePercent >= VOLUME_MIN && volumePercent <= VOLUME_MAX;
    let newAccuracy = session.accuracy;
    if (isInRange) {
      // 정확도 회복 (천천히) - 속도 불일치가 적을수록 더 빨리 회복
      newAccuracy = Math.min(100, session.accuracy + (8 * (1 - speedDiff * 0.3)) * dtSec);
    } else {
      // 정확도 하락 (빠르게) - 속도 불일치가 클수록 더 빨리 하락
      newAccuracy = Math.max(0, session.accuracy - (25 * (1 + speedDiff * 0.3)) * dtSec);
    }
    session.accuracy = newAccuracy;
    session.accuracyHistory.push({ accuracy: newAccuracy, time: session.elapsed });
    
    // 정확도가 0에 가까우면 실패 상태로
    if (session.accuracy < 5) {
      session.hasFailedOut = true;
      session.failOutStart = session.elapsed;
      // 난수 기반 튀어나갈 방향과 속도
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 100;
      session.failOutVelX = Math.cos(angle) * speed;
      session.failOutVelY = Math.sin(angle) * speed;
      session.failOutX = 0;
      session.failOutY = 0;
    }
  } else {
    // 실패 상태: 이미지가 화면 밖으로 날아감
    const failElapsed = session.elapsed - session.failOutStart;
    session.failOutX += session.failOutVelX * dtSec;
    session.failOutY += session.failOutVelY * dtSec;
    
    // 일정 시간 이후 세션 종료
    if (failElapsed > 2) {
      session.done = true;
      session.active = false;
    }
  }
  
  // 대본을 완벽하게 읽었으면 즉시 완료
  if (session.scriptMatchProgress >= 1.0) {
    session.done = true;
    session.active = false;
    return;
  }
  
  // 시간이 다 되었으면 완료
  if (session.elapsed >= SCRIPT_DURATION) {
    session.done = true;
    session.active = false;
  }
}

export function resetMixing(session, scriptText = DEFAULT_SCRIPT) {
  session.scriptText = scriptText;
  session.guideScript = scriptText;
  session.elapsed = 0;
  session.active = false;
  session.done = false;
  
  session.bowlOrbitAngle = 0;
  session.mixingSpinAngle = 0;
  
  session.lastVolume = 0;
  session.volumeHistory = [];
  session.recognizedText = '';
  
  session.accuracy = 100;
  session.accuracyHistory = [];
  session.accuracyDropRate = 0;
  session.scriptMatchProgress = 0;
  
  session.hasFailedOut = false;
  session.failOutStart = 0;
  session.failOutVelX = 0;
  session.failOutVelY = 0;
  session.failOutX = 0;
  session.failOutY = 0;
}

export function startMixing(session, scriptText = DEFAULT_SCRIPT) {
  resetMixing(session, scriptText);
  session.active = true;
  session.accuracy = 100;
}

export function stopMixing(session) {
  session.active = false;
  session.done = true;
}

/**
 * 현재 정확도 점수 반환 (0~100)
 */
export function getMixingScore(session) {
  if (session.accuracyHistory.length === 0) return 100;
  
  // 평균 정확도 계산
  const avgAccuracy = session.accuracyHistory.reduce((sum, h) => sum + h.accuracy, 0) / session.accuracyHistory.length;
  
  // 혹은 마지막 정확도 반환
  return Math.round(session.accuracy);
}

/**
 * 보울의 2D 위치 계산 (중심 기준 원형 궤도)
 * @returns {{ x: number, y: number }}
 */
export function getBowlPosition(session, centerX = 0, centerY = 0, orbitRadius = 30) {
  const angleRad = (session.bowlOrbitAngle * Math.PI) / 180;
  return {
    x: centerX + Math.cos(angleRad) * orbitRadius,
    y: centerY + Math.sin(angleRad) * orbitRadius,
  };
}

/**
 * 보울의 회전각 (보울이 공전하면서 자전하지 않으므로 0)
 */
export function getBowlRotation() {
  return 0;
}

/**
 * 섞기 이미지의 회전각
 */
export function getMixingRotation(session) {
  return session.mixingSpinAngle;
}

/**
 * 섞기 이미지의 오프셋 (실패 상태)
 */
export function getMixingOffset(session) {
  return {
    x: session.failOutX,
    y: session.failOutY,
    opacity: session.hasFailedOut ? Math.max(0, 1 - (session.elapsed - session.failOutStart) / 2) : 1,
  };
}

/**
 * 현재 세션 상태를 요약 (UI 렌더링용)
 */
export function getMixingState(session) {
  return {
    elapsed: session.elapsed,
    totalDuration: SCRIPT_DURATION,
    accuracy: session.accuracy,
    score: getMixingScore(session),
    active: session.active,
    done: session.done,
    hasFailedOut: session.hasFailedOut,
    progress: session.elapsed / SCRIPT_DURATION,
  };
}
