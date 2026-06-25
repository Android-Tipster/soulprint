// build.mjs — inline the zero-dep ES modules + CSS into ONE self-contained
// docs/index.html that runs over file:// with no server and no network.
//
// Each module gets its own function scope so internal helper names never
// collide. Modules publish their exports onto a shared `SP` namespace and pull
// their imports back out of it, so the dependency wiring survives bundling
// without a real module loader.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');

// dependency order: leaves first, app last
const MODULES = ['license.js', 'persona.js', 'distill.js', 'card.js', 'exports.js', 'app.js'];

function transform(code) {
  const imports = [];
  // collect + strip `import { a, b } from '...'`
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]\s*;?/g, (_, names) => {
    names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => imports.push(n));
    return '';
  });
  // collect exported names + strip the `export ` keyword
  const exports = [];
  code = code.replace(/export\s+(function|const|let|var)\s+([A-Za-z0-9_$]+)/g, (_, kind, name) => {
    exports.push(name);
    return `${kind} ${name}`;
  });
  const head = imports.length ? `  const { ${[...new Set(imports)].join(', ')} } = SP;\n` : '';
  const tail = exports.length ? `\n  Object.assign(SP, { ${[...new Set(exports)].join(', ')} });` : '';
  return `;(function(){\n${head}${code}${tail}\n})();`;
}

const bundles = MODULES.map(f => {
  const code = readFileSync(join(srcDir, f), 'utf8');
  return `\n/* ---- ${f} ---- */\n` + transform(code);
}).join('\n');

const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Soulprint — keep your AI companion, on any platform</title>
<meta name="description" content="A private, local-first home for your AI companion's identity. Distill them from a chat, then export to SillyTavern, Janitor, Character.AI and more. Nothing leaves your device.">
<style>
${css}
</style>
</head>
<body>
<script>
const SP = {};
${bundles}
</script>
<noscript>Soulprint needs JavaScript. It runs entirely in your browser; nothing is ever uploaded.</noscript>
</body>
</html>
`;

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'index.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`Built docs/index.html (${kb} KB) from ${MODULES.length} modules.`);
