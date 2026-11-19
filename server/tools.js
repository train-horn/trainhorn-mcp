// Tool definitions for trainhorn-mcp: JSON schemas, argument validation and result formatting.
// The maths lives in ./core.js (port of the tested trainhorn-calc core); this file only adapts it to MCP.
import * as core from './core.js';

/** Error for bad tool arguments (reported to the client as a tool error, isError: true). */
export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const FREQUENCIES = Object.keys(core.AIR_ABSORPTION_DB_PER_KM).map(Number);

const n = (description, extra = {}) => ({ type: 'number', description, ...extra });
const unitProp = { type: 'string', enum: ['ft', 'm'], default: 'ft', description: 'Length unit for distances: ft (default) or m' };
const absorptionProps = {
  absorption_db_per_km: n('Optional air absorption in dB/km (0 = none, the default). Do not combine with frequency_hz.', { minimum: 0 }),
  frequency_hz: {
    type: 'integer',
    enum: FREQUENCIES,
    description: 'Optional octave band (63-8000 Hz). Sets absorption_db_per_km from the ISO 9613 table at 10 degC / 70 % RH. Most train horn chords sit in the 250-500 Hz bands.',
  },
};

/**
 * Validate `args` against a (small subset of) JSON Schema: object, required, additionalProperties:false,
 * type number/integer/string/boolean, enum, minimum, exclusiveMinimum, maximum.
 * Returns a copy with defaults filled in.
 */
export function validateArgs(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError('arguments must be an object');
  const out = {};
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) {
      throw new ToolInputError(`unknown argument "${key}"; allowed: ${Object.keys(schema.properties).join(', ')}`);
    }
  }
  for (const name of schema.required || []) {
    if (args[name] === undefined || args[name] === null) throw new ToolInputError(`missing required argument "${name}"`);
  }
  for (const [name, spec] of Object.entries(schema.properties)) {
    let v = args[name];
    if (v === undefined || v === null) {
      if (spec.default !== undefined) out[name] = spec.default;
      continue;
    }
    const types = Array.isArray(spec.type) ? spec.type : [spec.type];
    // Accept numeric strings for numeric fields: some clients send "150".
    if ((types.includes('number') || types.includes('integer')) && typeof v === 'string' && !types.includes('string')) {
      const t = v.trim();
      if (t !== '' && Number.isFinite(Number(t))) v = Number(t);
    }
    const ok = types.some((t) => {
      if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
      if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
      if (t === 'string') return typeof v === 'string';
      if (t === 'boolean') return typeof v === 'boolean';
      return false;
    });
    if (!ok) throw new ToolInputError(`"${name}" must be ${types.join(' or ')}, got ${JSON.stringify(args[name])}`);
    if (typeof v === 'string' && spec.enum) v = v.trim().toLowerCase();
    if (spec.enum && !spec.enum.includes(v)) {
      throw new ToolInputError(`"${name}" must be one of ${spec.enum.join(', ')}; got ${JSON.stringify(args[name])}`);
    }
    if (typeof v === 'number') {
      if (spec.minimum !== undefined && v < spec.minimum) throw new ToolInputError(`"${name}" must be >= ${spec.minimum}, got ${v}`);
      if (spec.exclusiveMinimum !== undefined && v <= spec.exclusiveMinimum) {
        throw new ToolInputError(`"${name}" must be > ${spec.exclusiveMinimum}, got ${v}`);
      }
      if (spec.maximum !== undefined && v > spec.maximum) throw new ToolInputError(`"${name}" must be <= ${spec.maximum}, got ${v}`);
    }
    out[name] = v;
  }
  return out;
}

const r = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function absorption(a) {
  if (a.frequency_hz !== undefined && a.absorption_db_per_km !== undefined) {
    throw new ToolInputError('give either absorption_db_per_km or frequency_hz, not both');
  }
  if (a.frequency_hz !== undefined) return core.AIR_ABSORPTION_DB_PER_KM[a.frequency_hz];
  return a.absorption_db_per_km ?? 0;
}

const SPL_ASSUMPTIONS = [
  'Free field, point source: the level falls 20*log10(distance ratio), about 6 dB per doubling of distance.',
  'No ground reflection, barriers, wind or temperature gradients. Real levels outdoors often differ by several dB.',
  'Air absorption is applied only when you ask for it (absorption_db_per_km or frequency_hz).',
  'The source level is the figure you give (often a manufacturer claim). This is an estimate, not a measurement and not a legal noise assessment.',
];

export const TOOLS = [
  {
    name: 'spl_at_distance',
    title: 'Horn loudness at a distance',
    description:
      'Estimate the sound pressure level (dB) of a horn at a given distance from a level known at a reference distance, e.g. "150 dB at 10 ft" -> 130 dB at 100 ft. Inverse-square law with optional air absorption.',
    inputSchema: {
      type: 'object',
      properties: {
        source_db: n('Known level in dB at ref_distance, e.g. 150'),
        distance: n('Distance at which to estimate the level (> 0)', { exclusiveMinimum: 0 }),
        ref_distance: n('Distance at which source_db applies (default 10)', { exclusiveMinimum: 0, default: 10 }),
        unit: unitProp,
        ...absorptionProps,
      },
      required: ['source_db', 'distance'],
      additionalProperties: false,
    },
    run(a) {
      const alpha = absorption(a);
      const level = core.splAtDistance(a.source_db, a.distance, { refDistance: a.ref_distance, unit: a.unit, absorptionDbPerKm: alpha });
      const data = {
        level_db: r(level, 1),
        source_db: a.source_db,
        ref_distance: a.ref_distance,
        distance: a.distance,
        unit: a.unit,
        absorption_db_per_km: alpha,
        change_db: r(level - a.source_db, 2),
        assumptions: SPL_ASSUMPTIONS,
      };
      const text = `${a.source_db} dB at ${a.ref_distance} ${a.unit} -> about ${data.level_db} dB at ${a.distance} ${a.unit} (${data.change_db >= 0 ? '+' : ''}${data.change_db} dB${alpha ? `, incl. ${alpha} dB/km air absorption` : ''}).`;
      return { text, data };
    },
  },
  {
    name: 'distance_for_level',
    title: 'Distance where a horn drops to a level',
    description:
      'Find the distance at which a horn rated source_db at ref_distance falls to target_db (inverse of spl_at_distance), e.g. 150 dB at 10 ft falls to 90 dB at 10,000 ft.',
    inputSchema: {
      type: 'object',
      properties: {
        source_db: n('Known level in dB at ref_distance, e.g. 150'),
        target_db: n('Level to find the distance for, e.g. 90'),
        ref_distance: n('Distance at which source_db applies (default 10)', { exclusiveMinimum: 0, default: 10 }),
        unit: unitProp,
        ...absorptionProps,
      },
      required: ['source_db', 'target_db'],
      additionalProperties: false,
    },
    run(a) {
      const alpha = absorption(a);
      const d = core.distanceForSpl(a.source_db, a.target_db, { refDistance: a.ref_distance, unit: a.unit, absorptionDbPerKm: alpha });
      const other = a.unit === 'ft' ? { distance: r(d * core.METERS_PER_FOOT, 2), unit: 'm' } : { distance: r(d / core.METERS_PER_FOOT, 2), unit: 'ft' };
      const data = {
        distance: r(d, 2),
        unit: a.unit,
        distance_other_unit: other,
        source_db: a.source_db,
        target_db: a.target_db,
        ref_distance: a.ref_distance,
        absorption_db_per_km: alpha,
        assumptions: SPL_ASSUMPTIONS,
      };
      const text = `${a.source_db} dB at ${a.ref_distance} ${a.unit} falls to ${a.target_db} dB at about ${data.distance} ${a.unit} (${other.distance} ${other.unit})${alpha ? `, with ${alpha} dB/km air absorption` : ''}.`;
      return { text, data };
    },
  },
  {
    name: 'air_tank_runtime',
    title: 'Air tank horn runtime',
    description:
      'Seconds of continuous horn time an air tank gives between a start pressure and a cut-off pressure (Boyle\'s law), plus how many blasts of a given length fit.',
    inputSchema: {
      type: 'object',
      properties: {
        tank_gallons: n('Tank volume in US gallons, e.g. 5', { exclusiveMinimum: 0 }),
        start_psi: n('Tank gauge pressure when you start blowing, e.g. 150', { minimum: 0 }),
        cutoff_psi: n('Lowest gauge pressure at which the horn still sounds right, e.g. 110', { minimum: 0 }),
        horn_cfm: n('Horn air consumption in CFM of free air, e.g. 10', { exclusiveMinimum: 0 }),
        blast_seconds: n('Optional blast length in seconds to count blasts (default 2)', { exclusiveMinimum: 0, default: 2 }),
        atmospheric_psi: n('Ambient absolute pressure in psi (default 14.696, sea level); lower it at altitude', { exclusiveMinimum: 0, default: core.ATMOSPHERIC_PSI }),
      },
      required: ['tank_gallons', 'start_psi', 'cutoff_psi', 'horn_cfm'],
      additionalProperties: false,
    },
    run(a) {
      const secs = core.tankRuntimeSeconds(a.tank_gallons, a.start_psi, a.cutoff_psi, a.horn_cfm, a.atmospheric_psi);
      const free = core.freeAirVolumeCuft(a.tank_gallons, a.start_psi, a.cutoff_psi, a.atmospheric_psi);
      const blasts = core.blastCount(secs, a.blast_seconds);
      const data = {
        runtime_seconds: r(secs, 2),
        free_air_cuft: r(free, 3),
        blasts,
        blast_seconds: a.blast_seconds,
        tank_gallons: a.tank_gallons,
        start_psi: a.start_psi,
        cutoff_psi: a.cutoff_psi,
        horn_cfm: a.horn_cfm,
        assumptions: [
          'Isothermal expansion (Boyle\'s law) and a constant horn consumption: real runtime is usually a little shorter.',
          'The compressor is assumed off during the blast; if it runs, add its delivery.',
          'Horn CFM ratings vary by maker and pressure; use the figure for your horn and pressure.',
        ],
      };
      const text = `${a.tank_gallons} gal tank, ${a.start_psi} -> ${a.cutoff_psi} psi at ${a.horn_cfm} CFM: about ${data.runtime_seconds} s of horn time (${data.free_air_cuft} cu ft of free air), ${blasts} blast(s) of ${a.blast_seconds} s.`;
      return { text, data };
    },
  },
  {
    name: 'compressor_recovery',
    title: 'Compressor recovery time',
    description:
      'Seconds for a compressor to refill a tank from its cut-in to its cut-out pressure. Constant-flow model by default; give cfm_at_zero_psi and rated_psi together for a linear model where output falls with pressure.',
    inputSchema: {
      type: 'object',
      properties: {
        tank_gallons: n('Tank volume in US gallons', { exclusiveMinimum: 0 }),
        cut_in_psi: n('Gauge pressure at which the compressor switches on, e.g. 110', { minimum: 0 }),
        cut_out_psi: n('Gauge pressure at which it switches off, e.g. 150', { minimum: 0 }),
        compressor_cfm: n('Free-air delivery in CFM at the rated pressure, e.g. 1.0', { exclusiveMinimum: 0 }),
        cfm_at_zero_psi: n('Optional: delivery at 0 psi (linear model; needs rated_psi)', { exclusiveMinimum: 0 }),
        rated_psi: n('Optional: pressure at which compressor_cfm is rated (linear model; needs cfm_at_zero_psi)', { exclusiveMinimum: 0 }),
        atmospheric_psi: n('Ambient absolute pressure in psi (default 14.696)', { exclusiveMinimum: 0, default: core.ATMOSPHERIC_PSI }),
      },
      required: ['tank_gallons', 'cut_in_psi', 'cut_out_psi', 'compressor_cfm'],
      additionalProperties: false,
    },
    run(a) {
      const linear = a.cfm_at_zero_psi !== undefined || a.rated_psi !== undefined;
      const secs = core.compressorRecoverySeconds(a.tank_gallons, a.cut_in_psi, a.cut_out_psi, a.compressor_cfm, {
        cfmAtZeroPsi: a.cfm_at_zero_psi,
        ratedPsi: a.rated_psi,
        atmosphericPsi: a.atmospheric_psi,
      });
      const data = {
        recovery_seconds: r(secs, 1),
        recovery_minutes: r(secs / 60, 2),
        model: linear ? 'linear' : 'constant',
        tank_gallons: a.tank_gallons,
        cut_in_psi: a.cut_in_psi,
        cut_out_psi: a.cut_out_psi,
        compressor_cfm: a.compressor_cfm,
        assumptions: [
          linear
            ? 'Delivery falls linearly from cfm_at_zero_psi at 0 psi to compressor_cfm at rated_psi.'
            : 'Constant delivery equal to compressor_cfm across the pressure range (real compressors slow down as pressure rises, so this is optimistic).',
          'Isothermal fill, no leaks, no air used while filling; duty-cycle limits and heat are ignored.',
        ],
      };
      const text = `${a.tank_gallons} gal tank from ${a.cut_in_psi} to ${a.cut_out_psi} psi at ${a.compressor_cfm} CFM (${data.model} model): about ${data.recovery_seconds} s (${data.recovery_minutes} min).`;
      return { text, data };
    },
  },
  {
    name: 'wire_gauge',
    title: 'Wire gauge for a horn compressor or solenoid',
    description:
      'Smallest copper AWG that keeps the round-trip voltage drop within a budget (default 3 % of 12 V) for a given current and one-way run length. Optionally checks a gauge you already have.',
    inputSchema: {
      type: 'object',
      properties: {
        amps: n('Continuous load current in amps, e.g. 30', { exclusiveMinimum: 0 }),
        one_way_length: n('Distance from the battery/power source to the load (one way)', { exclusiveMinimum: 0 }),
        system_voltage: n('System voltage (default 12)', { exclusiveMinimum: 0, default: 12 }),
        max_drop_pct: n('Allowed voltage drop in percent (default 3)', { exclusiveMinimum: 0, maximum: 50, default: 3 }),
        unit: unitProp,
        temperature_c: n('Conductor temperature in degC (default 20)', { minimum: -60, maximum: 200, default: 20 }),
        check_awg: { type: ['string', 'integer'], description: 'Optional gauge to check, e.g. "10", 8 or "1/0"' },
      },
      required: ['amps', 'one_way_length'],
      additionalProperties: false,
    },
    run(a) {
      const opts = { systemVoltage: a.system_voltage, maxDropPct: a.max_drop_pct, unit: a.unit, temperatureC: a.temperature_c };
      let s = null;
      let noFit = null;
      try {
        s = core.suggestAwg(a.amps, a.one_way_length, opts);
      } catch (e) {
        if (!(e instanceof core.InputError) || a.check_awg === undefined || !/no gauge/.test(e.message)) throw e;
        noFit = e.message;
      }
      const data = {
        awg: s ? s.awg : null,
        voltage_drop_v: s ? r(s.voltageDropV, 3) : null,
        voltage_drop_pct: s ? r(s.voltageDropPct, 2) : null,
        allowed_drop_pct: a.max_drop_pct,
        system_voltage: a.system_voltage,
        amps: a.amps,
        one_way_length: a.one_way_length,
        unit: a.unit,
        assumptions: [
          'Copper conductor, two-wire run (out and back = 2 x one_way_length), resistance from the AWG formula at temperature_c.',
          'Sizing is by voltage drop only. It does NOT check ampacity, insulation rating or fuse size: fuse near the battery per the device maker.',
        ],
      };
      let text = s
        ? `${a.amps} A over ${a.one_way_length} ${a.unit} at ${a.system_voltage} V: use ${s.awg} AWG copper or thicker (drop ${data.voltage_drop_v} V = ${data.voltage_drop_pct} %, budget ${a.max_drop_pct} %).`
        : `No gauge up to 4/0 meets the ${a.max_drop_pct} % budget.`;
      if (a.check_awg !== undefined) {
        const drop = core.voltageDrop(a.amps, a.one_way_length, a.check_awg, { unit: a.unit, temperatureC: a.temperature_c });
        const pct = (drop / a.system_voltage) * 100;
        data.check = { awg: String(a.check_awg), voltage_drop_v: r(drop, 3), voltage_drop_pct: r(pct, 2), within_budget: pct <= a.max_drop_pct };
        text += ` Your ${a.check_awg} AWG: drop ${data.check.voltage_drop_v} V (${data.check.voltage_drop_pct} %), ${data.check.within_budget ? 'within' : 'over'} budget.`;
      }
      if (noFit) data.note = noFit;
      return { text, data };
    },
  },
];

/** Run a tool by name. Returns an MCP CallToolResult. Never throws for bad input. */
export function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    const a = validateArgs(tool.inputSchema, args);
    const { text, data } = tool.run(a);
    const full = `${text}\nAssumptions: ${data.assumptions.join(' ')}`;
    return { content: [{ type: 'text', text: full }], structuredContent: data, isError: false };
  } catch (e) {
    if (e instanceof ToolInputError || e instanceof core.InputError) {
      return { content: [{ type: 'text', text: `Invalid input: ${e.message}` }], isError: true };
    }
    throw e;
  }
}
