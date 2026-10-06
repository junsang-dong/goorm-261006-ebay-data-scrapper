import type { RawItemSummary } from '../ebay/types';

// 모든 선수명·브랜드·팀·가격·ID는 이 파일에서 독립적으로 작성한 가상의 값이다.
// eBay 원문을 변형하지 않았고, 실제 eBay 링크를 만들지 않는다 (itemWebUrl 없음).

const FIRST_NAMES = [
  'Mateo', 'Ren', 'Luca', 'Diego', 'Noah', 'Kenji', 'Sam', 'Tobias', 'Eli', 'Hugo',
  'Rafael', 'Owen', 'Jun', 'Mika', 'Theo', 'Ivan', 'Leo', 'Arlo', 'Kai', 'Silas',
];
const LAST_NAMES = [
  'Okafor', 'Sakamoto', 'Brandt', 'Ferreira', 'Lindqvist', 'Mori', 'Delacroix', 'Wren', 'Carrow', 'Vance',
  'Haddad', 'Quill', 'Park', 'Novak', 'Alder', 'Strand', 'Ibarra', 'Kowal', 'Mendes', 'Ferris',
];
const TEAMS = ['Harbor Owls', 'Ridge Foxes', 'Coastal Comets', 'Iron Hawks', 'Pine Bears'];
const BRANDS = ['Halcyon Chrome', 'Meridian Prism', 'Aurora Select', 'Summit Heritage', 'Vertex Gallery'];
const PARALLELS = ['Base', 'Refractor', 'Gold /50', 'Silver Wave', 'Holo'];
const GRADERS = ['PSA', 'BGS', 'SGC', 'CGC'];

const SPORTS = [
  { sport: 'Baseball', code: 'BB', categoryId: 'MOCK-CAT-BASEBALL' },
  { sport: 'Basketball', code: 'BK', categoryId: 'MOCK-CAT-BASKETBALL' },
  { sport: 'Soccer', code: 'SC', categoryId: 'MOCK-CAT-SOCCER' },
] as const;

const PER_SPORT = 20;

function buildItem(sportIndex: number, k: number): RawItemSummary {
  const sport = SPORTS[sportIndex];
  const idx = sportIndex * PER_SPORT + k;
  const first = FIRST_NAMES[k];
  const last = LAST_NAMES[(k * 7 + sportIndex * 3) % LAST_NAMES.length];
  const player = `${first} ${last}`;
  const team = TEAMS[(k + sportIndex) % TEAMS.length];
  const brand = BRANDS[(k * 3 + sportIndex) % BRANDS.length];
  const year = 2019 + ((k + sportIndex) % 7);
  const cardNo = String(10 + ((k * 13) % 190));
  const parallel = PARALLELS[k % PARALLELS.length];
  const baseAspects = [
    { name: 'Sport', value: sport.sport },
    { name: 'Player/Athlete', value: player },
    { name: 'Team', value: team },
    { name: 'Manufacturer', value: brand },
    { name: 'Season', value: String(year) },
    { name: 'Card Number', value: cardNo },
  ];
  const price = (4 + ((idx * 37) % 380) + (k % 3) * 0.5).toFixed(2);
  const shipping = (idx % 4 === 0 ? '0.00' : idx % 4 === 1 ? '1.99' : '3.49');

  const base = {
    itemId: `MOCK-${sport.code}-${String(k + 1).padStart(3, '0')}`,
    price: { value: price, currency: 'USD' },
    buyingOptions: ['FIXED_PRICE'],
    shippingOptions: [{ shippingCost: { value: shipping, currency: 'USD' } }],
    itemLocation: { country: 'US' },
    categoryId: sport.categoryId,
    image: { imageUrl: '/placeholder-card.svg' },
    condition: 'Pre-owned',
    conditionId: '3000',
  };

  switch (k % 10) {
    case 0: // 구조화 속성 완전, 판본 명시
      return {
        ...base,
        title: `${year} ${brand} ${player} #${cardNo} ${parallel} ${team}`,
        localizedAspects: [...baseAspects, { name: 'Parallel/Variety', value: parallel }, { name: 'Graded', value: 'No' }],
      };
    case 1: // 구조화 속성 없음, 제목만으로 등급 추정
      return {
        ...base,
        title: `${year} ${brand} ${player} ${GRADERS[0]} 10 Slab`,
        conditionId: undefined,
        condition: undefined,
        localizedAspects: [],
      };
    case 2: // 등급 상충: 속성 9 / 제목 BGS 9.5
      return {
        ...base,
        title: `${year} ${brand} ${player} #${cardNo} BGS 9.5 graded`,
        localizedAspects: [...baseAspects, { name: 'Graded', value: 'Yes' }, { name: 'Grading Company', value: 'BGS' }, { name: 'Grade', value: '9' }],
      };
    case 3: // 묶음 매물
      return {
        ...base,
        title: `Lot of 25 ${year} ${brand} ${team} cards ${sport.sport}`,
        localizedAspects: [{ name: 'Sport', value: sport.sport }, { name: 'Team', value: team }],
      };
    case 4: // 복각·레플리카 후보
      return {
        ...base,
        title: `${player} ${year} ${brand} #${cardNo} reprint replica style`,
        localizedAspects: baseAspects,
      };
    case 5: // 배송비 미반환
      return {
        ...base,
        shippingOptions: undefined,
        title: `${year} ${brand} ${player} #${cardNo} ${parallel}`,
        localizedAspects: baseAspects,
      };
    case 6: // 이미지 없음
      return {
        ...base,
        image: undefined,
        title: `${year} ${brand} ${player} #${cardNo} ${parallel} PSA 8`,
        localizedAspects: [...baseAspects, { name: 'Graded', value: 'Yes' }, { name: 'Grading Company', value: 'PSA' }, { name: 'Grade', value: '8' }],
      };
    case 7: // 인증번호가 있는 등급 매물
      return {
        ...base,
        title: `${year} ${brand} ${player} #${cardNo} SGC 9 cert 48213907`,
        localizedAspects: [...baseAspects, { name: 'Graded', value: 'Yes' }, { name: 'Grading Company', value: 'SGC' }, { name: 'Grade', value: '9' }, { name: 'Certification Number', value: '48213907' }],
      };
    case 8: // 상태 정보 없음, 언어 명시
      return {
        ...base,
        condition: undefined,
        conditionId: undefined,
        title: `${year} ${brand} ${player} #${cardNo} Spanish edition`,
        localizedAspects: [...baseAspects, { name: 'Language', value: 'Spanish' }],
      };
    default: // 9: 판본·세트 정보가 제목과 속성에 모두 없음 (동일 카드 확정 금지)
      return {
        ...base,
        title: `${player} card lot ${sport.sport} ${team}`,
        localizedAspects: [{ name: 'Sport', value: sport.sport }],
      };
  }
}

export const MOCK_CATALOG: RawItemSummary[] = SPORTS.flatMap((_sport, sportIndex) =>
  Array.from({ length: PER_SPORT }, (_unused, k) => buildItem(sportIndex, k)),
);
