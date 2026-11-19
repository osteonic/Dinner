// Encrypts private/recipes.json -> data/recipes.enc.json (AES-GCM, PBKDF2-SHA256).
// Usage: node tools/encrypt-recipes.mjs "your passphrase"
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const pass = process.argv[2];
if (!pass) { console.error('Usage: node tools/encrypt-recipes.mjs "passphrase"'); process.exit(1); }
const ITER = 600000;
const plain = readFileSync(new URL('../private/recipes.json', import.meta.url));
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = (u) => Buffer.from(u).toString('base64');
writeFileSync(new URL('../data/recipes.enc.json', import.meta.url), JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
console.log('Wrote data/recipes.enc.json');
