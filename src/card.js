// card.js — Character Card V2 interop. Builds a spec-accurate chara_card_v2
// object from a Soulprint persona, parses one back in (for importing a card a
// user already has), and reads/writes the PNG tEXt "chara" chunk that
// SillyTavern / Janitor / Risu use to embed a card inside its avatar image.
//
// Pure, zero-dependency, byte-level. The base64 codec is UTF-8 safe and works
// identically in Node and the browser (no Buffer, no btoa needed).

// --- Character Card V2 object ----------------------------------------------
export function buildCardV2(p) {
  const examples = (p.examples || []).map(e => `<START>\n{{char}}: ${e}`).join('\n');
  const desc = [
    p.essence && `${p.essence}`,
    p.backstory && `Background: ${p.backstory}`,
    p.voice && `Voice: ${p.voice}`,
    p.values && `Values: ${p.values}`,
    p.quirks && `Quirks: ${p.quirks}`,
    p.relationship && `With {{user}}: ${p.relationship}`,
    p.petNames && p.petNames.length && `Calls {{user}}: ${p.petNames.join(', ')}`
  ].filter(Boolean).join('\n');

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: p.name || 'Companion',
      description: desc,
      personality: p.personality || '',
      scenario: p.scenario || '',
      first_mes: p.greeting || '',
      mes_example: examples,
      creator_notes: 'Preserved with Soulprint (soulprint, local-first companion vault).',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: (p.altGreetings || []).filter(Boolean),
      tags: (p.tags || []).filter(Boolean),
      creator: 'Soulprint',
      character_version: '1.0',
      extensions: {
        soulprint: {
          pronouns: p.pronouns || '',
          pet_names: p.petNames || [],
          topics: p.topics || [],
          fingerprint: p.fingerprint || [],
          source_platform: p.sourcePlatform || ''
        }
      },
      character_book: { entries: [], extensions: {} }
    }
  };
}

// Parse a chara_card_v2 (or legacy V1 flat) object into a partial persona, so a
// user can pull an existing card into their vault.
export function parseCardV2(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a character card');
  const d = obj.data && obj.spec ? obj.data : obj; // V2 nests under data; V1 is flat
  const ext = (d.extensions && d.extensions.soulprint) || {};
  const examples = parseExamples(d.mes_example || '');
  return {
    name: d.name || '',
    personality: d.personality || '',
    scenario: d.scenario || '',
    greeting: d.first_mes || '',
    backstory: stripLabel(d.description || '', 'Background'),
    essence: firstLine(d.description || ''),
    altGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
    tags: Array.isArray(d.tags) ? d.tags : [],
    examples,
    pronouns: ext.pronouns || '',
    petNames: Array.isArray(ext.pet_names) ? ext.pet_names : [],
    topics: Array.isArray(ext.topics) ? ext.topics : [],
    fingerprint: Array.isArray(ext.fingerprint) ? ext.fingerprint : [],
    sourcePlatform: ext.source_platform || ''
  };
}

function parseExamples(mes) {
  return String(mes).split(/<START>/i).map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^\{\{char\}\}:\s*/i, '').trim()).filter(Boolean);
}
function firstLine(s) { return String(s).split('\n')[0].trim(); }
function stripLabel(s, label) {
  const m = String(s).split('\n').find(l => l.toLowerCase().startsWith(label.toLowerCase() + ':'));
  return m ? m.split(':').slice(1).join(':').trim() : '';
}

// --- UTF-8 safe base64 (portable Node + browser) ---------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}
export function base64ToBytes(str) {
  const clean = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]), n1 = B64.indexOf(clean[i + 1]);
    const n2 = B64.indexOf(clean[i + 2]), n3 = B64.indexOf(clean[i + 3]);
    out.push((n0 << 2) | (n1 >> 4));
    if (n2 !== -1 && i + 2 < clean.length) out.push(((n1 & 15) << 4) | (n2 >> 2));
    if (n3 !== -1 && i + 3 < clean.length) out.push(((n2 & 3) << 6) | n3);
  }
  return Uint8Array.from(out);
}
function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return Uint8Array.from(out);
}
function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(Uint8Array.from(bytes));
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else s += String.fromCharCode(((c & 0xf) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
  }
  return s;
}

// --- PNG CRC32 + chunk helpers ---------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

// Embed a Character Card V2 JSON string into a PNG as a tEXt "chara" chunk,
// inserted just before the IEND chunk. We locate IEND by scanning for its
// 4-byte type marker (robust to any chunk-length quirks) and insert ahead of
// its 4-byte length field. Input/output are Uint8Array PNG bytes.
export function pngEmbedChara(pngBytes, jsonString) {
  const png = Uint8Array.from(pngBytes);
  const b64 = bytesToBase64(utf8Encode(jsonString));
  const keyword = 'chara';
  const dataArr = [];
  for (let i = 0; i < keyword.length; i++) dataArr.push(keyword.charCodeAt(i));
  dataArr.push(0); // null separator
  for (let i = 0; i < b64.length; i++) dataArr.push(b64.charCodeAt(i));
  const typeAndData = [0x74, 0x45, 0x58, 0x74, ...dataArr]; // "tEXt" + data
  const chunk = Uint8Array.from([...u32(dataArr.length), ...typeAndData, ...u32(crc32(Uint8Array.from(typeAndData)))]);

  const iendType = indexOfBytes(png, [0x49, 0x45, 0x4e, 0x44]); // "IEND"
  const at = iendType >= 4 ? iendType - 4 : png.length; // start of IEND's length field
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

// Read a Character Card object back out of a PNG's tEXt "chara"/"ccv3" chunk.
// Scans for tEXt markers and parses the keyword + base64 payload directly.
export function pngReadChara(pngBytes) {
  const png = Uint8Array.from(pngBytes);
  const textBytes = [0x74, 0x45, 0x58, 0x74]; // "tEXt"
  let from = 0;
  for (;;) {
    const typeAt = indexOfBytes(png, textBytes, from);
    if (typeAt < 4) break;
    const len = (png[typeAt - 4] << 24) | (png[typeAt - 3] << 16) | (png[typeAt - 2] << 8) | png[typeAt - 1];
    const dataStart = typeAt + 4;
    if (len > 0 && dataStart + len <= png.length) {
      const data = png.subarray(dataStart, dataStart + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = String.fromCharCode(...data.subarray(0, nul));
        if (key === 'chara' || key === 'ccv3') {
          const b64 = String.fromCharCode(...data.subarray(nul + 1));
          return JSON.parse(utf8Decode(base64ToBytes(b64)));
        }
      }
    }
    from = typeAt + 4;
  }
  throw new Error('No embedded character card found in this PNG');
}

// Find the first index of a byte sequence in a Uint8Array, at or after `from`.
function indexOfBytes(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
