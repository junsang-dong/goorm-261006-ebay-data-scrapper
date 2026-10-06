import { describe, expect, it } from 'vitest';
import { normalizeFields } from '../server/normalization/normalize';
import type { RawItemSummary } from '../server/ebay/types';

const base = (overrides: Partial<RawItemSummary>): RawItemSummary => ({
  itemId: 'T-1',
  title: 'Sample title',
  price: { value: '10.00', currency: 'USD' },
  ...overrides,
});

describe('normalizeFields', () => {
  it('prefers structured aspects and records api_aspect provenance', () => {
    const result = normalizeFields(
      base({
        title: '2021 Halcyon Chrome Mateo Okafor #42',
        localizedAspects: [
          { name: 'Player/Athlete', value: 'Mateo Okafor' },
          { name: 'Season', value: '2021' },
        ],
      }),
    );
    expect(result.player).toBe('Mateo Okafor');
    expect(result.fieldProvenance.player).toBe('api_aspect');
    expect(result.fieldProvenance.seasonYear).toBe('api_aspect');
  });

  it('fills grader and grade from the title only as title_rule, never as independent certification', () => {
    const result = normalizeFields(base({ title: '2022 Meridian Prism PSA 10 Slab' }));
    expect(result.grader).toBe('PSA');
    expect(result.grade).toBe('10');
    expect(result.graded).toBe(true);
    expect(result.fieldProvenance.grade).toBe('title_rule');
    expect(result.fieldProvenance.grader).toBe('title_rule');
  });

  it('keeps the structured value and flags needs_review when title and aspect conflict', () => {
    const result = normalizeFields(
      base({
        title: '2020 Aurora Select BGS 9.5 graded',
        localizedAspects: [
          { name: 'Graded', value: 'Yes' },
          { name: 'Grading Company', value: 'BGS' },
          { name: 'Grade', value: '9' },
        ],
      }),
    );
    expect(result.grade).toBe('9');
    expect(result.matchStatus).toBe('needs_review');
    expect(result.normalizationWarnings).toContain('grade_conflict');
  });

  it('marks lots and reprints as review candidates instead of confirmed judgments', () => {
    const lot = normalizeFields(base({ title: 'Lot of 25 cards 2019' }));
    expect(lot.isLot).toBe(true);
    expect(lot.matchStatus).toBe('needs_review');

    const reprint = normalizeFields(base({ title: 'Player reprint style 2019' }));
    expect(reprint.isReprint).toBe(true);
    expect(reprint.normalizationWarnings).toContain('reprint_candidate');
  });

  it('does not guess a season when the title contains several years', () => {
    const result = normalizeFields(base({ title: 'Set 2019 vs 2024 retro insert' }));
    expect(result.seasonYear).toBeNull();
    expect(result.normalizationWarnings).toContain('year_ambiguous');
  });

  it('extracts a certification number only when labelled', () => {
    const result = normalizeFields(base({ title: 'SGC 9 cert 48213907' }));
    expect(result.certificationNumber).toBe('48213907');
    const none = normalizeFields(base({ title: 'SGC 9 card 48213907' }));
    expect(none.certificationNumber).toBeNull();
  });
});
