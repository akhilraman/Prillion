import { describe, expect, it } from 'vitest';
import { digitRuns, normalizeAnswer } from './normalize.ts';

describe('normalizeAnswer', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeAnswer('  Buzz   ALDRIN ')).toBe('buzz aldrin');
  });

  it('treats punctuation as a separator', () => {
    expect(normalizeAnswer('Dr. Dre')).toBe('dr dre');
    expect(normalizeAnswer('Eazy-E')).toBe('eazy e');
    expect(normalizeAnswer('Student No: 1')).toBe('student no 1');
  });

  it('removes apostrophes instead of splitting words', () => {
    expect(normalizeAnswer("O'Shea Jackson")).toBe('oshea jackson');
    expect(normalizeAnswer('O\u2019Shea Jackson')).toBe('oshea jackson');
  });

  it('strips accents', () => {
    expect(normalizeAnswer('Beyoncé')).toBe('beyonce');
  });

  it('maps ampersands to "and"', () => {
    expect(normalizeAnswer('Rock & Roll')).toBe('rock and roll');
  });

  it('drops one leading article only', () => {
    expect(normalizeAnswer('The Empire Strikes Back')).toBe('empire strikes back');
    expect(normalizeAnswer('A New Hope')).toBe('new hope');
    expect(normalizeAnswer('the the')).toBe('the');
  });

  it('is idempotent', () => {
    for (const s of ['Dr. Dre', "O'Shea", 'The  Moon!!', 'Apollo 11', '  ']) {
      expect(normalizeAnswer(normalizeAnswer(s))).toBe(normalizeAnswer(s));
    }
  });

  it('returns an empty string for input with no letters or digits', () => {
    expect(normalizeAnswer('   ')).toBe('');
    expect(normalizeAnswer('!!!')).toBe('');
  });

  it('preserves non-Latin letters (e.g. Telugu script)', () => {
    expect(normalizeAnswer('ఈగ')).not.toBe('');
  });
});

describe('digitRuns', () => {
  it('extracts digit runs in order', () => {
    expect(digitRuns('apollo 11')).toEqual(['11']);
    expect(digitRuns('baahubali 2 the conclusion')).toEqual(['2']);
    expect(digitRuns('no digits')).toEqual([]);
  });
});
