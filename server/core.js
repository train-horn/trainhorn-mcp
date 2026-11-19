/**
 * trainhorn-calc: small, dependency-free calculators for train horn setups.
 *
 * - Acoustics: SPL versus distance (inverse-square law), with optional air absorption.
 * - Air system: tank runtime (Boyle's law) and compressor recovery.
 * - Electrical: copper AWG choice by voltage drop.
 *
 * A faithful port of the tested Python core `trainhorn-calc` (same formulas,
 * same reference values). Results are estimates, not measurements, and are
 * not a legal noise assessment.
 *
 * @module trainhorn-calc
 */

/** Package version. */
export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Error thrown when a calculator receives an invalid argument.
 * Subclasses `RangeError`, so `instanceof RangeError` also matches.
 */
export class InputError extends RangeError {
  /** @param {string} message Human-readable description of the problem. */
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

/** Metres in one international foot (exact). */
export const METERS_PER_FOOT = 0.3048;

/** Accepted length units. */
export const LENGTH_UNITS = Object.freeze(['ft', 'm']);

/**
 * Return `value` as a finite number or throw {@link InputError}.
 * Numbers and numeric strings are accepted; booleans, empty strings, NaN and Infinity are not.
 * @param {string} name Argument name used in the error message.
 * @param {unknown} value Value to check.
 * @returns {number}
 */
function num(name, value) {
  if (typeof value === 'boolean') throw new InputError(`${name} must be a number, got a boolean`);
  let result;
  if (typeof value === 'number') result = value;
  else if (typeof value === 'string' && value.trim() !== '') result = Number(value.trim());
  else throw new InputError(`${name} must be a number, got ${JSON.stringify(value) ?? String(value)}`);
  if (Number.isNaN(result) && typeof value === 'string') {
    throw new InputError(`${name} must be a number, got ${JSON.stringify(value)}`);
  }
  if (!Number.isFinite(result)) throw new InputError(`${name} must be finite, got ${String(value)}`);
  return result;
}

/**
 * Finite number strictly greater than 0.
 * @param {string} name Argument name.
 * @param {unknown} value Value to check.
 * @returns {number}
 */
function positive(name, value) {
  const r = num(name, value);
  if (r <= 0) throw new InputError(`${name} must be greater than 0, got ${r}`);
  return r;
}

/**
 * Finite number 0 or greater.
 * @param {string} name Argument name.
 * @param {unknown} value Value to check.
 * @returns {number}
 */
function nonNegative(name, value) {
  const r = num(name, value);
  if (r < 0) throw new InputError(`${name} must be 0 or greater, got ${r}`);
  return r;
}

/**
 * Normalise a length unit ("ft" or "m", case and whitespace insensitive).
 * @param {unknown} unit Unit to check.
 * @returns {'ft'|'m'}
 */
function lengthUnit(unit) {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u !== 'ft' && u !== 'm') {
    throw new InputError(`unit must be one of ft, m; got ${JSON.stringify(unit) ?? String(unit)}`);
  }
  return u;
}

/**
 * Convert a length in `unit` to metres.
 * @param {number} value Length.
 * @param {'ft'|'m'} unit Unit of `value`.
 * @returns {number}
 */
function toMeters(value, unit) {
  return unit === 'ft' ? value * METERS_PER_FOOT : value;
}

/* ------------------------------------------------------------------ */
/* Acoustics                                                           */
/* ------------------------------------------------------------------ */

/**
 * Approximate atmospheric absorption in dB/km at 10 degC and 70 % RH
 * (ISO 9613-2 Table 2 condition, from the ISO 9613-1 equations), keyed by
 * octave-band centre frequency in Hz. Rough guide only.
 * @type {Readonly<Record<number, number>>}
 */
export const AIR_ABSORPTION_DB_PER_KM = Object.freeze({
  63: 0.1, 125: 0.4, 250: 1.0, 500: 1.9, 1000: 3.7, 2000: 9.7, 4000: 32.8, 8000: 117.0,
});

/**
 * Estimate the SPL at `distance` from a level known at `refDistance` (free field).
 *
 * `L = sourceDb - 20*log10(distance/refDistance) - absorptionDbPerKm * (d_m - ref_m) / 1000`
 *
 * @param {number} sourceDb Level in dB at `refDistance` (e.g. 150 for "150 dB at 10 ft").
 * @param {number} distance Distance at which to estimate the level (> 0).
 * @param {import('./index').SplOptions} [options] Reference distance, unit and absorption.
 * @returns {number} Estimated level in dB.
 * @throws {InputError} On invalid input.
 * @example splAtDistance(150, 100) // 130 (150 dB at 10 ft -> 130 dB at 100 ft)
 */
export function splAtDistance(sourceDb, distance, options = {}) {
  const { refDistance = 10, unit = 'ft', absorptionDbPerKm = 0 } = options;
  const L = num('sourceDb', sourceDb);
  const d = positive('distance', distance);
  const ref = positive('refDistance', refDistance);
  const u = lengthUnit(unit);
  const alpha = nonNegative('absorptionDbPerKm', absorptionDbPerKm);
  let level = L - 20 * Math.log10(d / ref);
  if (alpha) level -= (alpha * (toMeters(d, u) - toMeters(ref, u))) / 1000;
  return level;
}

/**
 * Distance at which the level falls to `targetDb`; the inverse of {@link splAtDistance}.
 * Closed form without absorption (`d = ref * 10^((source - target)/20)`), bisection with it.
 *
 * @param {number} sourceDb Level in dB at `refDistance`.
 * @param {number} targetDb Level to find the distance for (may exceed `sourceDb`).
 * @param {import('./index').SplOptions} [options] Reference distance, unit and absorption.
 * @returns {number} Distance in `options.unit`.
 * @throws {InputError} On invalid input or an unusable result.
 * @example distanceForSpl(150, 130) // 100
 */
export function distanceForSpl(sourceDb, targetDb, options = {}) {
  const { refDistance = 10, unit = 'ft', absorptionDbPerKm = 0 } = options;
  const L = num('sourceDb', sourceDb);
  const T = num('targetDb', targetDb);
  const ref = positive('refDistance', refDistance);
  const u = lengthUnit(unit);
  const alpha = nonNegative('absorptionDbPerKm', absorptionDbPerKm);
  const free = ref * 10 ** ((L - T) / 20);
  if (free === 0 || !Number.isFinite(free)) {
    throw new InputError('sourceDb and targetDb are too far apart to give a usable distance');
  }
  if (!alpha || free === ref) return free;
  let lo = Math.min(free, ref);
  let hi = Math.max(free, ref);
  const opts = { refDistance: ref, unit: u, absorptionDbPerKm: alpha };
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (splAtDistance(L, mid, opts) - T > 0) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-12 * hi) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Level change in dB when the distance is multiplied by `ratio` (free field): `20*log10(ratio)`.
 * @param {number} ratio Distance ratio (> 0). 10 gives 20 dB.
 * @returns {number}
 * @throws {InputError} If `ratio` is not a positive finite number.
 */
export function distanceRatioLoss(ratio) {
  return 20 * Math.log10(positive('ratio', ratio));
}

/**
 * Free-field loss per doubling of distance: `20*log10(2)`, about 6.02 dB.
 * @returns {number}
 */
export function dbDoublingLoss() {
  return distanceRatioLoss(2);
}

/**
 * Combine incoherent sources (e.g. two horns): `10*log10(sum(10^(L_i/10)))`.
 * Two equal sources add about 3.01 dB.
 * @param {Iterable<number>} levelsDb Levels in dB (at least one).
 * @returns {number} Combined level in dB.
 * @throws {InputError} If the list is empty or contains a non-number.
 */
export function combineLevels(levelsDb) {
  if (levelsDb == null || typeof levelsDb[Symbol.iterator] !== 'function' || typeof levelsDb === 'string') {
    throw new InputError('combineLevels needs an array of levels');
  }
  const values = Array.from(levelsDb, (v) => num('level', v));
  if (values.length === 0) throw new InputError('combineLevels needs at least one level');
  const peak = Math.max(...values);
  return peak + 10 * Math.log10(values.reduce((s, v) => s + 10 ** ((v - peak) / 10), 0));
}

/* ------------------------------------------------------------------ */
/* Air system                                                          */
/* ------------------------------------------------------------------ */

/** Standard atmosphere at sea level in psi. */
export const ATMOSPHERIC_PSI = 14.696;
/** Cubic feet in one US liquid gallon (231 in^3 / 1728 in^3). */
export const CUBIC_FEET_PER_GALLON = 231 / 1728;

/**
 * Validate a gauge-pressure pair where `high` must exceed `low`.
 * @param {string} highName Name of the higher pressure.
 * @param {unknown} high Higher gauge pressure.
 * @param {string} lowName Name of the lower pressure.
 * @param {unknown} low Lower gauge pressure.
 * @returns {[number, number]}
 */
function pressures(highName, high, lowName, low) {
  const h = nonNegative(highName, high);
  const l = nonNegative(lowName, low);
  if (h <= l) throw new InputError(`${highName} (${h} psi) must be greater than ${lowName} (${l} psi)`);
  return [h, l];
}

/**
 * Shared free-air computation with named pressures for error messages.
 * @param {unknown} tankGallons Tank volume in US gallons.
 * @param {string} highName Name of the higher pressure.
 * @param {unknown} high Higher gauge pressure.
 * @param {string} lowName Name of the lower pressure.
 * @param {unknown} low Lower gauge pressure.
 * @param {unknown} atmosphericPsi Ambient absolute pressure.
 * @returns {number}
 */
function freeAir(tankGallons, highName, high, lowName, low, atmosphericPsi) {
  const v = positive('tankGallons', tankGallons);
  const [h, l] = pressures(highName, high, lowName, low);
  const atm = positive('atmosphericPsi', atmosphericPsi);
  return (v * CUBIC_FEET_PER_GALLON * (h - l)) / atm;
}

/**
 * Free air (cubic feet at atmospheric pressure) released between two gauge pressures (Boyle's law):
 * `V_free = tankGallons * 0.13368 * (startPsi - endPsi) / atmosphericPsi`.
 * @param {number} tankGallons Tank volume in US gallons (> 0).
 * @param {number} startPsi Starting gauge pressure in psi (> `endPsi`).
 * @param {number} endPsi Final gauge pressure in psi (>= 0).
 * @param {number} [atmosphericPsi=14.696] Ambient absolute pressure (> 0); lower it for altitude.
 * @returns {number} Cubic feet of free air.
 * @throws {InputError} On invalid input.
 */
export function freeAirVolumeCuft(tankGallons, startPsi, endPsi, atmosphericPsi = ATMOSPHERIC_PSI) {
  return freeAir(tankGallons, 'startPsi', startPsi, 'endPsi', endPsi, atmosphericPsi);
}

/**
 * Seconds of continuous horn time from `startPsi` down to `cutoffPsi`:
 * `freeAirVolumeCuft(...) / hornCfm * 60`. Isothermal, so an upper estimate.
 * @param {number} tankGallons Tank volume in US gallons (> 0).
 * @param {number} startPsi Tank gauge pressure when you start blowing (e.g. 150).
 * @param {number} cutoffPsi Lowest usable gauge pressure (e.g. 90); below `startPsi`.
 * @param {number} hornCfm Horn consumption in CFM of free air (> 0).
 * @param {number} [atmosphericPsi=14.696] Ambient absolute pressure in psi.
 * @returns {number} Seconds.
 * @throws {InputError} On invalid input.
 * @example tankRuntimeSeconds(5, 150, 110, 10) // about 10.92
 */
export function tankRuntimeSeconds(tankGallons, startPsi, cutoffPsi, hornCfm, atmosphericPsi = ATMOSPHERIC_PSI) {
  const cfm = positive('hornCfm', hornCfm);
  return (freeAir(tankGallons, 'startPsi', startPsi, 'cutoffPsi', cutoffPsi, atmosphericPsi) / cfm) * 60;
}

/**
 * Whole blasts of `blastSeconds` that fit in `runtimeSeconds`.
 * @param {number} runtimeSeconds Available horn time (>= 0).
 * @param {number} blastSeconds Length of one blast (> 0).
 * @returns {number} Integer count.
 * @throws {InputError} On invalid input.
 */
export function blastCount(runtimeSeconds, blastSeconds) {
  const r = nonNegative('runtimeSeconds', runtimeSeconds);
  const b = positive('blastSeconds', blastSeconds);
  return Math.floor(r / b + 1e-9);
}

/**
 * Seconds for a compressor to refill the tank from `cutInPsi` to `cutOutPsi`.
 *
 * Constant-flow model (default): `t = V_free / compressorCfm * 60`.
 * Linear-flow model (when `cfmAtZeroPsi` and `ratedPsi` are both given): delivery falls
 * linearly from `cfmAtZeroPsi` at 0 psi to `compressorCfm` at `ratedPsi`, and
 * `t = V_tank / P_atm * ln(q_out / q_in) / slope * 60`.
 *
 * @param {number} tankGallons Tank volume in US gallons (> 0).
 * @param {number} cutInPsi Gauge pressure at which the compressor switches on.
 * @param {number} cutOutPsi Gauge pressure at which it switches off (> cut-in).
 * @param {number} compressorCfm Free-air delivery in CFM at the rated pressure (> 0).
 * @param {import('./index').RecoveryOptions} [options] Linear model and ambient pressure.
 * @returns {number} Seconds.
 * @throws {InputError} On invalid input.
 * @example compressorRecoverySeconds(2, 110, 150, 1.0) // about 43.7
 */
export function compressorRecoverySeconds(tankGallons, cutInPsi, cutOutPsi, compressorCfm, options = {}) {
  const { cfmAtZeroPsi, ratedPsi, atmosphericPsi = ATMOSPHERIC_PSI } = options;
  const cfm = positive('compressorCfm', compressorCfm);
  const fa = freeAir(tankGallons, 'cutOutPsi', cutOutPsi, 'cutInPsi', cutInPsi, atmosphericPsi);
  if (cfmAtZeroPsi == null && ratedPsi == null) return (fa / cfm) * 60;
  if (cfmAtZeroPsi == null || ratedPsi == null) {
    throw new InputError('cfmAtZeroPsi and ratedPsi must be given together');
  }
  const q0 = positive('cfmAtZeroPsi', cfmAtZeroPsi);
  const pRated = positive('ratedPsi', ratedPsi);
  if (q0 < cfm) throw new InputError('cfmAtZeroPsi must be at least compressorCfm (output falls with pressure)');
  const slope = (cfm - q0) / pRated;
  const pin = Number(cutInPsi);
  const pout = Number(cutOutPsi);
  const qIn = q0 + slope * pin;
  const qOut = q0 + slope * pout;
  if (qOut <= 0) {
    throw new InputError(
      `the linear flow model gives no output at ${pout} psi; check cfmAtZeroPsi, compressorCfm and ratedPsi`,
    );
  }
  if (slope === 0) return (fa / q0) * 60;
  const tankCuft = Number(tankGallons) * CUBIC_FEET_PER_GALLON;
  return ((tankCuft / Number(atmosphericPsi)) * Math.log(qOut / qIn) / slope) * 60;
}

/* ------------------------------------------------------------------ */
/* Electrical                                                          */
/* ------------------------------------------------------------------ */

/** Annealed copper resistivity, 100 % IACS, at 20 degC, in ohm*m. */
export const COPPER_RESISTIVITY_OHM_M = 1.7241e-8;
/** Temperature coefficient of resistance of annealed copper near 20 degC, per degC. */
export const COPPER_TEMP_COEFF_PER_C = 0.00393;
/** Gauges considered by {@link suggestAwg}, thinnest to thickest. */
export const AWG_SIZES = Object.freeze(['18', '16', '14', '12', '10', '8', '6', '4', '2', '1', '1/0', '2/0', '3/0', '4/0']);

const AUGHT = { '1/0': 0, 0: 0, '2/0': -1, '00': -1, '3/0': -2, '000': -2, '4/0': -3, '0000': -3 };

/**
 * Map an AWG label to its formula index (1/0 -> 0, 4/0 -> -3).
 * @param {number|string} awg Gauge such as 10, "10", "10 AWG", "1/0" or "4/0".
 * @returns {number}
 */
function awgNumber(awg) {
  if (typeof awg === 'boolean' || awg == null) throw new InputError("awg must be a gauge like 10, '10', '1/0' or '4/0'");
  const text = String(awg).trim().toUpperCase().replace('AWG', '').trim();
  if (Object.prototype.hasOwnProperty.call(AUGHT, text)) return AUGHT[text];
  if (!/^[+-]?\d+$/.test(text)) throw new InputError(`unknown AWG size ${JSON.stringify(awg)}; use 1-40 or 1/0..4/0`);
  const n = parseInt(text, 10);
  if (n < 1 || n > 40) throw new InputError(`AWG size must be between 4/0 and 40, got ${JSON.stringify(awg)}`);
  return n;
}

/**
 * Bare conductor diameter in mm for a solid AWG size (ASTM B258: `0.127 mm * 92^((36-n)/39)`).
 * @param {number|string} awg Gauge.
 * @returns {number}
 * @throws {InputError} On an unknown gauge.
 */
export function awgDiameterMm(awg) {
  return 0.127 * 92 ** ((36 - awgNumber(awg)) / 39);
}

/**
 * Conductor cross-section area in mm^2.
 * @param {number|string} awg Gauge.
 * @returns {number}
 * @throws {InputError} On an unknown gauge.
 */
export function awgAreaMm2(awg) {
  const d = awgDiameterMm(awg);
  return (Math.PI * d * d) / 4;
}

/**
 * Copper resistance in ohms per 1000 ft at `temperatureC`: `R = rho * L / A`, then
 * `R_T = R_20 * (1 + 0.00393 * (T - 20))`.
 * @param {number|string} awg Gauge.
 * @param {number} [temperatureC=20] Conductor temperature, -60..200 degC.
 * @returns {number}
 * @throws {InputError} On an unknown gauge or out-of-range temperature.
 */
export function awgResistanceOhmPer1000ft(awg, temperatureC = 20) {
  const t = num('temperatureC', temperatureC);
  if (t < -60 || t > 200) throw new InputError('temperatureC must be between -60 and 200 degC');
  const areaM2 = awgAreaMm2(awg) * 1e-6;
  const r20 = (COPPER_RESISTIVITY_OHM_M * 304.8) / areaM2;
  return r20 * (1 + COPPER_TEMP_COEFF_PER_C * (t - 20));
}

/**
 * Voltage lost in a two-conductor copper run: `I * R * 2 * oneWayLength`.
 * @param {number} amps Load current in A (> 0).
 * @param {number} oneWayLength Distance from source to load (> 0).
 * @param {number|string} awg Gauge.
 * @param {import('./index').WireOptions} [options] Unit and conductor temperature.
 * @returns {number} Volts.
 * @throws {InputError} On invalid input.
 */
export function voltageDrop(amps, oneWayLength, awg, options = {}) {
  const { unit = 'ft', temperatureC = 20 } = options;
  const i = positive('amps', amps);
  const len = positive('oneWayLength', oneWayLength);
  const u = lengthUnit(unit);
  const feet = toMeters(len, u) / METERS_PER_FOOT;
  return (i * awgResistanceOhmPer1000ft(awg, temperatureC) * (2 * feet)) / 1000;
}

/**
 * Smallest copper AWG whose round-trip voltage drop stays within `maxDropPct`.
 * Does not check ampacity or fuse sizing.
 * @param {number} amps Continuous load current in A (> 0).
 * @param {number} oneWayLength Distance from the power source to the load (> 0).
 * @param {import('./index').SuggestOptions} [options] Voltage, budget, unit and temperature.
 * @returns {import('./index').WireSuggestion}
 * @throws {InputError} On invalid input, or if even 4/0 cannot meet the budget.
 * @example suggestAwg(30, 10).awg // '6'
 */
export function suggestAwg(amps, oneWayLength, options = {}) {
  const { systemVoltage = 12, maxDropPct = 3, unit = 'ft', temperatureC = 20 } = options;
  const i = positive('amps', amps);
  const len = positive('oneWayLength', oneWayLength);
  const v = positive('systemVoltage', systemVoltage);
  const pct = positive('maxDropPct', maxDropPct);
  if (pct > 50) throw new InputError('maxDropPct must be 50 or less');
  const u = lengthUnit(unit);
  const allowed = (v * pct) / 100;
  for (const awg of AWG_SIZES) {
    const drop = voltageDrop(i, len, awg, { unit: u, temperatureC });
    if (drop <= allowed) {
      return {
        awg,
        voltageDropV: drop,
        voltageDropPct: (drop / v) * 100,
        allowedDropPct: pct,
        systemVoltage: v,
        amps: i,
        oneWayLength: len,
        unit: u,
      };
    }
  }
  throw new InputError(
    `no gauge up to 4/0 keeps the drop within ${pct}% (${i} A over ${len} ${u}); ` +
      'shorten the run, raise the system voltage or use parallel conductors',
  );
}
