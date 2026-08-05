import {
  PLAYERS,
  createStarterMenu,
  getGuestLevel,
  pickGuestForLevel,
} from './data.js?v=57';
import { calculateDayResult } from './dayresult.js?v=3';

const flattenSteps = (menu) =>
  menu.courses.flatMap((course) => course.steps.map((process) => ({ ...process, course })));

export function createGameState() {
  const menu = createStarterMenu();
  return {
    day: 1,
    money: 1200,
    grade: '1성',
    menu,
    guest: pickGuestForLevel(1, menu),
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
  const boundedAccuracy = Math.max(20, Math.min(100, Math.round(Number(accuracy) || 0)));
  state.results.push({ ...getCurrent(state), accuracy: boundedAccuracy });
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
  return calculateDayResult(state);
}

export function startNextDay(state) {
  const result = calculateResult(state);
  state.day += 1;
  state.money += result.revenue;
  state.grade = state.money >= 3000 ? '2성' : '1성';
  state.guest = pickGuestForLevel(getGuestLevel(state), state.menu);
  state.currentStep = 0;
  state.results = [];
  state.finished = false;
  state.ingredientCuts = {};
}
