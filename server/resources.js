// One read-only resource: a short, plain-English note on how horn rules work in the US.
const HORN_LAW_BASICS = `# Horn law basics (US) - not legal advice

This is a general orientation written for people adding a loud air horn or "train horn" to a car or truck.
It is not legal advice, it is not complete, and rules change. Check your state's vehicle code and your local
noise ordinance, or ask a lawyer or your state DMV, before you rely on anything here.

## Who makes the rules
- Horns on private road vehicles are mostly regulated by each state's vehicle code, not by federal law.
- Cities and counties add noise ordinances (quiet hours, decibel limits at a property line, "disturbing the peace").
- Real locomotive horns are a separate, federal topic: the Federal Railroad Administration sets minimum and
  maximum horn levels for locomotives and the rules for sounding them at grade crossings and in quiet zones.
  Those rules apply to railroads, not to your pickup.

## Patterns you will see in state vehicle codes
- A working horn is required, usually one audible from a stated distance under normal conditions.
- Many codes say a horn must not make an "unreasonably loud or harsh" sound, without giving a dB number.
  Whether a train horn crosses that line is up to the officer and, in the end, a court.
- The horn may be used only as a reasonable warning; using it to harass or "for fun" can be a separate offence.
- Sirens and some multi-tone or emergency-style devices are reserved for authorised emergency vehicles.
- Installing an air horn is often legal while sounding it on public roads is restricted; a common setup keeps
  the stock horn wired as the primary horn.

## Using the numbers from this server
- spl_at_distance and distance_for_level give estimates from the level you enter (often a maker's claim
  measured close to the horn). They are not a compliance measurement.
- A noise ordinance limit is usually measured at a property line or a set distance with a sound level meter,
  often A-weighted (dBA). A claimed "150 dB" horn figure is not directly comparable.

More background and per-state summaries: https://train-horn.com/ (an independent reference site; it does not sell horns).
`;

export const RESOURCES = [
  {
    uri: 'trainhorn://notes/horn-law-basics',
    name: 'horn-law-basics',
    title: 'Horn law basics (US, not legal advice)',
    description: 'How US horn rules are layered (state vehicle codes, local noise ordinances, federal locomotive rules) and how to read dB estimates. General information only, not legal advice.',
    mimeType: 'text/markdown',
    text: HORN_LAW_BASICS,
  },
];

/** Return a resource content object for `uri`, or null. */
export function readResource(uri) {
  const r = RESOURCES.find((x) => x.uri === uri);
  return r ? { uri: r.uri, mimeType: r.mimeType, text: r.text } : null;
}
