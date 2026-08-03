import { GUESTS, PLAYERS, STARTER_MENU } from './data.js';

const flattenSteps = (menu) =>
  menu.courses.flatMap((course) => course.steps.map((process) => ({ ...process, course })));

export function createGameState() {
  return {
    day: 1,
    money: 1200,
    grade: '1성',
    menu: STARTER_MENU,
    guest: GUESTS[Math.floor(Math.random() * GUESTS.length)],
    players: [...PLAYERS],
    currentStep: 0,
    results: [],
    finished: false,
    /** 재료별 이전 썰기 횟수 → 굽기 때 단면 개수 */
    ingredientCuts: {},
  };
}

export const getSteps = (state) => flattenSteps(state.menu);
export const getCurrent = (state) => getSteps(state)[state.currentStep];
export const getPlayer = (state) => state.players[state.currentStep % state.players.length];

export function submitStep(state, accuracy) {
  if (state.finished) return;
  state.results.push({ ...getCurrent(state), accuracy });
  state.currentStep += 1;
  state.finished = state.currentStep >= getSteps(state).length;
}

export function rememberIngredientCuts(state, ingredientId, cutCount) {
  if (!ingredientId || !cutCount) return;
  state.ingredientCuts[ingredientId] = Math.max(1, Math.round(cutCount));
}

export function getIngredientCuts(state, ingredientId, fallback = 3) {
  const n = state.ingredientCuts?.[ingredientId];
  return n != null ? n : fallback;
}

export function calculateResult(state) {
  const base = state.results.reduce((s, r) => s + r.accuracy, 0) / state.results.length;
  const matching = state.results.filter((r) => r.type === state.guest.bonusType);
  const conditionMet = matching.length > 0 && matching.every((r) => r.accuracy >= 70);
  const score = Math.min(100, Math.round(base + (conditionMet ? 5 : 0)));
  const stars = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  return { score, stars, revenue: 300 + stars * 150, conditionMet };
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
  state.ingredientCuts = {};
}
