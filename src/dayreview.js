import { multiplayerApiUrl } from './multiplayer.js?v=52';

function localCourseReview(course) {
  if (course.score >= 90) return `재료의 결이 또렷하게 살아 있고 마지막 향의 여운까지 우아하게 이어지는 접시였어.`;
  if (course.score >= 75) return `첫맛의 인상은 매력적이지만 끝으로 갈수록 균형이 조금 흐려져 여운이 짧아진 점은 아쉽군.`;
  return `좋은 재료의 빛은 보였지만 맛의 선들이 아직 한곳에 모이지 못해 접시가 들려줄 이야기가 희미했어.`;
}

export function localGuestReviews(result) {
  const needLine = result.conditionMet
    ? `내가 기다린 맛의 결까지 놓치지 않아 저녁의 마지막 장면이 오래 남는군.`
    : `각 접시는 빛났지만 내가 기다린 한 줄기의 풍미가 끝내 모습을 드러내지 않은 점은 아쉽군.`;
  return {
    courses: result.courses.map((course) => ({ name: course.name, review: localCourseReview(course) })),
    final: `서로 다른 네 접시가 한 편의 저녁으로 이어졌다. ${needLine}`,
    source: 'local',
  };
}

export async function requestGuestReviews(result) {
  try {
    const response = await fetch(multiplayerApiUrl('/review'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest: result.guest,
        score: result.score,
        conditionMet: result.conditionMet,
        needMatches: result.needMatches,
        courses: result.courses.map(({ name, category, score, steps }) => ({
          name,
          category,
          score,
          steps,
        })),
      }),
    });
    if (!response.ok) throw new Error(`review API ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.courses) || typeof data.final !== 'string') throw new Error('invalid review');
    return { ...data, source: 'gpt-4o-mini' };
  } catch (error) {
    console.warn('[review] GPT review unavailable; using local review.', error);
    return localGuestReviews(result);
  }
}
