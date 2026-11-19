// Core reference vectors, ported unchanged from the trainhorn-calc test suite (CLI tests omitted).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../server/core.js';

const {
  InputError, splAtDistance, distanceForSpl, distanceRatioLoss, dbDoublingLoss, combineLevels,
  freeAirVolumeCuft, tankRuntimeSeconds, blastCount, compressorRecoverySeconds,
  awgResistanceOhmPer1000ft, awgAreaMm2, awgDiameterMm, voltageDrop, suggestAwg, AWG_SIZES,
} = calc;

/** assert |a-b| <= tol */
function near(actual, expected, tol = 1e-9, msg = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected} +/- ${tol}, got ${actual}`);
}
const throwsInput = (fn) => assert.throws(fn, (e) => e instanceof InputError && e instanceof RangeError);

describe('acoustics', () => {
  test('150 dB at 10 ft gives 130.0 dB at 100 ft', () => near(splAtDistance(150, 100), 130.0));
  test('same distance returns source', () => near(splAtDistance(118, 10), 118));
  test('closer than reference is louder', () => near(splAtDistance(150, 5), 150 + 20 * Math.log10(2)));
  test('metres and custom reference', () => near(splAtDistance(120, 10, { refDistance: 1, unit: 'm' }), 100));
  test('unit does not matter without absorption', () =>
    near(splAtDistance(140, 300, { unit: 'ft' }), splAtDistance(140, 300, { unit: 'm' })));
  test('absorption reduces level', () => {
    const plain = splAtDistance(150, 1010, { refDistance: 10, unit: 'm' });
    const absorbed = splAtDistance(150, 1010, { refDistance: 10, unit: 'm', absorptionDbPerKm: 2 });
    near(plain - absorbed, 2.0);
  });
  test('absorption converts feet', () => {
    const plain = splAtDistance(150, 3290.84);
    const absorbed = splAtDistance(150, 3290.84, { absorptionDbPerKm: 10 });
    near(plain - absorbed, (10 * (3290.84 - 10) * 0.3048) / 1000);
  });
  test('distanceForSpl known values', () => {
    near(distanceForSpl(150, 130), 100);
    near(distanceForSpl(150, 90), 10000, 1e-6);
  });
  test('round trip without absorption', () => {
    for (const [src, d] of [[150, 37.5], [118, 2.0], [153.2, 2500], [100, 10]]) {
      near(distanceForSpl(src, splAtDistance(src, d)), d, 1e-6);
    }
  });
  test('round trip with absorption', () => {
    for (const d of [3, 50, 800, 5000]) {
      const opts = { unit: 'm', absorptionDbPerKm: 3.7 };
      near(distanceForSpl(150, splAtDistance(150, d, opts), opts), d, d * 1e-9);
    }
  });
  test('absorption shortens distance', () =>
    assert.ok(distanceForSpl(150, 90, { absorptionDbPerKm: 1.9 }) < distanceForSpl(150, 90)));
  test('doubling and ratio loss', () => {
    near(dbDoublingLoss(), 6.0206, 5e-5);
    near(distanceRatioLoss(10), 20);
  });
  test('combine levels', () => {
    near(combineLevels([100, 100]), 100 + 10 * Math.log10(2));
    near(combineLevels([150]), 150);
    near(combineLevels([120, 90]), 120, 5e-3);
  });
  test('invalid inputs throw RangeError', () => {
    throwsInput(() => splAtDistance(150, 0));
    throwsInput(() => splAtDistance(150, -5));
    throwsInput(() => splAtDistance(150, 10, { refDistance: 0 }));
    throwsInput(() => splAtDistance(150, 10, { unit: 'yd' }));
    throwsInput(() => splAtDistance('loud', 10));
    throwsInput(() => splAtDistance(NaN, 10));
    throwsInput(() => splAtDistance(Infinity, 10));
    throwsInput(() => splAtDistance(150, 10, { absorptionDbPerKm: -1 }));
    throwsInput(() => splAtDistance(true, 10));
    throwsInput(() => splAtDistance(null, 10));
    throwsInput(() => combineLevels([]));
    throwsInput(() => distanceForSpl(150, -1e6));
  });
  test('numeric strings are accepted', () => {
    near(splAtDistance('150', '100'), 130);
    near(splAtDistance(150, 100, { unit: ' FT ' }), 130);
  });
});

describe('air system', () => {
  test('free air known value', () => near(freeAirVolumeCuft(1, 14.696, 0), 231 / 1728));
  test('runtime known value', () => {
    const expected = ((5 * 231) / 1728) * 40 / 14.696 / 10 * 60;
    near(tankRuntimeSeconds(5, 150, 110, 10), expected);
    near(expected, 10.916, 5e-4);
  });
  test('runtime scales linearly', () => {
    const base = tankRuntimeSeconds(2, 150, 120, 5);
    near(tankRuntimeSeconds(4, 150, 120, 5), 2 * base);
    near(tankRuntimeSeconds(2, 150, 120, 10), base / 2);
    near(tankRuntimeSeconds(2, 150, 90, 5), 2 * base);
  });
  test('altitude gives more free air', () =>
    assert.ok(tankRuntimeSeconds(5, 150, 110, 10, 12.2) > tankRuntimeSeconds(5, 150, 110, 10)));
  test('blast count', () => {
    assert.equal(blastCount(10, 2), 5);
    assert.equal(blastCount(10.9, 2), 5);
    assert.equal(blastCount(0, 1.5), 0);
    assert.equal(blastCount(0.3 * 3, 0.3), 3);
  });
  test('recovery constant flow', () =>
    near(compressorRecoverySeconds(2, 110, 150, 1.0), ((2 * 231) / 1728) * 40 / 14.696 / 1.0 * 60));
  test('recovery equals runtime with same cfm', () =>
    near(compressorRecoverySeconds(3, 120, 150, 2.5), tankRuntimeSeconds(3, 150, 120, 2.5)));
  test('recovery linear model', () => {
    const flat = compressorRecoverySeconds(2, 110, 150, 1, { cfmAtZeroPsi: 1, ratedPsi: 150 });
    near(flat, compressorRecoverySeconds(2, 110, 150, 1));
    const t = compressorRecoverySeconds(2, 110, 150, 1, { cfmAtZeroPsi: 2, ratedPsi: 150 });
    const v = (2 * 231) / 1728 / 14.696;
    const steps = 20000;
    const dp = 40 / steps;
    let numeric = 0;
    for (let i = 0; i < steps; i++) numeric += (v * dp) / (2 - (110 + (i + 0.5) * dp) / 150);
    near(t, numeric * 60, 5e-5);
    assert.ok(t < compressorRecoverySeconds(2, 110, 150, 1));
  });
  test('invalid air inputs throw RangeError', () => {
    throwsInput(() => tankRuntimeSeconds(0, 150, 110, 10));
    throwsInput(() => tankRuntimeSeconds(5, 110, 150, 10));
    throwsInput(() => tankRuntimeSeconds(5, 150, 150, 10));
    throwsInput(() => tankRuntimeSeconds(5, 150, -1, 10));
    throwsInput(() => tankRuntimeSeconds(5, 150, 110, 0));
    throwsInput(() => compressorRecoverySeconds(2, 110, 150, 1, { cfmAtZeroPsi: 2 }));
    throwsInput(() => compressorRecoverySeconds(2, 110, 150, 1, { cfmAtZeroPsi: 0.5, ratedPsi: 150 }));
    throwsInput(() => compressorRecoverySeconds(2, 110, 150, 0.1, { cfmAtZeroPsi: 5, ratedPsi: 100 }));
    throwsInput(() => blastCount(10, 0));
  });
});

describe('electrical', () => {
  test('resistance matches published tables within 1 %', () => {
    const published = { 14: 2.525, 12: 1.588, 10: 0.9989, 8: 0.6282, 4: 0.2485, '1/0': 0.09827 };
    for (const [awg, ohms] of Object.entries(published)) {
      near(awgResistanceOhmPer1000ft(awg), ohms, ohms * 0.01, `AWG ${awg}`);
    }
  });
  test('three gauges doubles area', () => near(awgAreaMm2(7) / awgAreaMm2(10), 2, 0.01));
  test('awg label forms', () => {
    assert.equal(awgDiameterMm('1/0'), awgDiameterMm('0'));
    assert.equal(awgDiameterMm('4/0'), awgDiameterMm('0000'));
    assert.equal(awgDiameterMm(10), awgDiameterMm('10 AWG'));
    near(awgDiameterMm('4/0'), 11.684, 5e-3);
  });
  test('temperature raises resistance', () =>
    near(awgResistanceOhmPer1000ft(10, 70), awgResistanceOhmPer1000ft(10) * (1 + 0.00393 * 50)));
  test('voltage drop known value', () => {
    const drop = voltageDrop(20, 10, 10);
    near(drop, 20 * awgResistanceOhmPer1000ft(10) * 0.02);
    near(drop, 0.3995, 5e-4);
  });
  test('voltage drop in metres', () => near(voltageDrop(20, 3.048, 10, { unit: 'm' }), voltageDrop(20, 10, 10)));
  test('suggestAwg known values', () => {
    assert.equal(suggestAwg(30, 10).awg, '6');
    assert.equal(suggestAwg(30, 10, { systemVoltage: 24 }).awg, '10');
    assert.equal(suggestAwg(5, 3).awg, '18');
  });
  test('suggestion is minimal and within budget', () => {
    for (const [a, l, v] of [[30, 10, 12], [15, 20, 12], [40, 6, 24], [100, 15, 12]]) {
      const s = suggestAwg(a, l, { systemVoltage: v });
      assert.ok(s.voltageDropPct <= 3);
      const idx = AWG_SIZES.indexOf(s.awg);
      if (idx > 0) assert.ok((voltageDrop(a, l, AWG_SIZES[idx - 1]) / v) * 100 > 3);
    }
  });
  test('impossible load throws', () => throwsInput(() => suggestAwg(1000, 200)));
  test('invalid electrical inputs throw RangeError', () => {
    for (const bad of ['5/0', 'abc', -1, 41, true, 10.5]) throwsInput(() => awgDiameterMm(bad));
    throwsInput(() => suggestAwg(0, 10));
    throwsInput(() => suggestAwg(10, 10, { maxDropPct: 0 }));
    throwsInput(() => suggestAwg(10, 10, { maxDropPct: 60 }));
    throwsInput(() => suggestAwg(10, 10, { systemVoltage: -12 }));
    throwsInput(() => awgResistanceOhmPer1000ft(10, 500));
  });
});
