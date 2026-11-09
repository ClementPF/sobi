/**
 * Mirror of apps/backend/src/domain/conversions.ts for live previews. The server recomputes and
 * stores the authoritative values.
 * US standard drink: 14 g of pure alcohol. Ethanol density: 0.789 g/ml.
 */
import type { Metric, Units } from '@/api/types';

export const ETHANOL_DENSITY_G_PER_ML = 0.789;
export const GRAMS_PER_STANDARD_DRINK = 14;

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function alcoholGrams(volumeMl: number, abv: number): number {
  return volumeMl * (abv / 100) * ETHANOL_DENSITY_G_PER_ML;
}

export function standardDrinks(grams: number): number {
  return grams / GRAMS_PER_STANDARD_DRINK;
}

export function convertDrink(
  volumeMl: number,
  abv: number,
): { alcoholG: number; stdDrinks: number } {
  const grams = alcoholGrams(volumeMl, abv);
  return { alcoholG: roundTo(grams, 2), stdDrinks: roundTo(standardDrinks(grams), 4) };
}

export function earnedDrinks(amount: number, earnDrinks: number, earnPer: number): number {
  if (earnPer <= 0) return 0;
  return roundTo((amount / earnPer) * earnDrinks, 4);
}

/** "1.25", "-0.5", "0": drinks with at most two decimals. */
export function formatDrinks(value: number): string {
  const rounded = roundTo(value, 2);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** "+1.25" / "−0.5": a signed amount for earned (+) and drunk (−) entries. */
export function formatSigned(value: number): string {
  const rounded = roundTo(value, 2);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return '0';
}

export const METRIC_LABELS: Record<Metric, string> = {
  count: 'Count',
  seconds: 'Time',
  meters: 'Distance',
};

export const ML_PER_FL_OZ = 29.5735;
export const METERS_PER_MILE = 1609.344;

/** Unit label of an exercise metric in the chosen unit system. */
export function metricUnit(metric: Metric, units: Units = 'metric'): string {
  if (metric === 'count') return 'reps';
  if (metric === 'seconds') return 'sec';
  return units === 'imperial' ? 'mi' : 'm';
}

/** A set amount for display: "25", "1:30", "1.2 km", "800 m" or "0.75 mi". */
export function formatAmount(metric: Metric, amount: number, units: Units = 'metric'): string {
  if (metric === 'seconds') {
    const minutes = Math.floor(amount / 60);
    const seconds = amount % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  if (metric === 'meters') {
    if (units === 'imperial') return `${roundTo(amount / METERS_PER_MILE, 2)} mi`;
    return amount >= 1000 ? `${roundTo(amount / 1000, 2)} km` : `${amount} m`;
  }
  return String(amount);
}

/** The rate's unit count as shown to the user: meters become miles in imperial. */
export function displayEarnPer(metric: Metric, earnPer: number, units: Units = 'metric'): number {
  return metric === 'meters' && units === 'imperial'
    ? roundTo(earnPer / METERS_PER_MILE, 2)
    : earnPer;
}

/** Inverse of `displayEarnPer`; null when the value is not a positive whole number of base units. */
export function parseEarnPer(metric: Metric, text: string, units: Units = 'metric'): number | null {
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const base =
    metric === 'meters' && units === 'imperial' ? Math.round(value * METERS_PER_MILE) : value;
  return Number.isInteger(base) && base >= 1 ? base : null;
}

/** "1 drink per 100 reps" */
export function formatRate(
  metric: Metric,
  earnDrinks: number,
  earnPer: number,
  units: Units = 'metric',
): string {
  const drinks = formatDrinks(earnDrinks);
  const per = displayEarnPer(metric, earnPer, units);
  return `${drinks} drink${drinks === '1' ? '' : 's'} per ${per} ${metricUnit(metric, units)}`;
}

export function volumeUnit(units: Units): string {
  return units === 'imperial' ? 'fl oz' : 'ml';
}

/** A volume in the user's units without the unit label: "355" or "12". */
export function volumeValue(ml: number, units: Units): string {
  return units === 'imperial' ? String(roundTo(ml / ML_PER_FL_OZ, 1)) : String(ml);
}

/** "355 ml" or "12 fl oz" (US fluid ounces). */
export function formatVolume(ml: number, units: Units): string {
  return `${volumeValue(ml, units)} ${volumeUnit(units)}`;
}

/** Whole milliliters from text in the user's units; null unless 1–10000 ml. */
export function parseVolume(text: string, units: Units): number | null {
  const value = Number(text.replace(',', '.'));
  if (!text.trim() || !Number.isFinite(value)) return null;
  const ml = units === 'imperial' ? Math.round(value * ML_PER_FL_OZ) : value;
  return Number.isInteger(ml) && ml >= 1 && ml <= 10_000 ? ml : null;
}
