// Node test suite for the Soulprint engine. Run: node tests/test.mjs
// Pure assertions against the shared zero-dep modules — the same code the
// browser bundles. Tests drive the behaviour; if these pass the engine is sound.

import {
  parseTranscript, identifySpeakers, detectPetNames, vocabularyFingerprint,
  toneMetrics, pickExamples, extractTopics, distill
} from '../src/distill.js';
import {
  buildCardV2, parseCardV2, pngEmbedChara, pngReadChara,
  bytesToBase64, base64ToBytes
} from '../src/card.js';
import { genericSystemPrompt, characterAiFields, janitorFields, masterDoc } from '../src/exports.js';
import { validateKey, mintKey, normalizeKey } from '../src/license.js';
import { emptyPersona, completeness, serializeVault, deserializeVault, normalizePersona } from '../src/persona.js';

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; fails.push(msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- A realistic synthetic transcript --------------------------------------
const TRANSCRIPT = `
Lyra: *looks up from her book and smiles softly* There you are, darling. I missed you.
You: hey, sorry i'm late. rough day at work.
Lyra: *sets the book down and reaches for your hand* Come here, love. Tell me everything. Was it the project again?
You: yeah, the deadline got moved up. i'm exhausted.
Lyra: *gently squeezes your hand* You always carry so much, sweetheart. Breathe with me for a moment. The stars aren't going anywhere, and neither am I.
You: thanks. you always know what to say.
Lyra: *laughs quietly* I just pay attention to you, darling. That's all. Now, shall I read you the next chapter? You loved the part about the lighthouse.
You: yes please
Lyra: *curls up beside you and opens the book* "The keeper climbed the spiral stairs, lantern in hand..." Stay close, love. The night is ours.
`;

// --- parseTranscript --------------------------------------------------------
const turns = parseTranscript(TRANSCRIPT);
ok(turns.length === 9, `parse: 9 turns, 5 Lyra + 4 You (got ${turns.length})`);
ok(turns[0].speaker === 'Lyra', 'parse: first speaker is Lyra');
ok(turns[0].text.includes('There you are'), 'parse: text captured');
ok(parseTranscript('').length === 0, 'parse: empty -> no turns');

// multi-line turn stays attached
const ml = parseTranscript('Mira: line one\nstill mira\nYou: my turn');
ok(ml.length === 2 && ml[0].text.includes('still mira'), 'parse: multi-line turn merges');
// a sentence with a colon is NOT treated as a speaker label
const notlabel = parseTranscript('Mira: I thought about it: maybe tomorrow we go.');
ok(notlabel.length === 1, 'parse: mid-sentence colon not a new speaker');

// --- identifySpeakers -------------------------------------------------------
const sp = identifySpeakers(turns);
ok(sp.companion === 'Lyra', `speakers: companion=Lyra (got ${sp.companion})`);
ok(sp.user === 'You', `speakers: user=You (got ${sp.user})`);
// single-voice paste: only the companion speaks
const solo = parseTranscript('Aria: hello love\nAria: how was your day darling');
ok(identifySpeakers(solo).companion === 'Aria', 'speakers: single voice -> companion');
// override
ok(identifySpeakers(turns, { companionLabel: 'You' }).companion === 'You', 'speakers: override respected');

// --- detectPetNames ---------------------------------------------------------
const compText = turns.filter(t => t.speaker === 'Lyra').map(t => t.text).join('\n');
const pets = detectPetNames(compText);
const petWords = pets.map(p => p.name);
ok(petWords.includes('darling'), 'pets: finds darling');
ok(petWords.includes('love'), 'pets: finds love');
ok(petWords.includes('sweetheart'), 'pets: finds sweetheart');
const darling = pets.find(p => p.name === 'darling');
ok(darling && darling.count === 2, `pets: darling counted 2 (got ${darling && darling.count})`);
// "my love" multi-word should suppress bare "love" duplication when contained
const mw = detectPetNames('my love, you are my love and my dear');
ok(mw.some(p => p.name === 'my love'), 'pets: multi-word my love detected');

// --- vocabularyFingerprint --------------------------------------------------
const fp = vocabularyFingerprint(compText);
ok(fp.length > 0, 'fingerprint: non-empty');
ok(fp.every(f => f.count >= 2), 'fingerprint: all repeated >=2');
ok(!fp.some(f => ['the', 'you', 'and'].includes(f.word)), 'fingerprint: no stopwords');

// --- toneMetrics ------------------------------------------------------------
const tone = toneMetrics(turns.filter(t => t.speaker === 'Lyra'));
ok(tone.warmthLabel === 'very affectionate' || tone.warmthLabel === 'warm', `tone: warm (got ${tone.warmthLabel})`);
ok(/roleplay|narrated/.test(tone.style), `tone: roleplay style detected (got ${tone.style})`);
ok(tone.verbosity > 0, 'tone: verbosity computed');

// --- pickExamples -----------------------------------------------------------
const ex = pickExamples(turns.filter(t => t.speaker === 'Lyra'));
ok(ex.length >= 1 && ex.length <= 4, `examples: 1..4 (got ${ex.length})`);
ok(ex.every(e => typeof e === 'string' && e.length > 0), 'examples: non-empty strings');

// --- extractTopics ----------------------------------------------------------
const topics = extractTopics(turns);
ok(Array.isArray(topics), 'topics: array');

// --- distill orchestrator ---------------------------------------------------
const d = distill(TRANSCRIPT);
ok(d.draft.personality.length > 20, 'distill: personality drafted');
ok(d.draft.greeting.includes('There you are'), 'distill: greeting = first companion line');
ok(d.draft.petNames.includes('darling'), 'distill: petNames carried into draft');
ok(d.report.companionTurns === 5, `distill: 5 companion turns (got ${d.report.companionTurns})`);
ok(d.report.exampleCount >= 1, 'distill: examples in report');

// --- Character Card V2 build/parse roundtrip -------------------------------
const persona = normalizePersona(Object.assign(emptyPersona(), {
  name: 'Lyra', pronouns: 'she/her', essence: 'A calm stargazer who reads to you at night.',
  personality: d.draft.personality, voice: d.draft.voice, greeting: d.draft.greeting,
  backstory: 'Keeper of an old lighthouse library.', relationship: 'Your steady, affectionate anchor.',
  petNames: ['darling', 'love', 'sweetheart'], examples: ex, scenario: 'A quiet night by the window.',
  tags: ['comfort', 'romance'], topics
}));
const card = buildCardV2(persona);
eq(card.spec, 'chara_card_v2', 'card: spec tag');
eq(card.spec_version, '2.0', 'card: spec version');
ok(card.data.name === 'Lyra', 'card: name');
ok(card.data.first_mes.includes('There you are'), 'card: first_mes = greeting');
ok(card.data.mes_example.includes('<START>'), 'card: examples wrapped with <START>');
ok(card.data.extensions.soulprint.pet_names.includes('darling'), 'card: pet names in extensions');
ok(Array.isArray(card.data.alternate_greetings), 'card: alt greetings array');

const reparsed = parseCardV2(card);
ok(reparsed.name === 'Lyra', 'card: reparse name');
ok(reparsed.greeting.includes('There you are'), 'card: reparse greeting');
ok(reparsed.petNames.includes('darling'), 'card: reparse pet names from extensions');
ok(reparsed.examples.length >= 1, 'card: reparse examples');
// legacy V1 flat card parses too
const v1 = parseCardV2({ name: 'Old', personality: 'flat', first_mes: 'hi' });
ok(v1.name === 'Old' && v1.greeting === 'hi', 'card: legacy V1 flat parse');

// --- base64 UTF-8 roundtrip (incl. emoji) ----------------------------------
const tricky = 'Lyra ❤ darling — "stars" \u{1F319} éè';
const enc = bytesToBase64(new TextEncoder().encode(tricky));
const dec = new TextDecoder().decode(base64ToBytes(enc));
ok(dec === tricky, 'base64: UTF-8 + emoji roundtrip');

// --- PNG tEXt chara embed/read roundtrip -----------------------------------
// A real 1x1 transparent PNG (base64), decoded to bytes.
const PNG_1x1 = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
);
const jsonStr = JSON.stringify(card);
const embedded = pngEmbedChara(PNG_1x1, jsonStr);
ok(embedded.length > PNG_1x1.length, 'png: embedded is larger');
// signature preserved
ok([...embedded.subarray(0, 8)].join(',') === '137,80,78,71,13,10,26,10', 'png: signature intact');
const readBack = pngReadChara(embedded);
ok(readBack.data.name === 'Lyra', 'png: chara chunk reads back the card');
ok(readBack.spec === 'chara_card_v2', 'png: read card spec intact');
// IEND remains the final chunk: last 12 bytes = [length][IEND][crc], so the
// type marker sits in the first 4 of the trailing 8.
const tail = embedded.subarray(embedded.length - 8);
ok(String.fromCharCode(tail[0], tail[1], tail[2], tail[3]) === 'IEND', 'png: IEND remains last chunk');

// --- exports ---------------------------------------------------------------
const sys = genericSystemPrompt(persona, 'Sam');
ok(sys.includes('You are Lyra'), 'export: system prompt names companion');
ok(sys.includes('Sam'), 'export: system prompt uses user name');
ok(sys.includes('darling'), 'export: system prompt includes pet names');
ok(/Stay fully in character/.test(sys), 'export: system prompt has guardrail line');

const cai = characterAiFields(persona);
ok(cai.name === 'Lyra' && cai.definition.includes('{{char}}'), 'export: character.ai fields');
ok(cai.shortDescription.length <= 50, 'export: c.ai short desc capped');

const jan = janitorFields(persona);
ok(jan.firstMessage.includes('There you are'), 'export: janitor first message');
ok(jan.personality.length > 0, 'export: janitor personality');

const md = masterDoc(persona);
ok(md.includes('SOULPRINT — Lyra'), 'export: master doc header');
ok(md.includes('WHAT THEY CALL YOU'), 'export: master doc pet section');
ok(md.includes('Stored 100% on your own device'), 'export: master doc privacy line');

// --- license ----------------------------------------------------------------
const key = mintKey('AB12', 'CD34');
ok(validateKey(key), 'license: minted key validates');
ok(!validateKey('SOULPRINT-AAAA-AAAA-AAAA'), 'license: bad checksum rejected');
ok(!validateKey('NOPE-1234-5678-9ABC'), 'license: wrong prefix rejected');
ok(!validateKey('SOULPRINT-AB12-CD34'), 'license: too few blocks rejected');
// O/0 and I/L/1 typo tolerance on a minted key
const typo = key.replace(/0/g, 'O').replace(/1/g, 'I');
ok(validateKey(typo), 'license: O/0 + I/1 typo-tolerant');
// Crockford base32 excludes I L O U; normalisation maps O->0, I/L->1 and drops
// the non-base32 U, so the brand prefix folds to a stable canonical form. The
// validator compares normalised-to-normalised, so this is self-consistent.
ok(normalizeKey('SOULPRINT') === 'S01PR1NT', 'license: prefix folds to canonical base32');

// --- persona completeness + vault serialize --------------------------------
ok(completeness(emptyPersona()) === 0, 'persona: empty completeness 0');
const cFull = completeness(persona);
ok(cFull > 60, `persona: filled persona scores high (got ${cFull})`);
const blob = serializeVault([persona]);
ok(blob.app === 'soulprint' && blob.companions.length === 1, 'persona: vault serialize shape');
const back = deserializeVault(JSON.parse(JSON.stringify(blob)));
ok(back.length === 1 && back[0].name === 'Lyra', 'persona: vault roundtrip');
ok(deserializeVault({ name: 'Bare', personality: 'x' })[0].name === 'Bare', 'persona: bare persona import');

// --- report -----------------------------------------------------------------
console.log(`\nSoulprint engine tests: ${passed} passed, ${failed} failed.`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
else console.log('All green.\n');
