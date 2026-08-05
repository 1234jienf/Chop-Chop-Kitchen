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
  mix: '섞기',
  sprinklePour: '뿌리기·붓기',
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
  mix: '🥣',
  sprinklePour: '✨',
};

const MENU_CATEGORIES = ['appetizer', 'starter', 'main', 'dessert'];

const randomItem = (items, random = Math.random) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(random() * items.length)];
};

/** 재료 id → 에셋 파일명 (없으면 null) */
export const INGREDIENT_ASSETS = {
  tomatoes: '토마토.png',
  avocado: '아보카도.png',
  baguette: '바게트.png',
  'olive oil': null,
  potato: '감자.png',
  carrot: '당근.png',
  celery: '샐러리.png',
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
  sugar: null,
  parsley: '파슬리.png',
  basil: null,
  chicken: '닭고기.png',
  beef: '고기.png',
  meatball: '고기.png',
  pasta: null,
  pastry: null,
  vanilla: '바닐라빈.png',
  butter: '버터.png',
  blueberry: null,
  flour: null,
  garlic: '마늘.png',
  garnish: '가니쉬.png',
  crouton: '크루통.png',
  // Oven-specific ingredients (files in ./src/assets/오븐/)
  '타르트반죽_오븐': '타르트반죽_오븐.png',
  '라바케이크_오븐': '라바케이크_오븐.png',
  '치킨_오븐': '치킨_오븐.png',
  '블루베리크럼블_오븐': '블루베리크럼블_오븐.png',
  '페이스트리_오븐': '페이스트리_오븐.png',
};

export const INGREDIENT_LABEL = {
  tomatoes: '토마토',
  avocado: '아보카도',
  baguette: '바게트',
  'olive oil': '올리브오일',
  potato: '감자',
  carrot: '당근',
  celery: '샐러리',
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
  sugar: '슈가파우더',
  parsley: '파슬리',
  basil: '바질',
  chicken: '닭고기',
  beef: '소고기',
  meatball: '미트볼',
  pasta: '파스타',
  pastry: '페이스트리',
  vanilla: '바닐라빈',
  butter: '버터',
  blueberry: '블루베리',
  flour: '밀가루',
  garlic: '마늘',
  garnish: '가니쉬',
  crouton: '크루통',
};

/**
 * @param {'cutting'|'boiling'|'roasting'|'putting'|'mixing'|'sprinkling'|'oven'} action
 * @param {string[]} ingredients
 * @param {{ title?: string, targetPattern: string, hint: string, mixingAsset?: string, boilAsset?: string, ovenFiles?: string[], ovenTargetTime?: number, ovenVisualDuration?: number, ovenAcceptWindow?: number }} meta
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
    targetPitch: meta.targetPitch,
    targetPitches: meta.targetPitches,
    targetNotes: meta.targetNotes,
    toleranceCents: meta.toleranceCents,
    holdSeconds: meta.holdSeconds,
    reachSeconds: meta.reachSeconds,
    sprinklePourKind: meta.sprinklePourKind,
    sprinklePourAsset: meta.sprinklePourAsset,
    mixingAsset: meta.mixingAsset,
    boilAsset: meta.boilAsset,
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
    if (meta?.ovenTargetTime) obj.ovenTargetTime = meta.ovenTargetTime;
    if (meta?.ovenAcceptWindow) obj.ovenAcceptWindow = meta.ovenAcceptWindow;
  }

  return obj;
}

/** 도감 전체 (확장 레시피) */
export const RECIPE_CATALOG = [
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Guacamole',
    nameKo: '과카몰리',
    level: 'easy',
    steps: [
      step('cutting', ['avocado'], { title: '아보카도 다지기', targetPattern: '찹찹찹찹', hint: '짧은 피크를 빠르게 반복하세요.' }),
      step('cutting', ['onion'], { title: '양파 썰기', targetPattern: '사각사각', hint: '중간 속도로 반복하세요.' }),
      step('mixing', ['avocado', 'onion'], { title: '재료 으깨 섞기', targetPattern: '보글보글', mixingAsset: '과카몰리_보울안', hint: '짧은 소리를 불규칙하게 반복하세요.' }),
    ],
  },
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Bruschetta',
    nameKo: '브루스케타',
    level: 'normal',
    steps: [
      step('cutting', ['tomatoes'], { title: '토마토 썰기', targetPattern: '탁·탁·탁', hint: '균일한 간격으로 리듬을 내세요.' }),
      step('cutting', ['baguette'], { title: '바게트 썰기', targetPattern: '콰직!', hint: '강한 한 번의 피크로 썰어요.' }),
      step('roasting', ['baguette'], { title: '바게트 토스트', targetPattern: '치이이익', hint: '일정한 지속음을 유지하세요.' }),
      step('putting', ['basil', 'olive oil'], { title: '바질·올리브오일 뿌리기', targetPattern: '라(A3)', targetPitch: 220, toleranceCents: 90, holdSeconds: 2, sprinklePourKind: 'liquid', sprinklePourAsset: '올리브', hint: '목표 음을 2초간 유지하세요.' }),
    ],
  },
  {
    category: 'appetizer',
    categoryLabel: '에피타이저',
    name: 'Caprese Tartare',
    nameKo: '카프레제 타르타르',
    level: 'hard',
    steps: [
      step('cutting', ['tomatoes'], { title: '토마토 다지기', targetPattern: '찹찹찹찹', hint: '잘게 다지듯 빠르게.' }),
      step('cutting', ['mozzarella'], { title: '모짜렐라 다지기', targetPattern: '찹찹찹찹', hint: '모짜렐라도 같은 리듬으로.' }),
      step('roasting', ['baguette'], { title: '빵칩 굽기', targetPattern: '치이이익', hint: '지속음으로 굽기.' }),
      step('boiling', ['sauce'], { title: '발사믹 리덕션', targetPattern: '후~~~~', hint: '길게 불어 화력을 낮추세요.', boilAsset: '카프레제 타르타르_1.png' }),
      step('mixing', ['타르타르_보울안'], { title: '재료 섞기', targetPattern: '보글보글', mixingAsset: '타르타르_보울안', hint: '짧게 섞는 소리.' }),
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
      step('cutting', ['potato'], { title: '감자 썰기', targetPattern: '탁·탁·탁', hint: '감자를 일정하게 썰어요.' }),
      step('cutting', ['clam'], { title: '조개 손질', targetPattern: '콰직!', hint: '조개를 한 번에 손질.' }),
      step('boiling', ['clam', 'potato'], { title: '수프 끓이기', targetPattern: '보글보글', hint: '짧은 소리를 불규칙하게 반복하세요.', boilAsset: '클램 차우더_1.png' }),
    ],
  },
  {
    category: 'starter',
    categoryLabel: '스타터',
    name: 'Minestrone',
    nameKo: '미네스트로네',
    level: 'normal',
    steps: [
      step('cutting', ['carrot'], { title: '당근 썰기', targetPattern: '사각사각', hint: '채썰기 리듬.' }),
      step('cutting', ['celery'], { title: '샐러리 썰기', targetPattern: '탁·탁·탁', hint: '일정하게.' }),
      step('boiling', ['carrot', 'celery'], { title: '수프 끓이기', targetPattern: '보글보글', hint: '보글보글 유지.', boilAsset: '미네스트로네_1.png' }),
      step('mixing', ['미네스트로네_보울안'], { title: '재료 섞기', targetPattern: '후루룩', mixingAsset: '미네스트로네_보울안', hint: '빠르게 2~3회.' }),
    ],
  },
  {
    category: 'starter',
    categoryLabel: '스타터',
    name: 'French Onion Soup',
    nameKo: '프렌치 어니언 수프',
    level: 'normal',
    steps: [
      step('cutting', ['onion'], { title: '양파 슬라이스', targetPattern: '스으윽~', hint: '얇고 길게 썰어요.' }),
      step('cutting', ['parsley'], { title: '파슬리 썰기', targetPattern: '찹찹찹찹', hint: '잘게 다지세요.' }),
      step('roasting', ['crouton'], { title: '치즈 크루통 굽기', targetPattern: '치이이익', hint: '노릇하게 구우세요.' }),
      step('boiling', ['onion'], { title: '수프 끓이기', targetPattern: '보글보글', hint: '농도를 유지하세요.', boilAsset: '프렌치 어니언 수프_1.png' }),
    ],
  },
  {
    category: 'starter',
    categoryLabel: '스타터',
    name: 'Cream of Mushroom',
    nameKo: '크림 오브 머쉬룸',
    level: 'hard',
    steps: [
      step('cutting', ['mushroom'], { title: '버섯 썰기', targetPattern: '사각사각', hint: '고르게 썰어요.' }),
      step('cutting', ['onion'], { title: '양파 썰기', targetPattern: '탁·탁·탁', hint: '일정하게 썰어요.' }),
      step('roasting', ['crouton'], { title: '크루통 굽기', targetPattern: '치이이익', hint: '바삭하게 구우세요.' }),
      step('boiling', ['mushroom'], { title: '크림수프 끓이기', targetPattern: '보글보글', hint: '부드럽게 끓이세요.', boilAsset: '크림 브륄레_1.png' }),
      step('mixing', ['mushroom'], { title: '크림 섞기', targetPattern: '후루룩', mixingAsset: '크림_보울안', hint: '부드럽게 섞으세요.' }),
      step('sprinkling', ['parsley'], { title: '파슬리 뿌리기', targetPattern: '도(C4)', targetPitch: 261.63, toleranceCents: 90, holdSeconds: 2, sprinklePourKind: 'powder', sprinklePourAsset: '파슬리', hint: '목표 음을 2초간 유지하세요.' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Roast Chicken',
    nameKo: '로스트 치킨',
    level: 'easy',
    steps: [
      step('cutting', ['chicken'], { title: '닭 자르기', targetPattern: '콰직!', hint: '힘 있게 손질하세요.' }),
      step('oven', ['치킨_오븐'], { title: '치킨 오븐구이', targetPattern: '치이이익', hint: '속까지 익히세요.' }),
      step('boiling', ['sauce'], { title: '그레이비 소스 졸이기', targetPattern: '후~~~~', hint: '천천히 졸이세요.', boilAsset: '스테이크 플레이트_1.png' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Meatball Pasta',
    nameKo: '미트볼 파스타',
    level: 'easy',
    steps: [
      step('cutting', ['onion'], { title: '양파 자르기', targetPattern: '탁·탁·탁', hint: '일정하게 썰어요.' }),
      step('roasting', ['meatball'], { title: '미트볼 시어링', targetPattern: '치이이익', hint: '겉면을 노릇하게 구우세요.' }),
      step('boiling', ['pasta'], { title: '토마토소스+파스타 끓이기', targetPattern: '보글보글', hint: '고르게 끓이세요.', boilAsset: '미트볼 파스타_1.png' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Steak Plate',
    nameKo: '스테이크 플레이트',
    level: 'normal',
    steps: [
      step('cutting', ['asparagus'], { title: '아스파라거스 손질', targetPattern: '스으윽~', hint: '낮은 소리를 길게.' }),
      step('cutting', ['cherry tomato'], { title: '방울토마토 손질', targetPattern: '탁·탁·탁', hint: '방울토마토를 일정하게.' }),
      step('roasting', ['steak'], { title: '스테이크 시어링', targetPattern: '지금이야!', hint: '타이밍에 맞춰 강하게 외치세요.' }),
      step('boiling', ['sauce'], { title: '소스 졸이기', targetPattern: '후~~~~', hint: '불을 낮추듯 길게.', boilAsset: '스테이크 플레이트_1.png' }),
    ],
  },
  {
    category: 'main',
    categoryLabel: '메인',
    name: 'Beef Wellington',
    nameKo: '안심 웰링턴',
    level: 'hard',
    steps: [
      step('cutting', ['beef'], { title: '소고기 손질', targetPattern: '스으윽~', hint: '결을 따라 손질하세요.' }),
      step('cutting', ['mushroom'], { title: '양송이 버섯 다지기', targetPattern: '찹찹찹찹', hint: '잘게 다지세요.' }),
      step('oven', ['페이스트리_오븐'], { title: '페이스트리 굽기', targetPattern: '치이이익', hint: '바삭하게 구우세요.' }),
      step('boiling', ['sauce'], { title: '소스 졸이기', targetPattern: '후~~~~', hint: '천천히 졸이세요.', boilAsset: '안심 웰링턴_1.png' }),
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
      step('boiling', ['caramel'], { title: '캐러멜 소스 졸이기', targetPattern: '보글보글', hint: '짧은 소리를 여러 번.', boilAsset: '애플 타르트_1.png' }),
    ],
  },
  {
    category: 'dessert',
    categoryLabel: '디저트',
    name: 'Crème Brûlée',
    nameKo: '크림 브륄레',
    level: 'normal',
    steps: [
      step('cutting', ['vanilla'], { title: '바닐라빈 껍질 자르기', targetPattern: '스으윽~', hint: '얇게 갈라 주세요.' }),
      step('roasting', ['sugar'], { title: '커스터드 중탕 굽기', targetPattern: '스으-', hint: '약한 열을 유지하세요.' }),
      step('mixing', ['flour'], { title: '달걀과 생크림 섞기', targetPattern: '후루룩', mixingAsset: '달걀과생크림_보울안', hint: '부드럽게 섞으세요.' }),
      step('sprinkling', ['sugar'], { title: '표면에 설탕 뿌리기', targetPattern: '미(E4)', targetPitch: 329.63, toleranceCents: 90, holdSeconds: 2, sprinklePourKind: 'powder', sprinklePourAsset: '설탕', hint: '목표 음을 2초간 유지하세요.' }),
    ],
  },
  {
    category: 'dessert',
    categoryLabel: '디저트',
    name: 'Blueberry Crumble Cake',
    nameKo: '블루베리 크럼블 케이크',
    level: 'normal',
    steps: [
      step('cutting', ['butter'], { title: '버터 조각내기', targetPattern: '탁·탁·탁', hint: '고르게 조각내세요.' }),
      step('oven', ['블루베리크럼블_오븐'], { title: '오븐에서 굽기', targetPattern: '치이이익', hint: '노릇하게 구우세요.' }),
      step('boiling', ['blueberry'], { title: '블루베리 잼 끓이기', targetPattern: '보글보글', hint: '농도를 유지하세요.', boilAsset: '블루베리 크럼블 케이크_1.png' }),
      step('mixing', ['flour'], { title: '크럼블 반죽 섞기', targetPattern: '후루룩', mixingAsset: '크럼블반죽_보울안', hint: '고슬고슬하게 섞으세요.' }),
    ],
  },
  {
    category: 'dessert',
    categoryLabel: '디저트',
    name: 'Chocolate Lava Cake',
    nameKo: '초콜릿 라바케이크',
    level: 'hard',
    steps: [
      step('cutting', ['chocolate'], { title: '다크 초콜릿 조각내기', targetPattern: '콰직!', hint: '작은 조각으로 나누세요.' }),
      step('oven', ['라바케이크_오븐'], { title: '라바 케이크 오븐 굽기', targetPattern: '치이이익', hint: '가운데는 촉촉하게 구우세요.' }),
      step('boiling', ['butter', 'chocolate'], { title: '버터와 초콜릿 중탕 끓이기', targetPattern: '보글보글', hint: '천천히 녹이세요.', boilAsset: '초콜릿 라바케이크_1.png' }),
      step('mixing', ['flour'], { title: '달걀과 밀가루 반죽 섞기', targetPattern: '후루룩', mixingAsset: '달걀과밀가루_보울안', hint: '덩어리 없이 섞으세요.' }),
      step('sprinkling', ['sugar'], { title: '슈가파우더 뿌리기', targetPattern: '라(A3)', targetPitch: 220, toleranceCents: 90, holdSeconds: 2, sprinklePourKind: 'powder', sprinklePourAsset: '슈가파우더', hint: '목표 음을 2초간 유지하세요.' }),
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

/** 시작 추천: 브루스케타 + 미네스트로네 + 스테이크 + 애플 타르트 */
export function createStarterMenu() {
  return {
    id: 'starter',
    name: '시작 추천 4코스',
    courses: [
      toCourse(byKo('브루스케타')),
      toCourse(byKo('미네스트로네')),
      toCourse(byKo('스테이크 플레이트')),
      toCourse(byKo('애플 타르트')),
    ],
  };
}

/** bonusType에 해당하는 step action 반환 */
function bonusTypeToAction(bonusType) {
  const map = {
    'cut': 'cutting',
    'grill': 'roasting',
    'boil': 'boiling',
    'mix': 'mixing',
    'sprinklePour': 'sprinkling',
  };
  return map[bonusType] || null;
}

/** 게스트의 bonusType과 난이도를 기반으로 메뉴 생성 */
export function createMenuForGuest(guest, random = Math.random) {
  const targetAction = bonusTypeToAction(guest.bonusType);
  const guestLevel = guest.level; // 1, 2, 3

  // 게스트 난이도에 맞는 음식 레벨
  const levelMap = { 1: 'easy', 2: 'normal', 3: 'hard' };
  const targetRecipeLevel = levelMap[guestLevel];

  // 카테고리 순서
  const categoryOrder = ['appetizer', 'starter', 'main', 'dessert'];
  const courses = [];

  for (const category of categoryOrder) {
    // 각 카테고리에서 bonusType과 난이도에 맞는 음식 필터링
    let categoryRecipes = RECIPE_CATALOG.filter(
      (recipe) =>
        recipe.category === category &&
        recipe.level === targetRecipeLevel &&
        recipe.steps.some((s) => s.action === targetAction)
    );

    // 난이도에 맞는 음식이 없으면 같은 카테고리의 모든 음식 사용
    if (categoryRecipes.length === 0) {
      categoryRecipes = RECIPE_CATALOG.filter(
        (recipe) =>
          recipe.category === category &&
          recipe.steps.some((s) => s.action === targetAction)
      );
    }

    // 그래도 없으면 같은 카테고리의 모든 음식 (보너스 타입 상관없이)
    if (categoryRecipes.length === 0) {
      categoryRecipes = RECIPE_CATALOG.filter(
        (recipe) => recipe.category === category
      );
    }

    // 랜덤으로 하나 선택
    if (categoryRecipes.length > 0) {
      const randomRecipe =
        categoryRecipes[Math.floor(random() * categoryRecipes.length)];
      courses.push(toCourse(randomRecipe));
    }
  }

  // 코스가 4개 미만이면 기본 메뉴 반환
  if (courses.length < 4) {
    return createStarterMenu();
  }

  return {
    id: 'dynamic',
    name: `${guest.bonusType} 메뉴`,
    courses,
  };
}

export const STARTER_MENU = createStarterMenu();
export const MENUS = [STARTER_MENU];

export const GUESTS = [
  { name: '칼끝이 정밀한 민지', demand: `${ACTION_LABEL.cutting} 공정이 정확하면 보너스!`, bonusType: 'cut', level: 1 },
  { name: '리듬을 잘 타는 서연', demand: `${ACTION_LABEL.cutting} 공정의 호흡이 안정적이면 보너스!`, bonusType: 'cut', level: 2 },
  { name: '칼질 마스터 지우', demand: `${ACTION_LABEL.cutting} 공정이 아주 정교하면 보너스!`, bonusType: 'cut', level: 3 },

  { name: '불향을 좋아하는 민호', demand: `${ACTION_LABEL.roasting} 공정이 고르게 맞으면 보너스!`, bonusType: 'grill', level: 1 },
  { name: '향을 맡는 서진', demand: `${ACTION_LABEL.roasting} 공정의 타이밍이 좋으면 보너스!`, bonusType: 'grill', level: 2 },
  { name: '불맛 감별사 태우', demand: `${ACTION_LABEL.roasting} 공정이 완벽하면 보너스!`, bonusType: 'grill', level: 3 },

  { name: '끓임을 즐기는 지우', demand: `${ACTION_LABEL.boiling} 공정이 정확하면 보너스!`, bonusType: 'boil', level: 1 },
  { name: '온도에 예민한 나연', demand: `${ACTION_LABEL.boiling} 공정의 유지력이 좋으면 보너스!`, bonusType: 'boil', level: 2 },
  { name: '보글 마스터 현우', demand: `${ACTION_LABEL.boiling} 공정이 안정적이면 보너스!`, bonusType: 'boil', level: 3 },

  { name: '부드럽게 섞는 수아', demand: `${ACTION_LABEL.mixing} 공정이 고르게 맞으면 보너스!`, bonusType: 'mix', level: 1 },
  { name: '대본을 잘 읽는 유진', demand: `${ACTION_LABEL.mixing} 공정의 리듬이 좋으면 보너스!`, bonusType: 'mix', level: 2 },
  { name: '한번에 섞는 민석', demand: `${ACTION_LABEL.mixing} 공정이 아주 정확하면 보너스!`, bonusType: 'mix', level: 3 },
  
  { name: '가볍게 뿌리는 하린', demand: `${ACTION_LABEL.sprinkling} 공정이 깔끔하면 보너스!`, bonusType: 'sprinklePour', level: 1 },
  { name: '정확히 붓는 도윤', demand: `${ACTION_LABEL.sprinkling} 공정이 안정적이면 보너스!`, bonusType: 'sprinklePour', level: 2 },
  { name: '마무리 장인 예은', demand: `${ACTION_LABEL.sprinkling} 공정이 완벽하면 보너스!`, bonusType: 'sprinklePour', level: 3 },
];

export function getGuestLevel(state) {
  const dayLevel = Number(state?.day || 1);
  if (!Number.isFinite(dayLevel)) return 1;
  return Math.max(1, Math.min(3, Math.floor(dayLevel)));
}

function guestDemandForMenu(guest, menu) {
  const courseNames = (menu?.courses || []).map((course) => course.name).filter(Boolean).join(' · ');
  const menuText = courseNames || '오늘 메뉴';
  const actionText = TYPE_LABEL[guest.bonusType] || guest.bonusType;
  return `${menuText}가 포함된 오늘 코스에서 ${actionText}이 잘 맞으면 보너스!`;
}

export function getGuestsForLevel(level) {
  const target = Math.max(1, Math.min(3, Number(level) || 1));
  return GUESTS.filter((guest) => guest.level === target);
}

export function pickGuestForLevel(level, menu, random = Math.random) {
  if (typeof menu === 'function') {
    random = menu;
    menu = null;
  }
  const pool = getGuestsForLevel(level);
  const chosen = pool.length ? pool[Math.floor(random() * pool.length)] : GUESTS[0];
  if (!menu) return chosen;
  return {
    ...chosen,
    demand: guestDemandForMenu(chosen, menu),
  };
}

export function ingredientAsset(ingredientId) {
  return INGREDIENT_ASSETS[ingredientId] || null;
}

export function primaryIngredient(stepData) {
  return stepData.ingredients?.[0] || null;
}
