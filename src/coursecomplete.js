const DISH_ASSETS = {
  '브루스케타': ['에피타이저', '브루스케타.png'],
  '과카몰리': ['에피타이저', '과카몰리.png'],
  '카프레제 샐러드': ['에피타이저', '카프레제_샐러드.png'],
  '카프레제 타르타르': ['에피타이저', '카프레제타르타르.png'],
  '클램 차우더': ['스타터', '클램차우더.png'],
  '미네스트로네': ['스타터', '미네스트로네.png'],
  '프렌치 어니언 수프': ['스타터', '프렌치 어니언 수프.png'],
  '크림 오브 머쉬룸': ['스타터', '크림오브머쉬룸.png'],
  '로스트 치킨': ['메인', '로스트_치킨.png'],
  '미트볼 파스타': ['메인', '미트볼_파스타.png'],
  '스테이크 플레이트': ['메인', '스테이크플레이트.png'],
  '안심 웰링턴': ['메인', '안심_웰링턴.png'],
  '애플 타르트': ['디저트', '애플_타르트.png'],
  '크림 브륄레': ['디저트', '크림브륄레.png'],
  '블루베리 크럼블 케이크': ['디저트', '블루베리_크럼블_케이크.png'],
  '초콜릿 라바케이크': ['디저트', '초콜릿라바케이크.png'],
};

export function completedCourseAt(steps, completedStepIndex) {
  const completed = steps[completedStepIndex];
  if (!completed?.course) return null;
  const next = steps[completedStepIndex + 1];
  return !next || next.course !== completed.course ? completed.course : null;
}

function dishAssetUrl(course) {
  const asset = DISH_ASSETS[course?.name];
  if (!asset) return '';
  return `./src/assets/${asset[0]}/${asset[1]}`;
}

export function createCourseCompleteView() {
  const root = document.createElement('div');
  root.className = 'course-complete';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'courseCompleteTitle');
  root.innerHTML = `
    <div class="course-complete__glow" aria-hidden="true"></div>
    <div class="course-complete__card">
      <p class="course-complete__eyebrow">DISH COMPLETE</p>
      <h2 id="courseCompleteTitle"></h2>
      <p class="course-complete__message">한 접시가 근사하게 완성됐어요!</p>
      <div class="course-complete__plate">
        <img alt="" draggable="false">
      </div>
      <button type="button" class="primary big"></button>
    </div>`;
  document.body.appendChild(root);

  const title = root.querySelector('h2');
  const image = root.querySelector('img');
  const button = root.querySelector('button');
  let continuing = false;
  let onContinue = null;

  const continueToNextCourse = () => {
    if (continuing) return;
    continuing = true;
    button.disabled = true;
    root.classList.add('is-leaving');
    window.setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-visible', 'is-leaving');
      const callback = onContinue;
      onContinue = null;
      continuing = false;
      button.disabled = false;
      callback?.();
    }, 280);
  };

  root.addEventListener('click', (event) => {
    if (event.target.closest('button') === button) continueToNextCourse();
  });

  return {
    show(course, { isLast = false, nextCourse = null, onContinue: callback } = {}) {
      const src = dishAssetUrl(course);
      title.textContent = course.name;
      image.hidden = !src;
      image.src = src;
      image.alt = src ? `완성된 ${course.name}` : '';
      button.textContent = isLast ? '오늘의 결과 보기 →' : `${nextCourse?.name || '다음 요리'} 시작하기 →`;
      onContinue = callback;
      continuing = false;
      button.disabled = false;
      root.hidden = false;
      root.classList.remove('is-leaving');
      requestAnimationFrame(() => root.classList.add('is-visible'));
      button.focus({ preventScroll: true });
    },
  };
}
