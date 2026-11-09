import { describe, expect, it } from 'vitest';
import {
  alcoholGrams,
  convertDrink,
  earnedDrinks,
  roundTo,
  standardDrinks,
} from '../src/domain/conversions.js';

describe('drink conversion', () => {
  it('computes grams as volume × abv × 0.789', () => {
    expect(alcoholGrams(355, 5)).toBeCloseTo(14.00475, 6);
    expect(alcoholGrams(44, 40)).toBeCloseTo(13.8864, 6);
    expect(alcoholGrams(500, 0)).toBe(0);
  });

  it('divides grams by 14 for US standard drinks', () => {
    expect(standardDrinks(14)).toBe(1);
    expect(standardDrinks(28)).toBe(2);
  });

  it('rounds stored values: grams to 2 decimals, standard drinks to 4', () => {
    expect(convertDrink(355, 5)).toEqual({ alcoholG: 14, stdDrinks: 1.0003 });
    expect(convertDrink(473, 6.5)).toEqual({ alcoholG: 24.26, stdDrinks: 1.7327 });
    expect(convertDrink(148, 12)).toEqual({ alcoholG: 14.01, stdDrinks: 1.0009 });
  });
});

describe('set earning', () => {
  it('earns amount / earnPer × earnDrinks', () => {
    expect(earnedDrinks(100, 1, 100)).toBe(1);
    expect(earnedDrinks(50, 1, 100)).toBe(0.5);
    expect(earnedDrinks(1800, 0.5, 600)).toBe(1.5);
    expect(earnedDrinks(5000, 1, 1000)).toBe(5);
    expect(earnedDrinks(10, 1, 3)).toBe(3.3333);
  });

  it('earns nothing for a zero rate or invalid divisor', () => {
    expect(earnedDrinks(100, 0, 100)).toBe(0);
    expect(earnedDrinks(100, 1, 0)).toBe(0);
  });

  it('rounds half away from float noise', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-0.12345, 4)).toBe(-0.1234);
  });
});
