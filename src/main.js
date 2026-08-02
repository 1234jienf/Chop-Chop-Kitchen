import { MENUS, TYPE_ICON, TYPE_LABEL } from './data.js';
import { AudioMeter } from './audio.js';
import { calculateResult, createGameState, getCurrent, getPlayer, getSteps, startNextDay, submitStep } from './state.js';

const $ = (selector) => document.querySelector(selector);
const state = createGameState();
const audio = new AudioMeter((level) => $('#voiceBar').style.width = `${level}%`);
let micOn = false;

function render() {
  $('#dayLabel').textContent = state.day;
  $('#moneyLabel').textContent = state.money.toLocaleString();
  $('#gradeLabel').textContent = state.grade;
  $('#guestCard').innerHTML = `<span>오늘의 손님</span><strong>${state.guest.name}</strong><p>${state.guest.demand}</p>`;
  $('#courseList').innerHTML = state.menu.courses.map((course) =>
    `<div><span>${course.category}</span><strong>${course.name}</strong></div>`
  ).join('');

  const steps = getSteps(state);
  $('#timeline').innerHTML = steps.map((item, index) => {
    const status = index < state.currentStep ? 'done' : index === state.currentStep && !state.finished ? 'active' : '';
    const owner = ['A', 'B', 'C'][index % 3];
    return `<div class="timeline-item ${status}"><span class="status-dot"></span><div><small>${item.course.name} · ${TYPE_LABEL[item.type]}</small><strong>${item.title}</strong></div><b>셰프 ${owner}</b></div>`;
  }).join('');

  if (state.finished) {
    const result = calculateResult(state);
    $('#stationIcon').textContent = '🍽️';
    $('#stationLabel').textContent = '코스 서빙 완료';
    $('#playerLabel').textContent = '오늘의 영업 종료';
    $('#stepTitle').textContent = `완성도 ${result.score}점`;
    $('#stepHint').textContent = `예상 매출 +${result.revenue}G`;
    $('#reviewPanel').className = 'review';
    $('#reviewPanel').innerHTML = `<div class="stars">${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}</div><blockquote>“${makeReview(result)}”</blockquote><p>손님 요구 ${result.conditionMet ? '충족 +5점' : '미충족'}</p>`;
    $('#nextDayBtn').hidden = false;
    $('#successBtn').disabled = true;
    $('#missBtn').disabled = true;
    return;
  }

  const current = getCurrent(state);
  $('#stationIcon').textContent = TYPE_ICON[current.type];
  $('#stationLabel').textContent = `${current.course.name} / ${TYPE_LABEL[current.type]}`;
  $('#playerLabel').textContent = `${getPlayer(state)} 차례 · ${state.currentStep + 1}/${steps.length}`;
  $('#stepTitle').textContent = current.title;
  $('#stepHint').textContent = `목표 소리 “${current.targetPattern}” — ${current.hint}`;
  $('#reviewPanel').className = 'review empty';
  $('#reviewPanel').textContent = '12개 공정을 마치면 리뷰가 나타납니다.';
  $('#nextDayBtn').hidden = true;
  $('#successBtn').disabled = false;
  $('#missBtn').disabled = false;
}

function makeReview(result) {
  if (result.score >= 85) return '세 셰프의 호흡이 훌륭했다. 오늘의 코스는 다시 찾고 싶은 맛이다.';
  if (result.score >= 65) return '몇 번의 흔들림은 있었지만 각 코스의 개성이 잘 이어졌다.';
  return '재료는 좋았지만 주방의 호흡과 타이밍을 조금 더 맞출 필요가 있다.';
}

MENUS.forEach((menu) => $('#menuSelect').add(new Option(menu.name, menu.id)));
$('#successBtn').addEventListener('click', () => { submitStep(state, 90); render(); });
$('#missBtn').addEventListener('click', () => { submitStep(state, 45); render(); });
$('#nextDayBtn').addEventListener('click', () => { startNextDay(state); render(); });
$('#micBtn').addEventListener('click', async () => {
  try {
    if (micOn) {
      audio.stop(); micOn = false;
      $('#micBtn').textContent = '마이크 켜기';
      $('#micStatus').textContent = '마이크가 꺼졌습니다. 테스트 입력은 계속 사용할 수 있습니다.';
    } else {
      await audio.start(); micOn = true;
      $('#micBtn').textContent = '마이크 끄기';
      $('#micStatus').textContent = '입력 세기만 측정 중입니다. 분류기는 Day 1 작업 영역입니다.';
    }
  } catch (error) {
    $('#micStatus').textContent = `${error.message} HTTPS 또는 localhost에서 실행해 주세요.`;
  }
});

render();
