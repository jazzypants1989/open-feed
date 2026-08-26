import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const root = path.resolve('tmp/review/sandbox');
const probes = [
 ['P1 §5.4 prefix hash', 'src/reader.js', 'listed !== undefined && listed !== t.hash', 'listed !== undefined && !listed.startsWith(t.hash)', ['posts-and-targets','top-and-rumors','moving']],
 ['P2 §8.4 version must advance', 'src/hub.js', '!(o.version > old.version)', 'false', ['publish-interface','the-reader','moving','your-copy']],
 ['P3 §7.2 media exempt', 'src/index.js', "if (typeof n !== 'number' || n > pin.top) continue;", 'if (n > pin.top) continue;', ['the-reader','media','rewrite','publish-interface','your-copy','posts-and-targets','views']],
 ['P4 §7.4 any chain key', 'src/reader.js', 'const post = verifyFile(f.bytes, chain.keys);', 'const post = verifyFile(f.bytes, chain.current);', ['the-reader','posts-and-targets','rewrite']],
 ['P5 row117 subtler: drop entries only', 'src/publish.js', 'const next = change({ entries: obj.entries, version: obj.version + 1, top: obj.top });', 'const next = change({ entries: [], version: obj.version + 1, top: obj.top });', ['publish-interface']],
 ['P6 row69 subtler: fetch post-referenced media', 'src/reader.js', 'posts.set(n, post.obj);', "posts.set(n, post.obj); for (const h of post.obj.media ?? []) { const mf = await get(`${at}/media/${h}`); if (mf) media.set(h, mf.bytes); }", ['media']],
 ['P7 §7.2 index version backwards', 'src/index.js', 'if (index.obj.version < pin.indexVersion) return bad', 'if (false) return bad', ['the-reader','publish-interface','rewrite']],
 ['P8 §7.2 same index version diff address', 'src/index.js', 'if (index.obj.version === pin.indexVersion && index.address !== pin.indexHash) return bad', 'if (false) return bad', ['the-reader','publish-interface','rewrite','views']],
 ['P9 §3.6 same profile version diff address', 'src/profile.js', 'else if (p.version === pin.profileVersion && profile.address !== pin.profileHash) return bad', 'else if (false) return bad', ['contest','the-reader']],
 ['P10 §3.6 host for rejected branch', 'src/profile.js', "if (mine) return bad('host', 'serves a branch the recovery rejected');", 'if (false) return null;', ['contest']],
 ['P11 §7.2 never-there number', 'src/index.js', 'if (was === undefined) return bad', 'if (false) return bad', ['publish-interface','the-reader']],
 ['P12 §9 cross-origin redirect', 'src/fetch.js', 'if (next.origin !== parsed.origin) throw', 'if (false) throw', ['fetching']],
 ['P13 §9 https only', 'src/fetch.js', "protocols = ['https:'],", "protocols = ['https:', 'http:'],", ['fetching']],
 ['P14 §6.1 carrierOf format', 'src/envelope.js', 'export const carrierOf = (anchor, n) => `${anchor}:${n}`;', 'export const carrierOf = (anchor, n) => `${anchor}/${n}`;', ['envelope','media','padding']],
 ['P15 §6.1 hkdf salt', 'src/envelope.js', "crypto.hkdfSync('sha256', z, epk, INFO, 52)", "crypto.hkdfSync('sha256', z, '', INFO, 52)", ['envelope']],
 ['P16 §6.1 length prefix LE', 'src/envelope.js', 'padded.writeUInt16BE(plain.length, 0)', 'padded.writeUInt16LE(plain.length, 0)', ['envelope','padding']],
 ['P17 §8.2 create-once for strangers', 'src/hub.js', 'if (ownersFile(name, cur, n) || !ownersFile(name, bytes, n)) return { status: 409, headers: CORS };', 'if (ownersFile(name, cur, n) && !ownersFile(name, bytes, n)) return { status: 409, headers: CORS };', ['publish-interface','posts-and-targets']],
 ['P18 §8.4 same anchor', 'src/hub.js', 'old.anchor !== o.anchor ||', 'false ||', ['publish-interface']],
 ['P19 §7.1 unparseable body -> identity', 'src/profile.js', 'catch { parsedRaw = null; }', 'catch { parsedRaw = { anchor: learned }; }', ['the-reader','first-contact']],
 ['P20 §7.2 top below issued', 'src/index.js', 'obj.top < set.top', 'false', ['the-index','the-reader','top-and-rumors']],
];
for (const [name, file, from, to, gates] of probes) {
  const full = path.join(root, file), before = fs.readFileSync(full, 'utf8');
  const n = before.split(from).length - 1;
  if (n !== 1) { console.log(`${name}\tFROM MATCHES ${n}`); continue; }
  fs.writeFileSync(full, before.replace(from, to));
  const res = gates.map((g) => { const r = spawnSync(process.execPath, [path.join(root, 'examples', g, `${g}.js`)], { cwd: root, encoding: 'utf8' }); const at = ((r.stderr||'').match(/examples\/[^)\s]+\.js:\d+/)||[''])[0]; return `${g}=${r.status === 0 ? 'GREEN' : 'red@' + at.split('/').pop()}`; });
  fs.writeFileSync(full, before);
  console.log(`${name}\t${res.join('  ')}`);
}
