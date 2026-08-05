const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function stars(count) {
  return `${'★'.repeat(count)}${'☆'.repeat(5 - count)}`;
}

function reviewFor(reviews, courseName) {
  return reviews?.courses?.find((item) => item.name === courseName)?.review || '심사평을 기다리는 중입니다.';
}

export function renderReceipt(container, result, reviews) {
  const needPlaces = result.needMatches.length
    ? result.needMatches.map((item) => `<li><span>${escapeHtml(item.course)} · ${escapeHtml(item.step)}</span><b>${item.accuracy}점</b></li>`).join('')
    : '<li><span>해당 공정 없음</span><b>—</b></li>';

  container.innerHTML = `
    <article class="day-receipt">
      <header class="receipt-head">
        <p>CHOP CHOP KITCHEN · DAY ${result.day}</p>
        <h2>오늘의 심사 영수증</h2>
        <span>${escapeHtml(result.guest.name)} 손님</span>
      </header>
      <div class="receipt-divider"></div>
      <section class="receipt-courses">
        ${result.courses.map((course, index) => `
          <div class="receipt-course">
            <div class="receipt-course__score"><small>0${index + 1} ${escapeHtml(course.category)}</small><strong>${course.score}</strong><em>점</em></div>
            <div><h3>${escapeHtml(course.name)}</h3><p>“${escapeHtml(reviewFor(reviews, course.name))}”</p></div>
            <b>+${course.revenue.toLocaleString()}G</b>
          </div>`).join('')}
      </section>
      <section class="receipt-need ${result.conditionMet ? 'is-met' : 'is-missed'}">
        <div><small>GUEST REQUEST</small><h3>${escapeHtml(result.guest.demand)}</h3></div>
        <strong>${result.conditionMet ? `충족 · +${result.needBonusScore}점 / 팁 +${result.needBonusRevenue}G` : '미충족'}</strong>
        <ul>${needPlaces}</ul>
      </section>
      <div class="receipt-divider"></div>
      <section class="receipt-total">
        <div><span>코스 평균</span><b>${result.baseScore}점</b></div>
        <div><span>손님 보너스</span><b>+${result.needBonusScore}점</b></div>
        <div class="receipt-total__score"><span>최종 평가</span><b>${result.score}점</b></div>
        <div class="receipt-stars">${stars(result.stars)}</div>
        <blockquote>“${escapeHtml(reviews.final)}”</blockquote>
        <div class="receipt-revenue"><span>오늘 번 돈</span><strong>+${result.revenue.toLocaleString()}G</strong></div>
      </section>
    </article>`;
}

export function renderReceiptLoading(container, result) {
  container.innerHTML = `<article class="day-receipt is-loading"><p>DAY ${result.day} 결산 중</p><h2>${escapeHtml(result.guest.name)} 손님이 심사 중입니다…</h2></article>`;
}
