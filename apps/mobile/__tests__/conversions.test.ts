import {
  convertDrink,
  earnedDrinks,
  formatAmount,
  formatRate,
  formatSigned,
} from '@/lib/conversions';

describe('conversion helper', () => {
  it('converts volume and ABV to grams and US standard drinks', () => {
    expect(convertDrink(355, 5)).toEqual({ alcoholG: 14, stdDrinks: 1.0003 });
    expect(convertDrink(44, 40)).toEqual({ alcoholG: 13.89, stdDrinks: 0.9919 });
    expect(convertDrink(148, 12)).toEqual({ alcoholG: 14.01, stdDrinks: 1.0009 });
    expect(convertDrink(500, 0)).toEqual({ alcoholG: 0, stdDrinks: 0 });
  });

  it('matches the server rounding of earned drinks', () => {
    expect(earnedDrinks(50, 1, 100)).toBe(0.5);
    expect(earnedDrinks(90, 0.5, 60)).toBe(0.75);
    expect(earnedDrinks(10, 1, 3)).toBe(3.3333);
    expect(earnedDrinks(10, 1, 0)).toBe(0);
  });

  it('formats amounts, rates and signed totals', () => {
    expect(formatAmount('seconds', 95)).toBe('1:35');
    expect(formatAmount('meters', 800)).toBe('800 m');
    expect(formatAmount('meters', 1500)).toBe('1.5 km');
    expect(formatRate('count', 1, 100)).toBe('1 drink per 100 reps');
    expect(formatSigned(1.234)).toBe('+1.23');
    expect(formatSigned(-0.5)).toBe('−0.5');
  });
});
