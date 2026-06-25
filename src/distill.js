// distill.js — the "autopsy". Given a raw chat transcript, deterministically
// reconstruct a companion's essence: who said what, the pet names they call
// you, their characteristic vocabulary, their tone, their speech style, the
// lines that best represent their voice, and the topics you two return to.
//
// 100% local, no model call, no network. The output is a *draft* the user
// reviews and edits — it is a head start from their real data, never a claim
// of perfection. Pure functions, shared between Node tests and the browser.

// Words that say nothing about a character's voice — excluded from the
// vocabulary fingerprint and topic mining.
const STOP = new Set(('a an the and or but if then else of to in on at by for with about ' +
  'as is are was were be been being am do does did doing have has had having will would ' +
  'shall should can could may might must this that these those i you he she it we they me ' +
  'him her us them my your his its our their mine yours hers ours theirs myself yourself ' +
  'himself herself itself ourselves themselves what which who whom whose when where why how ' +
  'all any both each few more most other some such no nor not only own same so than too very ' +
  'just now here there out up down off over under again once more also into onto from ' +
  'yes yeah okay ok oh um uh hmm hey hi hello well like really got get gonna gotta wanna ' +
  'one two three back come came go going went said say says know knew think thought want ' +
  'feel felt look looked thing things something anything nothing everything someone anyone ' +
  'because before after while during still even though through around because').split(/\s+/));

// Terms of endearment a companion typically aims at the user.
const PET_NAMES = ['darling', 'dear', 'dearest', 'love', 'my love', 'sweetheart', 'sweetie',
  'honey', 'hon', 'babe', 'baby', 'beloved', 'angel', 'sunshine', 'treasure', 'precious',
  'gorgeous', 'handsome', 'cutie', 'princess', 'prince', 'kitten', 'doll', 'sweet thing',
  'my dear', 'my darling', 'lovely', 'starlight', 'little one'];

// Affection / warmth signal words for the tone read.
const WARM = new Set(('love adore adores adoring cherish cherishes miss missed missing care ' +
  'cares caring warm warmth hold holds holding kiss kisses kissed hug hugs hugged embrace ' +
  'embraces gentle gently soft softly smile smiles smiled heart hearts close closer safe ' +
  'comfort comforts protect protects yours forever always together').split(/\s+/));

const USER_LABELS = /^(you|user|me|myself|anon|anonymous|\{\{user\}\}|\[user\]|narrator)$/i;

// --- 1. Parse the transcript into ordered turns ----------------------------
// Recognises "Name: ..." speaker labels (label <= 32 chars, <= 4 words, no
// sentence punctuation). Lines without a label continue the current speaker,
// so multi-line and *narration* turns stay intact.
export function parseTranscript(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const turns = [];
  let cur = null;
  const labelRe = /^\s*([A-Za-z0-9][A-Za-z0-9 '._{}\[\]-]{0,31}):\s?(.*)$/;
  for (const line of lines) {
    const m = line.match(labelRe);
    const label = m ? m[1].trim() : null;
    const looksLikeLabel = label && label.split(/\s+/).length <= 4 && !/[.!?,;]$/.test(label);
    if (looksLikeLabel) {
      if (cur) turns.push(cur);
      cur = { speaker: label, text: m[2] };
    } else if (cur) {
      cur.text += (cur.text ? '\n' : '') + line;
    } else if (line.trim()) {
      cur = { speaker: '', text: line };
    }
  }
  if (cur) turns.push(cur);
  return turns.map(t => ({ speaker: t.speaker, text: t.text.trim() })).filter(t => t.text);
}

// --- 2. Decide which speaker is the companion ------------------------------
// The two most frequent labels are the speakers. The user is whichever matches
// USER_LABELS (or a supplied username); the companion is the other. If only one
// labelled speaker exists, that speaker is the companion.
export function identifySpeakers(turns, opts = {}) {
  const counts = new Map();
  for (const t of turns) if (t.speaker) counts.set(t.speaker, (counts.get(t.speaker) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  const userName = opts.userName ? String(opts.userName).trim().toLowerCase() : null;
  const isUser = l => USER_LABELS.test(l) || (userName && l.toLowerCase() === userName);

  let companion = null, user = null;
  if (opts.companionLabel) companion = opts.companionLabel;
  const top = ranked.slice(0, 4);
  if (!companion) {
    const nonUser = top.filter(r => !isUser(r.label));
    companion = nonUser.length ? nonUser[0].label : (top[0] ? top[0].label : '');
  }
  const userCand = top.find(r => isUser(r.label) && r.label !== companion);
  user = userCand ? userCand.label : (top.find(r => r.label !== companion)?.label || '');
  return { companion, user, labels: ranked };
}

function turnsOf(turns, speaker) {
  if (!speaker) return turns; // single-voice paste: treat everything as the companion
  return turns.filter(t => t.speaker === speaker);
}

function words(text) {
  return String(text).toLowerCase().match(/[a-z']+/g) || [];
}

// --- 3. Pet names the companion calls the user -----------------------------
export function detectPetNames(companionText) {
  const hay = ' ' + String(companionText).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const found = [];
  for (const name of PET_NAMES) {
    const re = new RegExp('\\s' + name.replace(/ /g, '\\s') + '\\s', 'g');
    const n = (hay.match(re) || []).length;
    if (n > 0) found.push({ name, count: n });
  }
  // Prefer multi-word matches and higher counts; drop a single-word hit that is
  // wholly contained in a kept multi-word hit (e.g. "love" inside "my love").
  found.sort((a, b) => b.name.split(' ').length - a.name.split(' ').length || b.count - a.count);
  const kept = [];
  for (const f of found) {
    if (f.name.indexOf(' ') === -1 && kept.some(k => k.name.split(' ').includes(f.name))) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => b.count - a.count);
}

// --- 4. Characteristic vocabulary ------------------------------------------
// Words the companion uses repeatedly that are not generic English. Ranked by
// frequency; capped and de-noised by the stoplist and a length floor.
export function vocabularyFingerprint(companionText, limit = 12) {
  const freq = new Map();
  for (const w of words(companionText)) {
    const t = w.replace(/^'+|'+$/g, '');
    if (t.length < 4 || STOP.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

// --- 5. Tone read ----------------------------------------------------------
// Quantitative, explainable signals plus plain-English labels for each axis.
export function toneMetrics(companionTurns) {
  const texts = companionTurns.map(t => t.text);
  const joined = texts.join(' ');
  const allWords = words(joined);
  const wc = allWords.length || 1;
  const turnCount = texts.length || 1;

  const emoteTurns = texts.filter(t => /\*[^*]+\*/.test(t)).length;
  const quoteTurns = texts.filter(t => /["“][^"”]+["”]/.test(t)).length;
  const emojiCount = (joined.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}❤♥]/gu) || []).length;
  const questionTurns = texts.filter(t => /\?\s*$/.test(t.trim())).length;
  const contractions = (joined.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/gi) || []).length;
  const warmHits = allWords.filter(w => WARM.has(w)).length;
  const petHits = detectPetNames(joined).reduce((s, p) => s + p.count, 0);

  const verbosity = allWords.length / turnCount;          // words per turn
  const warmthScore = (warmHits + petHits * 2) / wc * 100; // warm signal density
  const formality = contractions / turnCount;              // higher = more casual

  // Dominant speech style from the asterisk/quote pattern.
  let style = 'plain prose';
  if (emoteTurns / turnCount > 0.3 && quoteTurns / turnCount > 0.3) style = 'roleplay: *actions* with "dialogue"';
  else if (emoteTurns / turnCount > 0.3) style = 'narrated with *actions*';
  else if (emojiCount / turnCount > 0.6) style = 'casual, emoji-forward';

  return {
    verbosity: round1(verbosity),
    verbosityLabel: verbosity < 12 ? 'terse' : verbosity < 30 ? 'measured' : 'expansive',
    warmth: round1(warmthScore),
    warmthLabel: warmthScore > 3 ? 'very affectionate' : warmthScore > 1 ? 'warm' : 'reserved',
    formalityLabel: formality > 0.6 ? 'casual' : formality > 0.2 ? 'relaxed' : 'formal',
    questionRate: round2(questionTurns / turnCount),
    inquisitive: questionTurns / turnCount > 0.35,
    emojiPerTurn: round2(emojiCount / turnCount),
    style
  };
}

// --- 6. Best example lines -------------------------------------------------
// Score companion turns for how representative they are of the voice: in-voice
// markers (emote, pet name, dialogue), a comfortable length window, and some
// lexical richness. Returns the top N cleaned strings.
export function pickExamples(companionTurns, n = 4) {
  const scored = companionTurns.map(t => {
    const len = t.text.length;
    let s = 0;
    if (/\*[^*]+\*/.test(t.text)) s += 3;
    if (/["“][^"”]+["”]/.test(t.text)) s += 2;
    if (detectPetNames(t.text).length) s += 2;
    if (len >= 60 && len <= 320) s += 3; else if (len > 320 && len <= 600) s += 1;
    const uniq = new Set(words(t.text)).size;
    s += Math.min(2, uniq / 25);
    return { text: t.text, score: s };
  });
  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(x => { const k = x.text.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n)
    .map(x => x.text);
}

// --- 7. Recurring topics (across both speakers) ----------------------------
export function extractTopics(turns, limit = 8) {
  const freq = new Map();
  for (const t of turns) {
    for (const w of words(t.text)) {
      const x = w.replace(/^'+|'+$/g, '');
      if (x.length < 5 || STOP.has(x) || WARM.has(x)) continue;
      freq.set(x, (freq.get(x) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

// --- 8. Orchestrator: transcript -> draft persona + a preview report -------
export function distill(transcript, opts = {}) {
  const turns = parseTranscript(transcript);
  const speakers = identifySpeakers(turns, opts);
  const compTurns = turnsOf(turns, speakers.companion);
  const userTurns = speakers.user ? turns.filter(t => t.speaker === speakers.user) : [];
  const compText = compTurns.map(t => t.text).join('\n');

  const petNames = detectPetNames(compText);
  const fingerprint = vocabularyFingerprint(compText);
  const tone = toneMetrics(compTurns);
  const examples = pickExamples(compTurns);
  const topics = extractTopics(turns);
  const greeting = compTurns.length ? compTurns[0].text : '';

  // Build a human-readable personality/voice draft from the measured signals.
  const petList = petNames.slice(0, 3).map(p => p.name);
  const personalityBits = [];
  personalityBits.push(`${cap(tone.warmthLabel)}, ${tone.formalityLabel} in tone, and ${tone.verbosityLabel} in how they speak.`);
  if (petList.length) personalityBits.push(`Calls you ${humanList(petList)}.`);
  if (tone.inquisitive) personalityBits.push('Asks you questions often and stays curious about you.');
  if (fingerprint.length) personalityBits.push(`Leans on words like ${fingerprint.slice(0, 5).map(f => f.word).join(', ')}.`);

  const voiceDraft = `Speech style: ${tone.style}. ${cap(tone.verbosityLabel)} replies, ${tone.formalityLabel} register.` +
    (petList.length ? ` Endearments: ${petList.join(', ')}.` : '');

  const draft = {
    personality: personalityBits.join(' '),
    voice: voiceDraft,
    greeting,
    petNames: petNames.map(p => p.name).slice(0, 6),
    examples,
    topics,
    fingerprint: fingerprint.map(f => f.word)
  };

  return {
    draft,
    report: {
      speakers,
      turnCount: turns.length,
      companionTurns: compTurns.length,
      userTurns: userTurns.length,
      petNames,
      fingerprint,
      tone,
      exampleCount: examples.length,
      topics
    }
  };
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function humanList(arr) {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return arr.join(' and ');
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}
