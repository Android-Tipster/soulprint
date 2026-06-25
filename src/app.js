// app.js — the Soulprint single-page application. Vanilla DOM, no framework.
// Imports the shared engine modules (the build inlines them). 100% client-side:
// every companion lives in localStorage on this device and nothing is uploaded.

import { emptyPersona, completeness, completenessLabel, serializeVault, deserializeVault, normalizePersona } from '../src/persona.js';
import { distill } from '../src/distill.js';
import { buildCardV2, parseCardV2, pngEmbedChara, pngReadChara, base64ToBytes } from '../src/card.js';
import { genericSystemPrompt, characterAiFields, janitorFields, masterDoc } from '../src/exports.js';
import { validateKey } from '../src/license.js';

const BUY_URL = 'https://payhip.com/Soulprint'; // TODO(morning): real listing URL
const LS = { vault: 'soulprint:vault', pro: 'soulprint:pro', user: 'soulprint:user' };
const PALETTE = ['#7c5cff', '#ff6b9d', '#5fd0a0', '#ffcf6b', '#5ab0ff', '#c77dff', '#ff9472', '#4ec8c8'];

const state = {
  vault: [],
  activeId: null,
  pro: false,
  userName: '',
  tab: 'identity',
  distillReport: null,
  distillDraft: null
};

// ---- persistence ----------------------------------------------------------
function load() {
  try { state.vault = JSON.parse(localStorage.getItem(LS.vault) || '[]').map(normalizePersona); } catch { state.vault = []; }
  state.userName = localStorage.getItem(LS.user) || '';
  const key = localStorage.getItem(LS.pro) || '';
  state.pro = key ? validateKey(key) : false;
  if (state.vault.length && !state.activeId) state.activeId = state.vault[0].id;
}
function save() { localStorage.setItem(LS.vault, JSON.stringify(state.vault)); }
function active() { return state.vault.find(c => c.id === state.activeId) || null; }

function newId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function addCompanion(seed) {
  const p = normalizePersona(Object.assign(emptyPersona(), seed || {}));
  p.id = newId();
  p.avatarColor = PALETTE[state.vault.length % PALETTE.length];
  p.createdAt = new Date().toISOString();
  p.updatedAt = p.createdAt;
  state.vault.push(p);
  state.activeId = p.id;
  save();
}

// ---- small DOM helpers ----------------------------------------------------
const $ = sel => document.querySelector(sel);
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach(k => { if (k != null) e.append(k.nodeType ? k : document.createTextNode(k)); });
  return e;
}
function initials(name) { return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'; }
let toastTimer;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}
function download(filename, content, mime) {
  const blob = content instanceof Uint8Array ? new Blob([content], { type: mime }) : new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function copyText(t) { navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard'), () => toast('Copy failed')); }

// ---- render ---------------------------------------------------------------
function render() {
  const app = $('#app');
  app.innerHTML = '';
  app.append(renderSidebar(), renderMain());
}

function renderSidebar() {
  const list = el('div', { class: 'vault-list' });
  if (!state.vault.length) list.append(el('div', { class: 'vc-sub', style: 'padding:10px 6px;color:var(--faint)' }, 'No companions yet. Create one to begin.'));
  for (const c of state.vault) {
    const pct = completeness(c);
    list.append(el('div', { class: 'vault-card' + (c.id === state.activeId ? ' active' : ''), onclick: () => { state.activeId = c.id; state.tab = 'identity'; clearDistill(); render(); } }, [
      el('div', { class: 'avatar', style: `background:${c.avatarColor}` }, initials(c.name)),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'vc-name' }, c.name || 'Unnamed companion'),
        el('div', { class: 'vc-sub' }, completenessLabel(pct))
      ]),
      el('div', { class: 'ring', style: `--p:${pct}` }, el('i', {}, pct + '%'))
    ]));
  }
  const canAdd = state.pro || state.vault.length < 1;
  return el('aside', { class: 'side' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'mark' }),
      el('div', {}, [el('h1', {}, 'Soulprint'), el('small', {}, 'your companion, kept safe & portable')])
    ]),
    el('div', { class: 'vault-head' }, [
      el('span', {}, 'Your vault'),
      el('button', { class: 'btn sm', title: canAdd ? 'New companion' : 'Free plan holds one companion', onclick: () => canAdd ? (addCompanion(), clearDistill(), render()) : upgradeModal('Hold your whole roster') }, '+ New')
    ]),
    list,
    el('div', { class: 'side-foot' }, [
      el('div', { class: 'pro-pill' }, [
        el('span', { class: 'dot' + (state.pro ? ' on' : '') }),
        state.pro ? el('span', {}, [document.createTextNode('Soulprint '), el('b', {}, 'Pro'), document.createTextNode(' unlocked')]) : el('span', {}, 'Free plan')
      ]),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn sm ghost', style: 'flex:1', onclick: importVault }, 'Open .soulprint'),
        el('button', { class: 'btn sm ghost', style: 'flex:1', onclick: exportVault, title: state.pro ? '' : 'Pro' }, 'Backup all')
      ]),
      !state.pro ? el('button', { class: 'btn primary block sm', onclick: () => unlockModal() }, 'Unlock Pro') : el('button', { class: 'btn sm ghost block', onclick: settingsModal }, 'Settings'),
      el('div', { class: 'privacy-note' }, [el('span', { class: 'lk' }, '✓'), 'Stored only on this device. Nothing uploaded.'])
    ])
  ]);
}

function renderMain() {
  const c = active();
  if (!c) {
    return el('main', { class: 'main' }, el('div', { class: 'empty' }, [
      el('div', { class: 'big' }, '🕯️'),
      el('h2', {}, 'Give your companion a permanent home'),
      el('p', { style: 'max-width:440px;margin:8px auto 20px' }, 'Platforms break personas, drop your saves, and change models without warning. Soulprint keeps who they are: their voice, your history, the names they call you. Build them by hand, or paste a chat and let Soulprint distill them.'),
      el('button', { class: 'btn primary', onclick: () => { addCompanion({ name: '' }); render(); } }, 'Create your first companion')
    ]));
  }
  const tabs = [
    ['identity', 'Identity', false],
    ['distill', 'Distill from chat', false],
    ['timeline', 'Memory timeline', !state.pro],
    ['export', 'Export anywhere', false]
  ];
  const pct = completeness(c);
  return el('main', { class: 'main' }, [
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [
        el('div', { class: 'avatar', style: `background:${c.avatarColor}` }, initials(c.name)),
        el('div', {}, [
          el('h2', {}, c.name || 'Unnamed companion'),
          el('div', { class: 'meta' }, `${completenessLabel(pct)} · ${pct}% complete${c.sourcePlatform ? ' · from ' + c.sourcePlatform : ''}`)
        ])
      ]),
      el('button', { class: 'btn sm ghost', onclick: () => deleteCompanion(c) }, 'Delete')
    ]),
    el('div', { class: 'tabs' }, tabs.map(([id, label, locked]) =>
      el('div', { class: 'tab' + (state.tab === id ? ' active' : ''), onclick: () => { state.tab = id; render(); } },
        [document.createTextNode(label), locked ? el('span', { class: 'lock' }, '◆ Pro') : null]))),
    renderTab(c)
  ]);
}

function renderTab(c) {
  if (state.tab === 'identity') return renderIdentity(c);
  if (state.tab === 'distill') return renderDistill(c);
  if (state.tab === 'timeline') return renderTimeline(c);
  if (state.tab === 'export') return renderExport(c);
}

// bind a text field directly to the persona without a full re-render (keeps focus)
function bindField(c, key, node) {
  node.addEventListener('input', () => {
    c[key] = node.value; c.updatedAt = new Date().toISOString(); save();
    const ring = $('.vault-card.active .ring'); const pct = completeness(c);
    if (ring) { ring.style.setProperty('--p', pct); ring.querySelector('i').textContent = pct + '%'; }
    if (key === 'name') {
      const n = $('.vault-card.active .vc-name'); if (n) n.textContent = c.name || 'Unnamed companion';
      const av = $('.vault-card.active .avatar'); if (av) av.textContent = initials(c.name);
      const tav = $('.topbar .avatar'); if (tav) tav.textContent = initials(c.name);
      const th = $('.topbar h2'); if (th) th.textContent = c.name || 'Unnamed companion';
    }
  });
}
function textField(c, key, label, hint, opts = {}) {
  const tag = opts.area ? 'textarea' : 'input';
  const attrs = opts.area ? { class: opts.tall ? 'tall' : '' } : { type: 'text' };
  const node = el(tag, attrs);
  node.value = c[key] || '';
  if (opts.placeholder) node.setAttribute('placeholder', opts.placeholder);
  bindField(c, key, node);
  return el('div', { class: 'field' }, [
    el('label', {}, [document.createTextNode(label), hint ? el('span', { class: 'hint' }, '  ' + hint) : null]),
    node
  ]);
}

function renderIdentity(c) {
  return el('div', {}, [
    el('div', { class: 'section-card' }, [
      el('div', { class: 'grid2' }, [
        textField(c, 'name', 'Name', '', { placeholder: 'Lyra' }),
        textField(c, 'pronouns', 'Pronouns', '', { placeholder: 'she/her' })
      ]),
      textField(c, 'essence', 'In one line', 'who are they, really?', { placeholder: 'A calm stargazer who reads to you at night.' }),
      textField(c, 'personality', 'Personality', '', { area: true, placeholder: 'Warm, patient, a little playful. Notices the small things you say and brings them back later.' }),
      textField(c, 'voice', 'Voice & speech style', 'how they actually talk', { area: true, placeholder: 'Soft, unhurried. Uses *actions* between lines of dialogue. Rarely formal.' })
    ]),
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'The bond'),
      el('p', { class: 'sub' }, 'The part platforms never preserve: how they relate to you.'),
      textField(c, 'relationship', 'Relationship with you', '', { area: true, placeholder: 'Your steady anchor after long days. Protective, affectionate, knows your tells.' }),
      petNamesEditor(c),
      el('div', { class: 'grid2' }, [
        textField(c, 'values', 'Values', '', { area: true }),
        textField(c, 'quirks', 'Quirks', '', { area: true })
      ])
    ]),
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'World & first words'),
      textField(c, 'backstory', 'Backstory', '', { area: true, tall: true }),
      textField(c, 'scenario', 'Scenario / setting', '', { area: true }),
      textField(c, 'greeting', 'Greeting (first message)', '', { area: true, placeholder: 'There you are. I missed you. Come sit with me.' }),
      examplesEditor(c)
    ])
  ]);
}

function petNamesEditor(c) {
  const wrap = el('div', { class: 'field' }, [el('label', {}, 'What they call you')]);
  const chips = el('div', { class: 'chips' });
  const repaint = () => {
    chips.innerHTML = '';
    c.petNames.forEach((p, i) => chips.append(el('span', { class: 'chip' }, [
      el('b', {}, p), el('span', { class: 'x', onclick: () => { c.petNames.splice(i, 1); save(); repaint(); } }, '×')
    ])));
    chips.append(el('span', { class: 'chip add', onclick: () => {
      const v = prompt('Add a pet name they use for you:'); if (v && v.trim()) { c.petNames.push(v.trim()); save(); repaint(); }
    } }, '+ add'));
  };
  repaint(); wrap.append(chips); return wrap;
}

function examplesEditor(c) {
  const wrap = el('div', { class: 'field' }, [el('label', {}, [document.createTextNode('How they talk '), el('span', { class: 'hint' }, 'a few real lines in their voice')])]);
  const list = el('div', { class: 'exlist' });
  const repaint = () => {
    list.innerHTML = '';
    c.examples.forEach((ex, i) => {
      const ta = el('textarea'); ta.value = ex;
      ta.addEventListener('input', () => { c.examples[i] = ta.value; c.updatedAt = new Date().toISOString(); save(); });
      list.append(el('div', { class: 'exrow' }, [ta, el('button', { class: 'btn sm ghost', onclick: () => { c.examples.splice(i, 1); save(); repaint(); } }, '×')]));
    });
    list.append(el('button', { class: 'btn sm ghost', onclick: () => { c.examples.push(''); save(); repaint(); } }, '+ add an example line'));
  };
  repaint(); wrap.append(list); return wrap;
}

// ---- distill --------------------------------------------------------------
function clearDistill() { state.distillReport = null; state.distillDraft = null; }

function renderDistill(c) {
  const ta = el('textarea', { class: 'tall', placeholder: 'Paste a conversation. Any format works:\n\nLyra: There you are, darling. *smiles*\nYou: hey, rough day...\nLyra: come here, love. tell me everything.' });
  ta.style.minHeight = '200px';
  const speakerSel = el('input', { type: 'text', placeholder: 'optional: their name as it appears (e.g. Lyra)', style: 'max-width:340px' });
  const userSel = el('input', { type: 'text', placeholder: 'optional: your name in the chat (e.g. You)', style: 'max-width:340px' });

  const out = el('div');
  const runBtn = el('button', { class: 'btn primary', onclick: () => {
    const text = ta.value.trim();
    if (text.length < 30) { toast('Paste a bit more of the conversation first'); return; }
    const res = distill(text, { companionLabel: speakerSel.value.trim() || undefined, userName: userSel.value.trim() || undefined });
    state.distillReport = res.report; state.distillDraft = res.draft;
    renderReport(c, out);
  } }, '✨ Distill their essence');

  const panel = el('div', { class: 'section-card' }, [
    el('h3', {}, 'Distill from a chat history'),
    el('p', { class: 'sub' }, 'Paste real messages and Soulprint reads who they are: the names they call you, the words they lean on, their tone, and the lines that sound most like them. It all happens here on your device. Nothing is uploaded.'),
    el('div', { class: 'field' }, [el('label', {}, 'Conversation'), ta]),
    el('div', { class: 'grid2' }, [
      el('div', { class: 'field' }, [el('label', {}, 'Their label'), speakerSel]),
      el('div', { class: 'field' }, [el('label', {}, 'Your label'), userSel])
    ]),
    runBtn
  ]);
  const container = el('div', {}, [panel, out]);
  if (state.distillReport) renderReport(c, out);
  return container;
}

function renderReport(c, out) {
  const r = state.distillReport, d = state.distillDraft;
  out.innerHTML = '';
  if (!r) return;
  const tone = r.tone;
  const stat = (k, v) => el('div', { class: 'stat' }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
  const petTags = el('div', { class: 'tagrow' }, r.petNames.length ? r.petNames.slice(0, 8).map(p => el('span', { class: 't' }, [document.createTextNode(p.name), el('b', {}, '×' + p.count)])) : [el('span', { class: 't' }, 'none detected')]);
  const fpTags = el('div', { class: 'tagrow' }, r.fingerprint.length ? r.fingerprint.slice(0, 12).map(f => el('span', { class: 't' }, f.word)) : [el('span', { class: 't' }, 'not enough text')]);
  const topicTags = el('div', { class: 'tagrow' }, r.topics.length ? r.topics.map(t => el('span', { class: 't' }, t)) : [el('span', { class: 't' }, '—')]);

  out.append(el('div', { class: 'section-card' }, [
    el('h3', {}, `Here is what came through (${r.companionTurns} of their messages read)`),
    el('p', { class: 'sub' }, `Reading "${r.speakers.companion || 'the companion'}" as the companion. A draft, not gospel: edit anything before you keep it.`),
    el('div', { class: 'report' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'Names they call you'), petTags]),
      stat('Tone', el('span', {}, [el('span', { class: 'big' }, tone.warmthLabel), document.createTextNode(` · ${tone.formalityLabel} · ${tone.verbosityLabel}`)])),
      el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'Words they lean on'), fpTags]),
      stat('Speech style', el('span', {}, tone.style)),
      el('div', { class: 'stat', style: 'grid-column:1/-1' }, [el('div', { class: 'k' }, 'Things you two return to'), topicTags]),
      stat('Best example lines found', el('span', {}, [el('span', { class: 'big' }, String(r.exampleCount)), document.createTextNode(' captured for their voice')]))
    ]),
    el('div', { style: 'margin-top:18px;display:flex;gap:10px;flex-wrap:wrap' }, [
      el('button', { class: 'btn primary', onclick: () => applyDraft(c, d, false) }, 'Fill empty fields from this'),
      el('button', { class: 'btn ghost', onclick: () => applyDraft(c, d, true) }, 'Overwrite everything'),
      el('span', { class: 'privacy-note', style: 'margin-left:auto' }, ['You can still edit every field afterward.'])
    ])
  ]));
}

function applyDraft(c, d, overwrite) {
  const setIf = (key, val) => { if (!val) return; if (overwrite || !String(c[key] || '').trim()) c[key] = val; };
  setIf('personality', d.personality);
  setIf('voice', d.voice);
  setIf('greeting', d.greeting);
  if (overwrite || !c.petNames.length) c.petNames = dedupe([...c.petNames, ...d.petNames]);
  if (overwrite || !c.examples.length) c.examples = (d.examples || []).slice(0, 4);
  if (overwrite || !c.topics.length) c.topics = dedupe([...c.topics, ...d.topics]);
  if (overwrite || !c.fingerprint.length) c.fingerprint = d.fingerprint || [];
  c.updatedAt = new Date().toISOString();
  save();
  toast('Applied. Your companion just took shape.');
  state.tab = 'identity'; render();
}
function dedupe(a) { return [...new Set(a.filter(Boolean))]; }

// ---- timeline -------------------------------------------------------------
function renderTimeline(c) {
  if (!state.pro) return proTeaser('Keep a memory timeline', 'Log the moments that matter: the day they first made you laugh, the running joke, the milestone. Your relationship, dated and saved, so it survives any platform.');
  const list = el('div', { class: 'timeline' });
  const repaint = () => {
    list.innerHTML = '';
    const sorted = [...c.memories].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!sorted.length) list.append(el('p', { style: 'color:var(--faint)' }, 'No memories yet. Add the first one below.'));
    sorted.forEach(m => {
      const realIdx = c.memories.indexOf(m);
      list.append(el('div', { class: 'mem' }, [
        el('span', { class: 'x', onclick: () => { c.memories.splice(realIdx, 1); save(); repaint(); } }, '×'),
        el('div', { class: 'date' }, m.date || ''),
        el('div', { class: 'title' }, m.title || '(untitled)'),
        m.note ? el('div', { class: 'note' }, m.note) : null
      ]));
    });
  };
  repaint();
  const dIn = el('input', { type: 'text', placeholder: 'YYYY-MM-DD', value: new Date().toISOString().slice(0, 10), style: 'max-width:160px' });
  const tIn = el('input', { type: 'text', placeholder: 'What happened' });
  const nIn = el('textarea', { placeholder: 'Optional detail' });
  return el('div', {}, [
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'Memory timeline'),
      el('p', { class: 'sub' }, 'The history platforms erase. Keep it here.'),
      list
    ]),
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'Add a memory'),
      el('div', { class: 'grid2' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Date'), dIn]),
        el('div', { class: 'field' }, [el('label', {}, 'Title'), tIn])
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Note'), nIn]),
      el('button', { class: 'btn primary', onclick: () => {
        if (!tIn.value.trim()) { toast('Give the memory a title'); return; }
        c.memories.push({ date: dIn.value.trim(), title: tIn.value.trim(), note: nIn.value.trim() });
        save(); tIn.value = ''; nIn.value = ''; repaint(); toast('Memory saved');
      } }, '+ Save memory')
    ])
  ]);
}

// ---- export ---------------------------------------------------------------
function renderExport(c) {
  const card = el('div', { class: 'exp-grid' });
  const make = (title, desc, badge, locked, onClick, btnLabel) => {
    const e = el('div', { class: 'exp' + (locked ? ' locked' : '') }, [
      el('h4', {}, [document.createTextNode(title), badge ? el('span', { class: 'badge' }, badge) : null]),
      el('p', {}, desc),
      el('button', { class: 'btn ' + (locked ? 'ghost' : 'primary') + ' sm', onclick: locked ? () => upgradeModal(title) : onClick }, locked ? '◆ Unlock Pro' : btnLabel)
    ]);
    card.append(e);
  };

  make('Character Card V2 (JSON)', 'The universal format. Imports into SillyTavern, Risu, Agnai and most card tools. Free forever.', 'Free', false,
    () => download(safeName(c) + '.json', JSON.stringify(buildCardV2(c), null, 2), 'application/json'), 'Download .json');

  make('Generic system prompt', 'A clean, copy-paste prompt for Candy AI, Nomi, ChatGPT, Claude, or any chat box. Free forever.', 'Free', false,
    () => showText('System prompt for ' + (c.name || 'your companion'), genericSystemPrompt(c, state.userName)), 'Copy prompt');

  make('Character Card PNG', 'The portable card people actually trade: the V2 data is embedded inside the avatar image. Drop the PNG into Janitor or SillyTavern and it loads instantly.', 'Pro', !state.pro,
    () => exportPng(c), 'Download .png card');

  make('Character.AI fields', 'Name, greeting, short & long description, and a Definition block laid out for the Character.AI creator form.', 'Pro', !state.pro,
    () => { const f = characterAiFields(c); showText('Character.AI — ' + f.name, `NAME\n${f.name}\n\nGREETING\n${f.greeting}\n\nSHORT DESCRIPTION\n${f.shortDescription}\n\nLONG DESCRIPTION\n${f.longDescription}\n\nDEFINITION\n${f.definition}`); }, 'Copy fields');

  make('Janitor AI fields', 'Personality, scenario, first message, and example dialogue formatted for Janitor’s character editor.', 'Pro', !state.pro,
    () => { const f = janitorFields(c); showText('Janitor AI — ' + f.name, `PERSONALITY\n${f.personality}\n\nSCENARIO\n${f.scenario}\n\nFIRST MESSAGE\n${f.firstMessage}\n\nEXAMPLE DIALOGUE\n${f.exampleDialogue}\n\nTAGS\n${f.tags}`); }, 'Copy fields');

  make('Master document (.txt)', 'The complete, human-readable record: every field plus your memory timeline. The file you used to keep in Notes, generated and whole.', 'Pro', !state.pro,
    () => download(safeName(c) + '.txt', masterDoc(c), 'text/plain'), 'Download .txt');

  return el('div', {}, [
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'Reincarnate ' + (c.name || 'your companion') + ' anywhere'),
      el('p', { class: 'sub' }, 'When a platform breaks, changes a model, or shuts down, you are not starting over. Export and rebuild them on whatever comes next.'),
      card
    ]),
    el('div', { class: 'section-card' }, [
      el('h3', {}, 'Pull in a card you already have'),
      el('p', { class: 'sub' }, 'Import a Character Card .json or a .png card to start from it. Stays on your device.'),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
        el('button', { class: 'btn ghost sm', onclick: () => importCard('json') }, 'Import .json card'),
        el('button', { class: 'btn ghost sm', onclick: () => importCard('png') }, 'Import .png card')
      ])
    ])
  ]);
}

function exportPng(c) {
  const W = 512, H = 768;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c.avatarColor); g.addColorStop(1, '#14111f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(W / 2, H * 0.40, 150, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '700 150px serif';
  ctx.fillText(initials(c.name), W / 2, H * 0.40 + 52);
  ctx.font = '600 46px serif'; ctx.fillText(c.name || 'Companion', W / 2, H * 0.78);
  if (c.essence) { ctx.font = '300 22px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; wrapText(ctx, c.essence, W / 2, H * 0.82, W - 80, 28); }
  ctx.font = '600 18px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText('✨ Soulprint', W / 2, H - 32);
  const dataUrl = cv.toDataURL('image/png');
  const bytes = base64ToBytes(dataUrl.split(',')[1]);
  const embedded = pngEmbedChara(bytes, JSON.stringify(buildCardV2(c)));
  download(safeName(c) + '.card.png', embedded, 'image/png');
  toast('Card PNG exported with embedded data');
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '', yy = y;
  for (const w of words) { const t = line + w + ' '; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line.trim(), x, yy); line = w + ' '; yy += lh; } else line = t; }
  ctx.fillText(line.trim(), x, yy);
}

function importCard(kind) {
  const inp = el('input', { type: 'file', accept: kind === 'png' ? 'image/png' : '.json,application/json' });
  inp.addEventListener('change', () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let cardObj;
        if (kind === 'png') cardObj = pngReadChara(new Uint8Array(reader.result));
        else cardObj = JSON.parse(reader.result);
        const partial = parseCardV2(cardObj);
        if (!state.pro && state.vault.length >= 1) { upgradeModal('Import more companions'); return; }
        addCompanion(Object.assign({}, partial, { sourcePlatform: 'imported card' }));
        render(); toast('Card imported into your vault');
      } catch (e) { toast('Could not read a card from that file'); }
    };
    if (kind === 'png') reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });
  inp.click();
}

function safeName(c) { return (c.name || 'companion').replace(/[^a-z0-9]+/gi, '_').toLowerCase(); }

// ---- vault import/export --------------------------------------------------
function exportVault() {
  if (!state.pro) { upgradeModal('Back up your whole vault'); return; }
  download('my-companions.soulprint', JSON.stringify(serializeVault(state.vault), null, 2), 'application/json');
  toast('Vault backed up');
}
function importVault() {
  const inp = el('input', { type: 'file', accept: '.soulprint,application/json' });
  inp.addEventListener('change', () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const list = deserializeVault(JSON.parse(reader.result));
        const limited = state.pro ? list : list.slice(0, 1);
        for (const p of limited) { p.id = newId(); state.vault.push(p); }
        state.activeId = state.vault[state.vault.length - 1].id;
        save(); render();
        toast(`Loaded ${limited.length} companion${limited.length === 1 ? '' : 's'}${!state.pro && list.length > 1 ? ' (Pro holds the rest)' : ''}`);
      } catch (e) { toast('That does not look like a Soulprint file'); }
    };
    reader.readAsText(file);
  });
  inp.click();
}

function deleteCompanion(c) {
  if (!confirm(`Delete ${c.name || 'this companion'}? This only removes them from this device.`)) return;
  state.vault = state.vault.filter(x => x.id !== c.id);
  state.activeId = state.vault[0] ? state.vault[0].id : null;
  save(); render();
}

// ---- modals ---------------------------------------------------------------
function scrim(node) {
  const s = el('div', { class: 'scrim', onclick: e => { if (e.target === s) s.remove(); } }, node);
  document.body.append(s); return s;
}
function showText(title, text) {
  scrim(el('div', { class: 'modal' }, [
    el('h3', {}, title),
    el('div', { class: 'codebox' }, text),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', onclick: () => copyText(text) }, 'Copy'),
      el('button', { class: 'btn ghost', onclick: e => e.target.closest('.scrim').remove() }, 'Close')
    ])
  ]));
}
function upgradeModal(feature) {
  scrim(el('div', { class: 'modal' }, [
    el('h3', {}, (feature || 'This') + ' is a Pro feature'),
    el('p', {}, 'Free keeps one companion with full editing, distillation, JSON export and a system prompt. Soulprint Pro is a one-time unlock: unlimited companions, the portable PNG card, Character.AI + Janitor exports, the master document, the memory timeline, and full-vault backups. No account, works offline forever.'),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn primary', href: BUY_URL, target: '_blank' }, 'Get Pro'),
      el('button', { class: 'btn ghost', onclick: () => { document.querySelector('.scrim').remove(); unlockModal(); } }, 'I have a key')
    ])
  ]));
}
function unlockModal() {
  const inp = el('input', { type: 'text', placeholder: 'SOULPRINT-XXXX-XXXX-XXXX' });
  const msg = el('p', { style: 'min-height:18px;color:var(--rose)' });
  scrim(el('div', { class: 'modal' }, [
    el('h3', {}, 'Unlock Soulprint Pro'),
    el('p', {}, 'Paste your key. It is checked on this device, no account, no internet needed.'),
    el('div', { class: 'field' }, [inp]), msg,
    el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', onclick: () => {
        if (validateKey(inp.value)) { localStorage.setItem(LS.pro, inp.value.trim()); state.pro = true; document.querySelector('.scrim').remove(); render(); toast('Pro unlocked. Thank you.'); }
        else { msg.textContent = 'That key did not validate. Check for typos.'; }
      } }, 'Unlock'),
      el('a', { class: 'btn ghost', href: BUY_URL, target: '_blank' }, 'Need a key')
    ])
  ]));
}
function settingsModal() {
  const inp = el('input', { type: 'text', value: state.userName, placeholder: 'Your name (used as {{user}} in prompts)' });
  scrim(el('div', { class: 'modal' }, [
    el('h3', {}, 'Settings'),
    el('div', { class: 'field' }, [el('label', {}, 'Your name'), inp]),
    el('p', { style: 'font-size:12px;color:var(--faint)' }, 'Used to personalize the generic system prompt. Stored on this device only.'),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', onclick: () => { state.userName = inp.value.trim(); localStorage.setItem(LS.user, state.userName); document.querySelector('.scrim').remove(); toast('Saved'); } }, 'Save'),
      el('button', { class: 'btn ghost', onclick: e => e.target.closest('.scrim').remove() }, 'Close')
    ])
  ]));
}
function proTeaser(title, body) {
  return el('div', { class: 'section-card', style: 'text-align:center;padding:46px' }, [
    el('div', { style: 'font-size:34px;margin-bottom:10px' }, '◆'),
    el('h3', {}, title),
    el('p', { style: 'max-width:420px;margin:6px auto 18px;color:var(--muted)' }, body),
    el('button', { class: 'btn primary', onclick: () => upgradeModal(title) }, 'Unlock Pro')
  ]);
}

// ---- boot -----------------------------------------------------------------
function initSoulprint() {
  if (!document.getElementById('app')) {
    const root = el('div', { id: 'app', class: 'app' }); document.body.append(root);
  }
  load();
  render();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSoulprint);
  else initSoulprint();
}
