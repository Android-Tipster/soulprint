// persona.js — the companion identity schema, completeness scoring, and
// serialization for .soulprint backup files. Pure, zero-dependency, runs in
// both Node (tests) and the browser. This is the canonical shape of a
// companion; every other module reads or writes this object.

// A fresh, empty companion. id/createdAt are filled by the caller so this stays
// pure (no Date.now / random inside the factory used by tests).
export function emptyPersona() {
  return {
    id: '',
    name: '',
    pronouns: '',
    essence: '',            // one-line "who they are"
    avatarColor: '#7c5cff',
    personality: '',
    voice: '',              // speech style / how they talk
    values: '',
    quirks: '',
    backstory: '',
    scenario: '',
    relationship: '',       // dynamic with the user
    petNames: [],           // terms of endearment they use for you
    greeting: '',
    altGreetings: [],
    examples: [],           // representative in-voice messages
    topics: [],             // recurring things you two talk about
    fingerprint: [],        // characteristic vocabulary
    memories: [],           // [{date, title, note}]
    tags: [],
    sourcePlatform: '',
    createdAt: '',
    updatedAt: ''
  };
}

// Fields that contribute to the completeness meter, with weights. The meter is
// a gentle nudge to keep filling the bible (retention), not a gate.
const COMPLETENESS_FIELDS = [
  ['name', 10, v => !!str(v).trim()],
  ['essence', 8, v => str(v).trim().length >= 8],
  ['personality', 16, v => str(v).trim().length >= 25],
  ['voice', 12, v => str(v).trim().length >= 15],
  ['backstory', 10, v => str(v).trim().length >= 25],
  ['relationship', 10, v => str(v).trim().length >= 15],
  ['greeting', 10, v => str(v).trim().length >= 10],
  ['examples', 12, v => Array.isArray(v) && v.length >= 1],
  ['petNames', 4, v => Array.isArray(v) && v.length >= 1],
  ['scenario', 4, v => str(v).trim().length >= 10],
  ['memories', 4, v => Array.isArray(v) && v.length >= 1]
];

// 0..100 integer. Sum of the weights of the fields that clear their bar.
export function completeness(p) {
  if (!p) return 0;
  let got = 0, total = 0;
  for (const [key, weight, ok] of COMPLETENESS_FIELDS) {
    total += weight;
    if (ok(p[key])) got += weight;
  }
  return Math.round((got / total) * 100);
}

// Human label for a completeness number — used in the UI badge.
export function completenessLabel(pct) {
  if (pct >= 90) return 'Fully realized';
  if (pct >= 65) return 'Well developed';
  if (pct >= 35) return 'Taking shape';
  if (pct > 0) return 'Just a sketch';
  return 'Empty';
}

// Serialize one or many companions into the on-disk .soulprint backup shape.
export function serializeVault(companions) {
  return {
    app: 'soulprint',
    format: 1,
    exportedAt: new Date().toISOString(),
    companions: (companions || []).map(normalizePersona)
  };
}

// Parse a .soulprint file back into an array of companions. Tolerant of a
// single-companion file and of missing fields (merges onto emptyPersona).
export function deserializeVault(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a Soulprint file');
  let list;
  if (Array.isArray(obj.companions)) list = obj.companions;
  else if (obj.app === 'soulprint' && obj.companion) list = [obj.companion];
  else if (obj.name || obj.personality) list = [obj]; // bare persona
  else throw new Error('No companions found in file');
  return list.map(normalizePersona);
}

// Fill any missing fields so older/partial objects round-trip safely.
export function normalizePersona(p) {
  const base = emptyPersona();
  const out = Object.assign(base, p || {});
  for (const k of ['petNames', 'altGreetings', 'examples', 'topics', 'fingerprint', 'tags']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!Array.isArray(out.memories)) out.memories = [];
  return out;
}

function str(v) { return v == null ? '' : String(v); }
