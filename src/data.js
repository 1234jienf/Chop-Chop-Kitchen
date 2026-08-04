export const PLAYERS = ['셰프 A', '셰프 B', '셰프 C'];

/** action → 손님 보너스·주방 스테이션 계열 */
export const ACTION_STATION = {
  cutting: 'cut',
  boiling: 'boil',
  roasting: 'grill',
  oven: 'grill',
  putting: 'finish',
  mixing: 'finish',
  sprinkling: 'finish',
};

export const TYPE_LABEL = {
  cut: '자르기',
  boil: '끓이기',
  grill: '굽기',
  finish: '마무리',
};

export const ACTION_LABEL = {
  cutting: '자르기',
  boiling: '끓이기',
  roasting: '굽기',
  oven: '오븐 굽기',
  putting: '뿌리기·붓기',
  mixing: '섞기',
  sprinkling: '뿌리기',
};

export const TYPE_ICON = {
  cut: '🔪',
  boil: '🥘',
  grill: '🔥',
  finish: '✨',
};

/** 재료 id → 에셋 파일명 (없으면 null) */
export const INGREDIENT_ASSETS = {
  tomatoes: '토마토.png',
  baguette: '바게트.png',
  'olive oil': null,
  potato: '감자.png',
  clam: '조개.png',
  asparagus: '아스파라거스.png',
  'cherry tomato': '토마토.png',
  steak: '고기.png',
  sauce: null,
  apple: '사과.png',
  tart: '사과.png',
  caramel: null,
  mozzarella: '모짜렐라.png',
  onion: '양파.png',
  mushroom: '마늘.png',
  bacon: '베이컨.png',
  banana: '바나나.png',
  chocolate: '초콜릿.png',
  garlic: '마늘.png',
  garnish: '가니쉬.png',
  crouton: '크루통.png',
};

export const INGREDIENT_LABEL = {
  tomatoes: '토마토',
  baguette: '바게트',
  'olive oil': '올리브오일',
  potato: '감자',
  clam: '조개',
  asparagus: '아스파라거스',
  'cherry tomato': '방울토마토',
  steak: '스테이크',
  sauce: '소스',
  apple: '사과',
  tart: '타르트',
  caramel: '캐러멜',
  mozzarella: '모짜렐라',
  onion: '양파',
  mushroom: '버섯',
  bacon: '베이컨',
  banana: '바나나',
  chocolate: '초콜릿',
  garlic: '마늘',
  garnish: '가니쉬',
  crouton: '크루통',
};

/**
 * @param {'cutting'|'boiling'|'roasting'|'putting'|'mixing'|'sprinkling'} action
 * @param {string[]} ingredients
 * @param {{ title?: string, targetPattern: string, hint: string }} meta
 */
export function step(action, ingredients, meta) {
  const list = Array.isArray(ingredients) ? ingredients : [ingredients];
  const label = list.map((id) => INGREDIENT_LABEL[id] || id).join('·');
  const obj = {
    action,
    ingredients: list,
    type: ACTION_STATION[action] || 'cut',
    title: meta.title || `${label} ${ACTION_LABEL[action] || action}`,
    targetPattern: meta.targetPattern,
    hint: meta.hint,
  };

  // 오븐 전용: 재료 파일을 ./src/assets/오븐/에서 우선 찾도록 하는 필드 추가
  if (action === 'oven') {
    // ingredients 배열에는 사용자가 파일명(예: tart.png) 또는 기존 id(tart) 중 하나를 넣을 수 있음
    // 파일명이 명시되어 있으면 그대로 사용하고, 그렇지 않으면 INGREDIENT_ASSETS 매핑을 참조
    obj.ovenFiles = list.map((id) => {
      if (typeof id === 'string' && id.includes('.')) return id; // 파일명으로 전달됨
      const mapped = INGREDIENT_ASSETS[id];
      if (mapped) return mapped;
      // fallback: id 기반 파일명
      return `${id}.png`;
    });

    // n_a, n_b 같은 오븐 전용 타이머를 meta로 전달할 수 있도록 유지
    if (meta?.ovenVisualDuration) obj.ovenVisualDuration = meta.ovenVisualDuration;
    if (meta?.ovenAcceptWindow) obj.ovenAcceptWindow = meta.ovenAcceptWindow;
  }

  return obj;
}

/** 도감 전체 (확장 레시피) */
export const RECIPE_CATALOG = [
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Bruschetta',
    nameKo: '브루스케타',
    level: 'normal',
    steps: [
      step('cutting', ['tomatoes'], { targetPattern: '탁·탁·탁', hint: '균일한 간격으로 리듬을 내세요.' }),
      step('cutting', ['baguette'], { targetPattern: '콰직!', hint: '강한 한 번의 피크로 썰어요.' }),
      step('roasting', ['baguette'], { targetPattern: '치이이익', hint: '일정한 지속음을 유지하세요.' }),
      step('putting', ['olive oil'], { targetPattern: '스으-', hint: '약하게 뿌리듯 짧게 내세요.' }),
    ],
  },
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Guacamole',
    nameKo: '과카몰리',
    level: 'easy',
    steps: [
      step('cutting', ['tomatoes'], { title: '아보카도 다지기', targetPattern: '찹찹찹찹', hint: '짧은 피크를 빠르게 반복하세요.' }),
      step('cutting', ['onion'], { targetPattern: '사각사각', hint: '중간 속도로 반복하세요.' }),
      step('mixing', ['tomatoes'], { title: '재료 으깨 섞기', targetPattern: '보글보글', hint: '짧은 소리를 불규칙하게 반복하세요.' }),
    ],
  },
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Caprese Tartare',
    nameKo: '카프레제 타르타르',
    level: 'hard',
    steps: [
      step('cutting', ['tomatoes'], { targetPattern: '찹찹찹찹', hint: '잘게 다지듯 빠르게.' }),
      step('cutting', ['mozzarella'], { targetPattern: '찹찹찹찹', hint: '모짜렐라도 같은 리듬으로.' }),
      step('roasting', ['baguette'], { title: '빵칩 굽기', targetPattern: '치이이익', hint: '지속음으로 굽기.' }),
      step('boiling', ['sauce'], { title: '발사믹 리덕션', targetPattern: '후~~~~', hint: '길게 불어 화력을 낮추세요.' }),
      step('mixing', ['tomatoes'], { title: '재료 섞기', targetPattern: '보글보글', hint: '짧게 섞는 소리.' }),
      step('putting', ['sauce'], { title: '발사믹 소스 붓기', targetPattern: '스으-', hint: '약하게 붓듯이.' }),
    ],
  },
  {
    category: 'starter',
    categoryLabel: '스타터',
    name: 'Clam Chowder',
    nameKo: '클램 차우더',
    level: 'easy',
    steps: [
      step('cutting', ['potato'], { targetPattern: '탁·탁·탁', hint: '감자를 일정하게 썰어요.' }),
      step('cutting', ['clam'], { targetPattern: '콰직!', hint: '조개를 한 번에 손질.' }),
      step('boiling', ['clam', 'potato'], { title: '수프 끓이기', targetPattern: '보글보글', hint: '짧은 소리를 불규칙하게 반복하세요.' }),
    ],
  },
  {
    category: 'starter',
    categoryLabel: '스타터',
    name: 'Minestrone',
    nameKo: '미네스트로네',
    level: 'normal',
    steps: [
      step('cutting', ['potato'], { title: '당근 썰기', targetPattern: '사각사각', hint: '채썰기 리듬.' }),
      step('cutting', ['onion'], { title: '샐러리 썰기', targetPattern: '탁·탁·탁', hint: '일정하게.' }),
      step('boiling', ['potato'], { title: '수프 끓이기', targetPattern: '보글보글', hint: '보글보글 유지.' }),
      step('mixing', ['potato'], { title: '재료 섞기', targetPattern: '후루룩', hint: '빠르게 2~3회.' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Steak Plate',
    nameKo: '스테이크 플레이트',
    level: 'normal',
    steps: [
      step('cutting', ['asparagus'], { targetPattern: '스으윽~', hint: '낮은 소리를 길게.' }),
      step('cutting', ['cherry tomato'], { targetPattern: '탁·탁·탁', hint: '방울토마토를 일정하게.' }),
      step('roasting', ['steak'], { targetPattern: '지금이야!', hint: '타이밍에 맞춰 강하게 외치세요.' }),
      step('boiling', ['sauce'], { title: '소스 졸이기', targetPattern: '후~~~~', hint: '불을 낮추듯 길게.' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Salmon Steak',
    nameKo: '연어 스테이크',
    level: 'normal',
    steps: [
      step('cutting', ['garnish'], { title: '연어·야채 손질', targetPattern: '스으윽~', hint: '얇게 슬라이스.' }),
      step('boiling', ['sauce'], { title: '버터소스 만들기', targetPattern: '보글보글', hint: '농도 유지.' }),
      step('roasting', ['steak'], { title: '연어 스킨 바삭하게', targetPattern: '치이이익', hint: '지속음으로 시어링.' }),
    ],
  },
  {
    category: 'dessert',
    categoryLabel: '디저트',
    name: 'Apple Tart',
    nameKo: '애플 타르트',
    level: 'easy',
    steps: [
      step('cutting', ['apple'], { targetPattern: '스으윽~', hint: '낮은 소리를 길게 유지하세요.' }),
      step('oven', ['타르트반죽_오븐'], { title: '타르트 굽기', targetPattern: '스으-', hint: '약한 소리를 일정하게.' }),
      step('boiling', ['caramel'], { title: '캐러멜 소스 졸이기', targetPattern: '보글보글', hint: '짧은 소리를 여러 번.' }),
    ],
  },
  {
    category: 'dessert',
    categoryLabel: '디저트',
    name: 'Banana Parfait',
    nameKo: '구운 바나나 파르페',
    level: 'normal',
    steps: [
      step('cutting', ['banana'], { targetPattern: '스으윽~', hint: '얇게 슬라이스.' }),
      step('roasting', ['banana'], { title: '바나나 토치', targetPattern: '치이이익', hint: '지속음.' }),
      step('boiling', ['caramel'], { title: '캐러멜소스 졸이기', targetPattern: '보글보글', hint: '보글보글.' }),
      step('putting', ['chocolate'], { title: '초코 시럽 뿌리기', targetPattern: '스으-', hint: '약하게.' }),
    ],
  },
];

const byKo = (nameKo) => RECIPE_CATALOG.find((r) => r.nameKo === nameKo);

/** UI·상태에 쓰는 코스 형태 (한국어 표시명 기준) */
function toCourse(recipe) {
  return {
    category: recipe.categoryLabel,
    categoryId: recipe.category,
    name: recipe.nameKo,
    nameEn: recipe.name,
    level: recipe.level,
    steps: recipe.steps,
  };
}

/** 시작 추천: 브루스케타 + 클램 차우더 + 스테이크 + 애플 타르트 */
export const STARTER_MENU = {
  id: 'starter',
  name: '시작 추천 4코스',
  courses: [
    toCourse(byKo('브루스케타')),
    toCourse(byKo('클램 차우더')),
    toCourse(byKo('스테이크 플레이트')),
    toCourse(byKo('애플 타르트')),
  ],
};

export const MENUS = [STARTER_MENU];

export const GUESTS = [
  { name: '불맛 애호가 민지', demand: '메인의 불맛이 강하면 보너스!', bonusType: 'grill' },
  { name: '섬세한 평론가 서연', demand: '재료가 고르게 손질되면 보너스!', bonusType: 'cut' },
  { name: '소스 장인 지우', demand: '끓이기 공정이 정확하면 보너스!', bonusType: 'boil' },
];

export function ingredientAsset(ingredientId) {
  return INGREDIENT_ASSETS[ingredientId] || null;
}

export function primaryIngredient(stepData) {
  return stepData.ingredients?.[0] || null;
}
