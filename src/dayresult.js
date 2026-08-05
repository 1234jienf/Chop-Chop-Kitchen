const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const average = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

function matchesGuestNeed(result, guest) {
  if (result.type !== guest?.bonusType) return false;
  // 불맛 손님은 설명대로 메인 코스의 굽기만 평가한다.
  if (guest.bonusType === 'grill') return result.course?.categoryId === 'main';
  return true;
}

export function calculateDayResult(state) {
  const courses = state.menu.courses.map((course) => {
    const steps = state.results.filter((result) => result.course?.name === course.name);
    const score = Math.round(average(steps.map((step) => step.accuracy)));
    return {
      id: course.categoryId,
      category: course.category,
      name: course.name,
      score,
      stepCount: steps.length,
      revenue: 75 + score * 2,
      steps: steps.map((step) => ({
        title: step.title,
        type: step.type,
        action: step.action,
        accuracy: step.accuracy,
      })),
    };
  });

  const matching = state.results.filter((result) => matchesGuestNeed(result, state.guest));
  const conditionMet = matching.length > 0 && matching.every((result) => result.accuracy >= 70);
  const baseScore = Math.round(average(courses.map((course) => course.score)));
  const needBonusScore = conditionMet ? 5 : 0;
  const needBonusRevenue = conditionMet ? 100 : 0;
  const score = clamp(baseScore + needBonusScore, 0, 100);
  const stars = clamp(Math.ceil(score / 20), 1, 5);
  const revenue = courses.reduce((sum, course) => sum + course.revenue, 0) + needBonusRevenue;

  return {
    day: state.day,
    guest: state.guest,
    courses,
    baseScore,
    score,
    stars,
    revenue,
    conditionMet,
    needBonusScore,
    needBonusRevenue,
    needMatches: matching.map((result) => ({
      course: result.course?.name || '',
      step: result.title,
      accuracy: result.accuracy,
    })),
  };
}
