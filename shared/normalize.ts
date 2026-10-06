import type { Provenance, RawItemSummary } from './types';

export interface NormalizedFields {
  sport: string | null;
  player: string | null;
  team: string | null;
  manufacturer: string | null;
  setName: string | null;
  cardNumber: string | null;
  seasonYear: string | null;
  parallelVariant: string | null;
  language: string | null;
  graded: boolean | null;
  grader: string | null;
  grade: string | null;
  certificationNumber: string | null;
  isLot: boolean;
  isReprint: boolean;
  matchStatus: 'ok' | 'needs_review';
  fieldProvenance: Record<string, Provenance>;
  normalizationWarnings: string[];
}

type StringField =
  | 'sport'
  | 'player'
  | 'team'
  | 'manufacturer'
  | 'setName'
  | 'cardNumber'
  | 'seasonYear'
  | 'parallelVariant'
  | 'language'
  | 'grade'
  | 'grader'
  | 'certificationNumber';

// eBay localizedAspects 이름 → 내부 필드. 구조화 값이 우선한다.
const ASPECT_FIELDS: Record<string, StringField> = {
  'sport': 'sport',
  'player/athlete': 'player',
  'team': 'team',
  'manufacturer': 'manufacturer',
  'set': 'setName',
  'card number': 'cardNumber',
  'season': 'seasonYear',
  'parallel/variety': 'parallelVariant',
  'language': 'language',
  'grade': 'grade',
  'grading company': 'grader',
  'professional grader': 'grader', // Apify/eBay 상세 페이지 명칭
  'certification number': 'certificationNumber',
};

const GRADER_ALIASES: Record<string, string> = {
  'professional sports authenticator': 'PSA',
  'beckett grading services': 'BGS',
  'beckett': 'BGS',
  'sportscard guaranty': 'SGC',
  'certified guaranty company': 'CGC',
};

const TITLE_GRADER = /\b(PSA|BGS|SGC|CGC)\b/i;
const TITLE_GRADE = /\b(PSA|BGS|SGC|CGC)\s*(10|9\.5|9|8\.5|8|7\.5|7)\b/i;
const TITLE_CERT = /\bcert(?:ification)?\s*(?:#|no\.?)?\s*(\d{6,12})\b/i;
const TITLE_YEAR = /\b(?:19[5-9]\d|20[0-4]\d)\b/g;
const LOT_WORDS = /\b(lot|bulk|box|pack)\b/i;
const REPRINT_WORDS = /\b(reprint|replica|custom)\b/i;

// 'PROFESSIONAL SPORTS AUTHENTICATOR (PSA)' 같은 표기는 약어로 줄이고,
// '미인증' 표기는 인증 기관이 없는 것으로 본다. 알 수 없는 값은 null (추정하지 않음).
function normalizeGrader(value: string): string | null {
  const trimmed = value.trim();
  if (/not professionally graded/i.test(trimmed)) return null;
  const acronym = TITLE_GRADER.exec(trimmed)?.[1];
  if (acronym) return acronym.toUpperCase();
  return GRADER_ALIASES[trimmed.toLowerCase()] ?? null;
}

export function normalizeFields(raw: RawItemSummary): NormalizedFields {
  const warnings: string[] = [];
  const provenance: Record<string, Provenance> = {};
  const values: Record<StringField, string | null> = {
    sport: null, player: null, team: null, manufacturer: null, setName: null,
    cardNumber: null, seasonYear: null, parallelVariant: null, language: null,
    grade: null, grader: null, certificationNumber: null,
  };

  // 1) 구조화된 속성 (api_aspect)
  const aspectValues = new Map<string, string>();
  for (const aspect of raw.localizedAspects ?? []) {
    const value = aspect.value.trim();
    if (value) aspectValues.set(aspect.name.trim().toLowerCase(), value);
  }
  for (const [aspectName, field] of Object.entries(ASPECT_FIELDS)) {
    const value = aspectValues.get(aspectName);
    if (value) {
      const normalized = field === 'grader' ? normalizeGrader(value) : value;
      if (normalized) {
        values[field] = normalized;
        provenance[field] = 'api_aspect';
      }
    }
  }
  const professionalGrader = aspectValues.get('professional grader');
  const structuredGraded =
    aspectValues.get('graded') ??
    (professionalGrader && /not professionally graded/i.test(professionalGrader) ? 'No' : undefined);

  // 2) 제목 규칙 (title_rule). 구조화 값이 없을 때만 채운다.
  const title = raw.title;
  const titleGrader = TITLE_GRADER.exec(title)?.[1]?.toUpperCase() ?? null;
  const titleGrade = TITLE_GRADE.exec(title);
  const titleCert = TITLE_CERT.exec(title)?.[1] ?? null;
  const titleYears = [...new Set(title.match(TITLE_YEAR) ?? [])];

  if (!values.grader && titleGrader) {
    values.grader = titleGrader;
    provenance.grader = 'title_rule';
  }
  if (!values.grade && titleGrade) {
    values.grade = titleGrade[2];
    provenance.grade = 'title_rule';
  }
  if (!values.certificationNumber && titleCert) {
    values.certificationNumber = titleCert;
    provenance.certificationNumber = 'title_rule';
  }
  if (!values.seasonYear && titleYears.length === 1) {
    values.seasonYear = titleYears[0];
    provenance.seasonYear = 'title_rule';
  } else if (!values.seasonYear && titleYears.length > 1) {
    warnings.push('year_ambiguous');
  }

  // 3) 상충 검사: 원문(구조화 값)은 유지하고 검토 필요로 표시한다.
  let conflict = false;
  if (titleGrader && aspectValues.has('grading company') && values.grader !== titleGrader) {
    conflict = true;
    warnings.push('grader_conflict');
  }
  if (titleGrade && aspectValues.has('grade') && values.grade !== titleGrade[2]) {
    conflict = true;
    warnings.push('grade_conflict');
  }
  if (structuredGraded === 'No' && titleGrader) {
    conflict = true;
    warnings.push('graded_conflict');
  }
  if (values.seasonYear && provenance.seasonYear !== 'title_rule' && titleYears.length === 1 && titleYears[0] !== values.seasonYear) {
    conflict = true;
    warnings.push('season_conflict');
  }

  // 4) 묶음·복각 후보 (확정 판정이 아니므로 검토 가능하게 둔다)
  const isLot = LOT_WORDS.test(title);
  const isReprint = REPRINT_WORDS.test(title);
  if (isLot) warnings.push('lot_candidate');
  if (isReprint) warnings.push('reprint_candidate');

  // 5) 누락 표시
  if (!values.player) warnings.push('player_missing');
  if (!values.parallelVariant) warnings.push('parallel_missing');

  // 6) 등급 여부. 'PSA 10' 제목은 독립 인증으로 보지 않는다 (grader는 추정 출처로 남긴다).
  let graded: boolean | null = null;
  if (values.grader) graded = true;
  else if (structuredGraded === 'No') graded = false;

  return {
    ...values,
    graded,
    isLot,
    isReprint,
    matchStatus: conflict || isLot || isReprint ? 'needs_review' : 'ok',
    fieldProvenance: provenance,
    normalizationWarnings: warnings,
  };
}
