#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];

function fail(message) {
  errors.push(message);
}

const html = read('index.html');
const schema = read('supabase-schema.sql');
const vercel = JSON.parse(read('vercel.json'));

if (/https:\/\/cdnjs\.cloudflare\.com|https:\/\/cdn\.jsdelivr\.net/.test(html)) {
  fail('index.html still loads executable scripts from public CDNs');
}

if (/<a\b[^>]*target="_blank"(?![^>]*rel="[^"]*\bnoopener\b)/i.test(html)) {
  fail('external target=_blank links must include rel="noopener noreferrer"');
}

const headers = vercel.headers || [];
const rootHeaders = headers.find(entry => entry.source === '/(.*)' || entry.source === '/:path*');
const headerNames = new Set((rootHeaders && rootHeaders.headers || []).map(h => h.key.toLowerCase()));
for (const required of [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options'
]) {
  if (!headerNames.has(required)) fail(`missing security header: ${required}`);
}

for (const table of ['drill_queue', 'theory_cards']) {
  const policyRe = new RegExp(`create policy "[^"]+"\\s+on public\\.${table}[\\s\\S]+?(?=\\n\\ndrop policy|\\n\\ncreate or replace|$)`, 'i');
  const policy = schema.match(policyRe);
  if (!policy || !/source_move_id\s+is\s+null/i.test(policy[0]) || !/public\.coach_moves/i.test(policy[0])) {
    fail(`${table} RLS must verify source_move_id ownership`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Security validation passed.');
