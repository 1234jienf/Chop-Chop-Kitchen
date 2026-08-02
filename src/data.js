export const PLAYERS = ['셰프 A', '셰프 B', '셰프 C'];
const step = (type, title, targetPattern, hint) => ({ type, title, targetPattern, hint });
export const STARTER_MENU = { id:'starter', name:'시작 추천 4코스', courses:[
  {category:'에피타이저',name:'브루스케타',steps:[step('cut','토마토와 바게트 썰기','탁·탁·탁','균일한 간격으로 리듬을 내세요.'),step('boil','발사믹 글레이즈 졸이기','후~~~~','약한 숨소리를 길게 유지하세요.'),step('grill','바게트 토스트','치이이익','일정한 지속음을 유지하세요.')]},
  {category:'스타터',name:'클램 차우더',steps:[step('cut','감자와 조개 손질','콰직!','강한 한 번의 피크를 만드세요.'),step('boil','수프 끓이기','보글보글','짧은 소리를 불규칙하게 반복하세요.'),step('grill','베이컨 굽기','치이이익','중간 세기의 소리를 유지하세요.')]},
  {category:'메인',name:'스테이크 플레이트',steps:[step('cut','가니쉬 채소 손질','사각사각','중간 속도로 반복하세요.'),step('boil','소스 졸이기','후~~~~','불을 낮추듯 길게 불어주세요.'),step('grill','스테이크 시어링','지금이야!','타이밍에 맞춰 강하게 외치세요.')]},
  {category:'디저트',name:'애플 타르트',steps:[step('cut','사과 슬라이스','스으윽~','낮은 소리를 길게 유지하세요.'),step('boil','캐러멜 소스 졸이기','보글보글','짧은 소리를 여러 번 반복하세요.'),step('grill','타르트 굽기','스으-','약한 소리를 일정하게 유지하세요.')]}]};
export const MENUS=[STARTER_MENU];
export const GUESTS=[{name:'불맛 애호가 민지',demand:'메인의 불맛이 강하면 보너스!',bonusType:'grill'},{name:'섬세한 평론가 서연',demand:'재료가 고르게 손질되면 보너스!',bonusType:'cut'},{name:'소스 장인 지우',demand:'끓이기 공정이 정확하면 보너스!',bonusType:'boil'}];
export const TYPE_LABEL={cut:'자르기',boil:'끓이기',grill:'굽기'};
export const TYPE_ICON={cut:'🔪',boil:'🥘',grill:'🔥'};
