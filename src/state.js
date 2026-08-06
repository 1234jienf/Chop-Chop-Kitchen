import {
  PLAYERS,
  TYPE_LABEL,
  createStarterMenu,
  createMenuForGuest,
  getGuestLevel,
  pickGuestForLevel,
} from './data.js?v=59';
import { calculateDayResult } from './dayresult.js?v=3';

const flattenSteps = (menu) =>
  menu.courses.flatMap((course) => course.steps.map((process) => ({ ...process, course })));

export function createGameState() {
  // 1단계: 손님을 먼저 선택 (난이도는 day에 따라 결정)
  const day = 1;
  const guestLevel = Math.max(1, Math.min(3, day));
  const guest = pickGuestForLevel(guestLevel);

  // 2단계: 선택된 손님의 bonusType과 난이도를 기반으로 메뉴 생성
  const menu = createMenuForGuest(guest);

  // 3단계: 생성된 메뉴에 맞게 손님의 demand 설정
  const menuText = (menu?.courses || []).map((course) => course.name).filter(Boolean).join(' · ') || '오늘 메뉴';
  const actionText = TYPE_LABEL[guest.bonusType] || guest.bonusType;
  const guestWithDemand = {
    ...guest,
    demand: `${menuText}가 포함된 오늘 코스에서 ${actionText}이(가) 잘 맞으면 보너스!`,
  };

  return {
    day,
    money: 1200,
    grade: '1성',
    menu,
    guest: guestWithDemand,
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
