import { TYPE_ICON, TYPE_LABEL } from './data.js';
import { AudioMeter } from './audio.js';
import { calculateResult, createGameState, getCurrent, getPlayer, getSteps, startNextDay, submitStep } from './state.js';

const $=(s)=>document.querySelector(s);
const state=createGameState();
const audio=new AudioMeter(level=>$('#voiceBar').style.width=`${level}%`);
let micOn=false;

function showScreen(name){
  document.querySelectorAll('.screen').forEach(screen=>screen.classList.toggle('active',screen.dataset.screen===name));
  window.scrollTo(0,0);
}

function renderPlayers(){
  $('#playerSetup').innerHTML=state.players.map((player,index)=>`<article class="player-card"><div class="move-buttons"><button data-move="${index}" data-dir="-1" ${index===0?'disabled':''} aria-label="앞 순서로">←</button><button data-move="${index}" data-dir="1" ${index===2?'disabled':''} aria-label="뒤 순서로">→</button></div><span class="order-number">${index+1}</span><div class="chef-avatar">${['👩‍🍳','🧑‍🍳','👨‍🍳'][index]}</div><label>PLAYER ${index+1}<input data-player="${index}" value="${player}" maxlength="12" aria-label="${index+1}번 플레이어 이름"></label></article>`).join('');
}

function renderGame(){
  $('#dayLabel').textContent=state.day; $('#moneyLabel').textContent=`${state.money.toLocaleString()}G`; $('#gradeLabel').textContent=state.grade;
  $('#guestCard').innerHTML=`<span>오늘의 손님</span><strong>${state.guest.name}</strong><p>${state.guest.demand}</p>`;
  $('#courseList').innerHTML=state.menu.courses.map((c,i)=>`<div class="course-item"><span>0${i+1} · ${c.category}</span><b>${c.name}</b></div>`).join('');
  const steps=getSteps(state);
  $('#timeline').innerHTML=steps.map((item,index)=>{const status=index<state.currentStep?'done':index===state.currentStep?'active':'';return `<div class="timeline-item ${status}"><i class="dot"></i><div><small>${item.course.name} · ${TYPE_LABEL[item.type]}</small><b>${item.title}</b></div><em>${state.players[index%3]}</em></div>`}).join('');
  if(state.finished){renderResult();showScreen('result');return;}
  const current=getCurrent(state);
  $('#stationIcon').textContent=TYPE_ICON[current.type]; $('#stationLabel').textContent=`${current.course.name} / ${TYPE_LABEL[current.type]}`;
  $('#playerLabel').textContent=`${getPlayer(state)}의 차례`; $('#stepTitle').textContent=current.title; $('#stepHint').textContent=`목표 소리 “${current.targetPattern}” · ${current.hint}`; $('#stepCount').textContent=`${state.currentStep+1} / ${steps.length}`;
}

function renderResult(){
  const result=calculateResult(state); const review=result.score>=85?'셰프들의 호흡이 훌륭했습니다. 각 코스의 개성이 살아 있는 멋진 저녁이었어요.':result.score>=65?'조금 흔들린 순간도 있었지만, 팀워크가 돋보이는 기분 좋은 코스였습니다.':'재료는 좋았지만 주방의 호흡을 조금 더 맞추면 훨씬 근사해질 것 같아요.';
  $('#reviewPanel').innerHTML=`<div class="stars">${'★'.repeat(result.stars)}${'☆'.repeat(5-result.stars)}</div><h2>${result.score}점</h2><blockquote>“${review}”</blockquote><p class="muted">손님 요구 ${result.conditionMet?'충족 · 보너스 +5점':'미충족'} · 오늘의 매출 +${result.revenue}G</p>`;
}

document.addEventListener('click',(event)=>{
  const go=event.target.closest('[data-go]'); if(go){showScreen(go.dataset.go);return;}
  const move=event.target.closest('[data-move]'); if(move){const from=Number(move.dataset.move),to=from+Number(move.dataset.dir);[state.players[from],state.players[to]]=[state.players[to],state.players[from]];renderPlayers();}
});
$('#playerSetup').addEventListener('input',event=>{if(event.target.matches('[data-player]'))state.players[Number(event.target.dataset.player)]=event.target.value.trim()||`셰프 ${Number(event.target.dataset.player)+1}`;});
$('#confirmTeamBtn').addEventListener('click',()=>{renderGame();showScreen('game');});
$('#successBtn').addEventListener('click',()=>{submitStep(state,90);renderGame();});
$('#missBtn').addEventListener('click',()=>{submitStep(state,45);renderGame();});
$('#nextDayBtn').addEventListener('click',()=>{startNextDay(state);renderGame();showScreen('game');});
$('#micBtn').addEventListener('click',async()=>{try{if(micOn){audio.stop();micOn=false;$('#micBtn').textContent='마이크 켜기';$('#micStatus').textContent='마이크가 꺼졌습니다.';}else{await audio.start();micOn=true;$('#micBtn').textContent='마이크 끄기';$('#micStatus').textContent='입력 세기를 측정하고 있습니다.';}}catch(error){$('#micStatus').textContent=`${error.message} HTTPS 또는 localhost에서 실행해 주세요.`;}});

renderPlayers();
