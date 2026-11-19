// Unit tests: every tool against the core reference vectors (trainhorn-calc). Run: node --test test/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, callTool, validateArgs } from '../server/tools.js';
import { RESOURCES, readResource } from '../server/resources.js';

const near = (a, e, tol = 1e-9) => assert.ok(Math.abs(a - e) <= tol, `expected ${e} +/- ${tol}, got ${a}`);
function ok(name, args) {
  const r = callTool(name, args);
  assert.equal(r.isError, false, r.content[0].text);
  assert.equal(r.content[0].type, 'text');
  assert.match(r.content[0].text, /Assumptions:/);
  assert.ok(Array.isArray(r.structuredContent.assumptions) && r.structuredContent.assumptions.length > 0);
  return r;
}
function bad(name, args, re) {
  const r = callTool(name, args);
  assert.equal(r.isError, true, `expected an error for ${JSON.stringify(args)}`);
  assert.match(r.content[0].text, /^Invalid input: /);
  if (re) assert.match(r.content[0].text, re);
}

describe('tool catalogue', () => {
  test('five tools with object schemas', () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ['spl_at_distance', 'distance_for_level', 'air_tank_runtime', 'compressor_recovery', 'wire_gauge']);
    for (const t of TOOLS) {
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(t.inputSchema.additionalProperties, false);
      for (const r of t.inputSchema.required) assert.ok(r in t.inputSchema.properties);
      assert.ok(t.description.length > 40 && t.title);
    }
  });
  test('unknown tool returns null', () => assert.equal(callTool('nope', {}), null));
});

describe('spl_at_distance', () => {
  test('150 dB @10 ft -> 130.0 dB @100 ft', () => {
    const r = ok('spl_at_distance', { source_db: 150, distance: 100 });
    assert.equal(r.structuredContent.level_db, 130.0);
    assert.equal(r.structuredContent.change_db, -20);
    assert.match(r.content[0].text, /about 130 dB at 100 ft/);
  });
  test('metres with 1 m reference', () => {
    assert.equal(ok('spl_at_distance', { source_db: 120, distance: 10, ref_distance: 1, unit: 'm' }).structuredContent.level_db, 100);
  });
  test('closer than reference is louder (+6.02 dB at half distance)', () => {
    assert.equal(ok('spl_at_distance', { source_db: 150, distance: 5 }).structuredContent.level_db, 156.0);
  });
  test('absorption: 2 dB/km over 1 km removes 2 dB', () => {
    const plain = ok('spl_at_distance', { source_db: 150, distance: 1010, unit: 'm' }).structuredContent.level_db;
    const abs = ok('spl_at_distance', { source_db: 150, distance: 1010, unit: 'm', absorption_db_per_km: 2 }).structuredContent.level_db;
    near(plain - abs, 2.0, 0.051);
  });
  test('frequency_hz sets absorption from the ISO table', () => {
    assert.equal(ok('spl_at_distance', { source_db: 150, distance: 1000, frequency_hz: 500 }).structuredContent.absorption_db_per_km, 1.9);
  });
  test('numeric strings and unit case are accepted', () => {
    assert.equal(ok('spl_at_distance', { source_db: '150', distance: '100', unit: ' FT ' }).structuredContent.level_db, 130);
  });
  test('invalid input is a tool error, not a crash', () => {
    bad('spl_at_distance', { source_db: 150 }, /missing required argument "distance"/);
    bad('spl_at_distance', { source_db: 150, distance: 0 }, /distance/);
    bad('spl_at_distance', { source_db: 150, distance: -5 });
    bad('spl_at_distance', { source_db: 150, distance: 10, unit: 'yd' }, /unit/);
    bad('spl_at_distance', { source_db: 'loud', distance: 10 }, /source_db/);
    bad('spl_at_distance', { source_db: true, distance: 10 });
    bad('spl_at_distance', { source_db: 150, distance: 10, absorption_db_per_km: -1 });
    bad('spl_at_distance', { source_db: 150, distance: 10, frequency_hz: 300 }, /frequency_hz/);
    bad('spl_at_distance', { source_db: 150, distance: 10, frequency_hz: 500, absorption_db_per_km: 1 }, /not both/);
    bad('spl_at_distance', { source_db: 150, distance: 10, volume: 11 }, /unknown argument "volume"/);
    bad('spl_at_distance', [150, 10], /object/);
  });
});

describe('distance_for_level', () => {
  test('150 dB @10 ft falls to 130 dB at 100 ft and to 90 dB at 10,000 ft', () => {
    assert.equal(ok('distance_for_level', { source_db: 150, target_db: 130 }).structuredContent.distance, 100);
    const r = ok('distance_for_level', { source_db: 150, target_db: 90 });
    assert.equal(r.structuredContent.distance, 10000);
    assert.deepEqual(r.structuredContent.distance_other_unit, { distance: 3048, unit: 'm' });
  });
  test('round trip with spl_at_distance, with absorption', () => {
    const lvl = callTool('spl_at_distance', { source_db: 150, distance: 800, unit: 'm', absorption_db_per_km: 3.7 });
    // use the unrounded level via the core-equivalent text-free path: recompute with distance_for_level at the rounded level
    const d = ok('distance_for_level', { source_db: 150, target_db: lvl.structuredContent.level_db, unit: 'm', absorption_db_per_km: 3.7 }).structuredContent.distance;
    near(d, 800, 800 * 0.012); // level rounded to 0.1 dB => about 1 % in distance
  });
  test('absorption shortens the distance', () => {
    const a = ok('distance_for_level', { source_db: 150, target_db: 90, frequency_hz: 500 }).structuredContent.distance;
    assert.ok(a < 10000);
  });
  test('invalid input', () => {
    bad('distance_for_level', { source_db: 150 }, /target_db/);
    bad('distance_for_level', { source_db: 150, target_db: 90, ref_distance: 0 });
    bad('distance_for_level', { source_db: 150, target_db: -1e6 }, /too far apart/);
  });
});

describe('air_tank_runtime', () => {
  test('5 gal, 150 -> 110 psi, 10 CFM gives about 10.92 s and 5 blasts of 2 s', () => {
    const r = ok('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: 110, horn_cfm: 10 });
    const expected = ((5 * 231) / 1728) * 40 / 14.696 / 10 * 60;
    near(r.structuredContent.runtime_seconds, expected, 0.005);
    near(r.structuredContent.runtime_seconds, 10.92, 0.001);
    assert.equal(r.structuredContent.blasts, 5);
  });
  test('blast length and altitude', () => {
    assert.equal(ok('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: 110, horn_cfm: 10, blast_seconds: 1 }).structuredContent.blasts, 10);
    const sea = ok('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: 110, horn_cfm: 10 }).structuredContent.runtime_seconds;
    const high = ok('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: 110, horn_cfm: 10, atmospheric_psi: 12.2 }).structuredContent.runtime_seconds;
    assert.ok(high > sea);
  });
  test('invalid input', () => {
    bad('air_tank_runtime', { tank_gallons: 5, start_psi: 110, cutoff_psi: 150, horn_cfm: 10 }, /must be greater than cutoffPsi/);
    bad('air_tank_runtime', { tank_gallons: 0, start_psi: 150, cutoff_psi: 110, horn_cfm: 10 });
    bad('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: -1, horn_cfm: 10 });
    bad('air_tank_runtime', { tank_gallons: 5, start_psi: 150, cutoff_psi: 110 }, /horn_cfm/);
  });
});

describe('compressor_recovery', () => {
  test('2 gal, 110 -> 150 psi at 1.0 CFM: about 43.7 s', () => {
    const r = ok('compressor_recovery', { tank_gallons: 2, cut_in_psi: 110, cut_out_psi: 150, compressor_cfm: 1 });
    near(r.structuredContent.recovery_seconds, ((2 * 231) / 1728) * 40 / 14.696 * 60, 0.05);
    assert.equal(r.structuredContent.recovery_seconds, 43.7);
    assert.equal(r.structuredContent.model, 'constant');
  });
  test('linear model is faster when output at 0 psi is higher', () => {
    const r = ok('compressor_recovery', { tank_gallons: 2, cut_in_psi: 110, cut_out_psi: 150, compressor_cfm: 1, cfm_at_zero_psi: 2, rated_psi: 150 });
    assert.equal(r.structuredContent.model, 'linear');
    assert.ok(r.structuredContent.recovery_seconds < 43.7);
  });
  test('invalid input', () => {
    bad('compressor_recovery', { tank_gallons: 2, cut_in_psi: 110, cut_out_psi: 150, compressor_cfm: 1, cfm_at_zero_psi: 2 }, /together/);
    bad('compressor_recovery', { tank_gallons: 2, cut_in_psi: 150, cut_out_psi: 110, compressor_cfm: 1 });
    bad('compressor_recovery', { tank_gallons: 2, cut_in_psi: 110, cut_out_psi: 150, compressor_cfm: 0 });
  });
});

describe('wire_gauge', () => {
  test('core vectors: 30 A / 10 ft -> 6 AWG at 12 V, 10 AWG at 24 V; 5 A / 3 ft -> 18 AWG', () => {
    assert.equal(ok('wire_gauge', { amps: 30, one_way_length: 10 }).structuredContent.awg, '6');
    assert.equal(ok('wire_gauge', { amps: 30, one_way_length: 10, system_voltage: 24 }).structuredContent.awg, '10');
    assert.equal(ok('wire_gauge', { amps: 5, one_way_length: 3 }).structuredContent.awg, '18');
  });
  test('check_awg: 20 A over 10 ft on 10 AWG drops about 0.3995 V', () => {
    const r = ok('wire_gauge', { amps: 20, one_way_length: 10, check_awg: 10 });
    near(r.structuredContent.check.voltage_drop_v, 0.3995, 6e-4);
    assert.equal(r.structuredContent.check.within_budget, false);
    assert.equal(ok('wire_gauge', { amps: 20, one_way_length: 10, check_awg: '4/0' }).structuredContent.check.within_budget, true);
  });
  test('metres equal feet', () => {
    const ft = ok('wire_gauge', { amps: 20, one_way_length: 10, check_awg: 10 }).structuredContent.check.voltage_drop_v;
    const m = ok('wire_gauge', { amps: 20, one_way_length: 3.048, unit: 'm', check_awg: 10 }).structuredContent.check.voltage_drop_v;
    assert.equal(ft, m);
  });
  test('impossible load: error, or a note when checking a gauge', () => {
    bad('wire_gauge', { amps: 1000, one_way_length: 200 }, /no gauge up to 4\/0/);
    const r = ok('wire_gauge', { amps: 1000, one_way_length: 200, check_awg: '4/0' });
    assert.equal(r.structuredContent.awg, null);
    assert.equal(r.structuredContent.check.within_budget, false);
  });
  test('invalid input', () => {
    bad('wire_gauge', { amps: 0, one_way_length: 10 });
    bad('wire_gauge', { amps: 30, one_way_length: 10, max_drop_pct: 60 }, /<= 50/);
    bad('wire_gauge', { amps: 30, one_way_length: 10, check_awg: '7/0' }, /AWG/);
    bad('wire_gauge', { amps: 30, one_way_length: 10, temperature_c: 500 });
  });
});

describe('validateArgs', () => {
  test('fills defaults and rejects wrong types', () => {
    const schema = TOOLS[0].inputSchema;
    assert.deepEqual(validateArgs(schema, { source_db: 1, distance: 2 }), { source_db: 1, distance: 2, ref_distance: 10, unit: 'ft' });
    assert.throws(() => validateArgs(schema, { source_db: 1, distance: 'x' }), /must be number/);
    assert.throws(() => validateArgs(schema, 'text'), /object/);
  });
});

describe('resource', () => {
  test('horn law basics note says it is not legal advice', () => {
    assert.equal(RESOURCES.length, 1);
    const r = readResource('trainhorn://notes/horn-law-basics');
    assert.equal(r.mimeType, 'text/markdown');
    assert.match(r.text, /not legal advice/);
    assert.equal(readResource('trainhorn://nope'), null);
  });
});
