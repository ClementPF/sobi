/**
 * Pure conversion math shared by the API and (mirrored in) the app's live preview.
 * US standard drink: 14 g of pure alcohol. Ethanol density: 0.789 g/ml.
 */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;
export const GRAMS_PER_STANDARD_DRINK = 14;

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Grams of pure alcohol in `volumeMl` of a drink at `abv` percent. */
export function alcoholGrams(volumeMl: number, abv: number): number {
  return volumeMl * (abv / 100) * ETHANOL_DENSITY_G_PER_ML;
}

export function standardDrinks(grams: number): number {
  return grams / GRAMS_PER_STANDARD_DRINK;
}

/** The values stored on a drink: grams rounded to 2 decimals, standard drinks to 4. */
export function convertDrink(
  volumeMl: number,
  abv: number,
): { alcoholG: number; stdDrinks: number } {
  const grams = alcoholGrams(volumeMl, abv);
  return { alcoholG: roundTo(grams, 2), stdDrinks: roundTo(standardDrinks(grams), 4) };
}

/** Standard drinks earned by a set of `amount` units at "earnDrinks per earnPer units". */
export function earnedDrinks(amount: number, earnDrinks: number, earnPer: number): number {
  if (earnPer <= 0) return 0;
  return roundTo((amount / earnPer) * earnDrinks, 4);
}
