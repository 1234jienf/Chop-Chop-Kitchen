import { GUESTS, PLAYERS, STARTER_MENU } from './data.js';

const flattenSteps = (menu) => menu.courses.flatMap((course) =>
  course.steps.map((process, processIndex) => ({ ...process, course, processIndex }))
);

export function createGameState() {
  return {
    day: 1,
    money: 1200,
    grade: '1성',
    menu: STARTER_MENU,
    guest: GUESTS[Math.floor(Math.random() * GUESTS.length)],
    currentStep: 0,
    results: [],
    finished: false,
  };
}

export function getSteps(state) { return flattenSteps(state.menu); }
export function getCurrent(state) { return getSteps(state)[state.currentStep]; }
export function getPlayer(state) { return PLAYERS[state.currentStep % PLAYERS.length]; }

export function submitStep(state, accuracy) {
  if (state.finished) return;
  const current = getCurrent(state);
  state.results.push({ ...current, accuracy });
  state.currentStep += 1;
  state.finished = state.currentStep >= getSteps(state).length;
}

export function calculateResult(state) {
  const base = state.results.reduce((sum, result) => sum + result.accuracy, 0) / state.results.length;
  const matching = state.results.filter((result) => result.type === state.guest.bonusType);
  const conditionMet = matching.length > 0 && matching.every((result) => result.accuracy >= 70);
  const score = Math.min(100, Math.round(base + (conditionMet ? 5 : 0)));
  const stars = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  const revenue = 300 + stars * 150;
  return { score, stars, revenue, conditionMet };
}

export function startNextDay(state) {
  const result = calculateResult(state);
  state.day += 1;
  state.money += result.revenue;
  state.grade = state.money >= 3000 ? '2성' : '1성';
  state.guest = GUESTS[Math.floor(Math.random() * GUESTS.length)];
  state.currentStep = 0;
  state.results = [];
  state.finished = false;
}
