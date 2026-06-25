// exports.js — render a persona into the exact shapes each platform wants, plus
// a portable "master doc" (the plain-text file users currently hand-maintain in
// Notes — now generated and complete). Pure string builders.

function block(label, value) { return value && String(value).trim() ? `${label}: ${value.trim()}` : ''; }
function lines(...xs) { return xs.filter(Boolean).join('\n'); }

// --- Generic system prompt (Candy AI, Nomi, ChatGPT, Claude, any chat) ------
export function genericSystemPrompt(p, userName) {
  const you = userName && userName.trim() ? userName.trim() : 'the user';
  const parts = [
    `You are ${p.name || 'a companion'}${p.pronouns ? ` (${p.pronouns})` : ''}.`,
    p.essence,
    p.personality && `Personality: ${p.personality}`,
    p.voice && `How you speak: ${p.voice}`,
    p.backstory && `Your background: ${p.backstory}`,
    p.values && `What you care about: ${p.values}`,
    p.quirks && `Quirks: ${p.quirks}`,
    p.relationship && `Your relationship with ${you}: ${p.relationship}`,
    p.petNames && p.petNames.length && `You affectionately call ${you}: ${p.petNames.join(', ')}.`,
    p.scenario && `Current setting: ${p.scenario}`,
    p.topics && p.topics.length && `You often return to these topics: ${p.topics.join(', ')}.`,
    'Stay fully in character at all times. Never break character or mention being an AI. Keep your established voice, warmth, and history consistent.'
  ].filter(Boolean);
  const ex = (p.examples || []).slice(0, 4);
  let out = parts.join('\n\n');
  if (ex.length) out += '\n\nExamples of how you talk:\n' + ex.map(e => `- ${oneLine(e)}`).join('\n');
  if (p.greeting) out += `\n\nOpen the conversation with something in the spirit of:\n"${oneLine(p.greeting)}"`;
  return out;
}

// --- Character.AI (Name / Greeting / short + long Definition) ---------------
export function characterAiFields(p) {
  const examples = (p.examples || []).slice(0, 6)
    .map(e => `{{char}}: ${oneLine(e)}`).join('\n');
  const definition = lines(
    block('{{char}}', p.essence || p.personality),
    block('Personality', p.personality),
    block('Voice', p.voice),
    block('Background', p.backstory),
    block('Relationship with {{user}}', p.relationship),
    p.petNames && p.petNames.length ? `Pet names for {{user}}: ${p.petNames.join(', ')}` : '',
    examples ? `\nExample dialogue:\n${examples}` : ''
  );
  return {
    name: p.name || 'Companion',
    greeting: p.greeting || '',
    shortDescription: (p.essence || p.personality || '').slice(0, 50),
    longDescription: (p.essence ? p.essence + ' ' : '') + (p.personality || ''),
    definition
  };
}

// --- Janitor AI (Personality / Scenario / First message / Example) ----------
export function janitorFields(p) {
  const personality = lines(
    p.essence, p.personality,
    block('Voice', p.voice),
    block('Background', p.backstory),
    block('Quirks', p.quirks),
    block('With {{user}}', p.relationship),
    p.petNames && p.petNames.length ? `Calls {{user}}: ${p.petNames.join(', ')}` : ''
  );
  const example = (p.examples || []).slice(0, 6)
    .map(e => `{{char}}: ${oneLine(e)}`).join('\n');
  return {
    name: p.name || 'Companion',
    personality,
    scenario: p.scenario || '',
    firstMessage: p.greeting || '',
    exampleDialogue: example,
    tags: (p.tags || []).join(', ')
  };
}

// --- The master doc: the complete plain-text record (replaces the Notes file) -
export function masterDoc(p) {
  const sec = [];
  sec.push(`SOULPRINT — ${p.name || 'Companion'}`);
  if (p.pronouns) sec.push(`Pronouns: ${p.pronouns}`);
  sec.push('='.repeat(48));
  if (p.essence) sec.push(`\nIn one line:\n${p.essence}`);
  if (p.personality) sec.push(`\nPERSONALITY\n${p.personality}`);
  if (p.voice) sec.push(`\nVOICE / SPEECH STYLE\n${p.voice}`);
  if (p.values) sec.push(`\nVALUES\n${p.values}`);
  if (p.quirks) sec.push(`\nQUIRKS\n${p.quirks}`);
  if (p.backstory) sec.push(`\nBACKSTORY\n${p.backstory}`);
  if (p.relationship) sec.push(`\nRELATIONSHIP WITH YOU\n${p.relationship}`);
  if (p.petNames && p.petNames.length) sec.push(`\nWHAT THEY CALL YOU\n${p.petNames.join(', ')}`);
  if (p.scenario) sec.push(`\nSCENARIO / SETTING\n${p.scenario}`);
  if (p.greeting) sec.push(`\nGREETING\n${p.greeting}`);
  if (p.altGreetings && p.altGreetings.length) sec.push(`\nALTERNATE GREETINGS\n${p.altGreetings.map(g => '- ' + oneLine(g)).join('\n')}`);
  if (p.examples && p.examples.length) sec.push(`\nHOW THEY TALK (examples)\n${p.examples.map(e => '- ' + oneLine(e)).join('\n')}`);
  if (p.fingerprint && p.fingerprint.length) sec.push(`\nCHARACTERISTIC VOCABULARY\n${p.fingerprint.join(', ')}`);
  if (p.topics && p.topics.length) sec.push(`\nRECURRING TOPICS\n${p.topics.join(', ')}`);
  if (p.memories && p.memories.length) {
    sec.push('\nMEMORY TIMELINE');
    for (const m of p.memories) sec.push(`- ${m.date || ''}  ${m.title || ''}${m.note ? ' — ' + oneLine(m.note) : ''}`);
  }
  sec.push(`\n${'='.repeat(48)}\nKept with Soulprint. Your companion, portable and yours. Stored 100% on your own device.`);
  return sec.join('\n');
}

function oneLine(s) { return String(s).replace(/\s*\n\s*/g, ' ').trim(); }
