# trainhorn-mcp

A small, dependency-free [Model Context Protocol](https://modelcontextprotocol.io/) server with **train horn calculators**.
It lets an assistant compute (instead of guess) how loud a horn is at a distance, how long an air tank lasts,
how fast a compressor refills it and which wire gauge a 12/24 V run needs.

- Local stdio server, Node 18+, no dependencies, no network access, nothing stored.
- 5 read-only tools, each with a JSON schema, input validation, a plain-text answer, structured JSON and an **assumptions** note.
- 1 resource: a short "horn law basics" note (US, general information, **not legal advice**).
- The maths is a port of the tested `trainhorn-calc` core behind the
  [Train Horn calculators](https://train-horn.com/tools/); the tests check the same reference vectors.

Registry name: `io.github.train-horn/trainhorn-mcp`

## Install

### Claude Desktop (one click)
Download `trainhorn-mcp.mcpb` from the [latest release](https://github.com/train-horn/trainhorn-mcp/releases/latest)
and open it (or drag it into Settings > Extensions).

### Any MCP client (stdio)
```bash
git clone https://github.com/train-horn/trainhorn-mcp.git
```
```json
{
  "mcpServers": {
    "trainhorn": {
      "command": "node",
      "args": ["/absolute/path/to/trainhorn-mcp/server/index.js"]
    }
  }
}
```
Claude Code: `claude mcp add trainhorn -- node /absolute/path/to/trainhorn-mcp/server/index.js`

## Tools

| Tool | What it answers | Required inputs (optional) |
|---|---|---|
| `spl_at_distance` | Level in dB at a distance from a rated figure such as "150 dB at 10 ft" | `source_db`, `distance` (`ref_distance`=10, `unit`=ft\|m, `absorption_db_per_km` or `frequency_hz`) |
| `distance_for_level` | Distance at which the horn falls to a target level | `source_db`, `target_db` (same options) |
| `air_tank_runtime` | Seconds of horn time from a tank, free air used, number of blasts | `tank_gallons`, `start_psi`, `cutoff_psi`, `horn_cfm` (`blast_seconds`=2, `atmospheric_psi`) |
| `compressor_recovery` | Seconds to refill from cut-in to cut-out pressure | `tank_gallons`, `cut_in_psi`, `cut_out_psi`, `compressor_cfm` (`cfm_at_zero_psi` + `rated_psi` for the linear model) |
| `wire_gauge` | Smallest copper AWG within a voltage-drop budget, or check your gauge | `amps`, `one_way_length` (`system_voltage`=12, `max_drop_pct`=3, `unit`, `temperature_c`, `check_awg`) |

Resource: `trainhorn://notes/horn-law-basics` (text/markdown).

### Formulas and assumptions
- **Sound level:** `L = L_ref - 20*log10(d / d_ref) - alpha*(d - d_ref)/1000` (free field, point source; `alpha` in dB/km from ISO 9613 at 10 degC / 70 % RH when you pass `frequency_hz`). No ground effect, barriers or weather. The source level is whatever you enter, often a maker's claim: the result is an estimate, not a measurement and not a legal noise assessment.
- **Air tank:** free air `= gallons * 0.13368 * (P_start - P_cutoff) / 14.696` cu ft; runtime `= free air / CFM * 60` s. Isothermal, constant consumption, compressor off.
- **Compressor:** constant flow `t = free air / CFM * 60`, or delivery falling linearly with pressure. No leaks, duty cycle or heat.
- **Wire:** copper resistance from the AWG formula at the given temperature, two-wire run. Sizing is by **voltage drop only**: it does not check ampacity or fuse size.

## Examples

```text
spl_at_distance {"source_db": 150, "distance": 100}
-> 150 dB at 10 ft -> about 130 dB at 100 ft (-20 dB).

distance_for_level {"source_db": 150, "target_db": 90}
-> 150 dB at 10 ft falls to 90 dB at about 10000 ft (3048 m).

air_tank_runtime {"tank_gallons": 5, "start_psi": 150, "cutoff_psi": 110, "horn_cfm": 10}
-> about 10.92 s of horn time (1.819 cu ft of free air), 5 blast(s) of 2 s.

compressor_recovery {"tank_gallons": 2, "cut_in_psi": 110, "cut_out_psi": 150, "compressor_cfm": 1}
-> about 43.7 s (0.73 min).

wire_gauge {"amps": 30, "one_way_length": 10, "check_awg": "10"}
-> use 6 AWG copper or thicker (drop 0.237 V = 1.98 %, budget 3 %). Your 10 AWG: drop 0.599 V (4.99 %), over budget.
```
Each text answer ends with its assumptions; `structuredContent` carries the same numbers as JSON.

## Tests

```bash
npm test   # node --test: core reference vectors, every tool, and an MCP stdio smoke test
```
The protocol test starts the server and runs `initialize`, `tools/list`, `tools/call` and `resources/read` over stdio.
Releases are built and published by `.github/workflows/release.yml` (tests, MCPB pack, MCP Registry via GitHub OIDC).

## About

Made by [Train Horn](https://train-horn.com/), an independent US reference on train horns (not a store).
The calculators give estimates; the law note is general information, not legal advice.

License: MIT
