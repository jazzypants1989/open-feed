---
model: deepseek-v4-pro
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:41:08.089Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
reasoning_effort: medium
finish_reason: null
tokens: null
wall_seconds: 174
truncated: false
reasoning_chars: 36266
---


<details><summary>Model reasoning trace (36266 chars) — kept because rejected alternatives often live here</summary>

```
We need answer design protocol. Need think deeply. Need produce argued design. User wants design brief response. Need design from first principles. We can choose. Need ensure floor assurances. Need no dependencies: Ed25519, SHA-256, HTTP, JSON, base64. Easy implement. Interop RSS/Atom/JSON Feed/fediverse/Bluesky. Need minimal.

We need design protocol. Let's reason.

We need decentralized personal publishing/interaction. Person publishes writing, photos, short posts; others read reply react. No central service. Hubs serve one/many over HTTPS. Adversary hostile hub operator inside audience. Four floor assurances:
1 host cannot speak for you. Nothing serves as yours verifies unless signed by key never host's.
2 host cannot read what wasn't meant for it. Content addressed chosen people unreadable by host.
3 host cannot keep you. Leave with identity and archive, key/copy always on device.
4 people other hubs first-class. private cross-hub without hub access-control agreement.

Priorities no dependencies, easy implement, interop, minimal.

Need design. We can propose. Need be concrete. May need include encryption construction. Key change/recovery. Scenarios.

Need think architecture.

Key ideas: identity as Ed25519 public key. Person is keypair? But grandma onboarding no key shown, recovery by daughter. Need not show key but key on device? Need recovery via social/secret? Need design key recovery under hostile hub. Host cannot keep you: key/copy always on device. But grandma loses phone, back by calling daughter. That implies daughter can help recover identity? Maybe identity can be changed/rotated? We need key change. Maybe identity is not key directly? Need think.

Assurance host cannot speak: signed by author key. So identity tied to verification key. If grandma loses phone and no key shown, how recover? If identity is keypair, losing device = lost key if no backup. Need recovery. Could use deterministic key from passphrase? But "never shown a key", "never told store file", calls daughter. Might daughter hold a recovery secret? Initial app picks name, creates keypair, maybe stores encrypted backup at daughter? Or uses secret sharing? Non-goal continuity across total key loss, but scenario says grandma loses phone and is back by calling daughter. User wants key recovery. Need design.

Maybe identity can be a self-certifying identifier not just raw public key, with rotation? Need make "identity" stable across key changes? If key loss total, continuity of stranger's view across total key loss non-goal. But grandma's family follows with one tap? Hmm scenario 1 after woman leaves, mother's app follows her with one tap; his frozen copy of old content reads stale rather than as her. That implies reader knows latest key/location? Identity stable maybe via URL? Let's parse.

Need first principles.

Potential approach: Each person has an identity document (signed by an "identity key"?) stored at their personal URL? But no global registry. Identity primitive could be a URL (HTTPS) containing a signed map of current signing key(s) and hub endpoints. But host controls URL if on their hub, can serve stale/forged map? If map signed by identity key, host cannot forge. But first contact via URL? If identity = URL, host can block/change? But readers can cache keys. Host cannot speak for you. If URL under hostile domain, host can remove/redirect. For leave, identity should not change. Need identity independent of host. Could be "did:key" or "public key fingerprint" as identity. But then discovery across hubs? Need endpoint. Maybe identity primitive is Ed25519 public key (or hash) and a signed "profile document" containing hub URL(s). Readers fetch from hub? Actually person interacts with other hubs: A follows B. Need know where to fetch B content. Could be from a "follow" URL. Scenarios: mother's app follows her with one tap after she leaves. That could be via a URL/QR that points to new hub? Need identity not change when domain goes. If identity is key, domain can change. People can discover via "introductions" or contact. But existing readers find them when domain goes? If identity is key, reader has B's key and a profile with endpoint; if domain unaffordable, B can update profile on new hub; but if reader doesn't know new hub? "Existing readers find them" implies domain goes but identity stable, and maybe readers poll old domain? Old domain unaffordable may be gone; how find? Could rely on DNS? If identity key used with WebFinger? Need think.

Maybe design should avoid global registry but use signed "pointer" at old domain? If domain gone, no. But scenario 4 says family.example becomes unaffordable. Everyone moves. Nobody's identity changes. Existing readers find them. Maybe existing readers have cached current hub URL? Need update path. Could use readers polling old URL; if domain gone, no. Could use DNS? If domain gone, can't. But maybe they know each other's current hub from a signed "contact" or "introduction" that is gossiped? Or use existing feed readers? Let's think simpler.

Could define identity as a URL. Then if domain goes, URL changes, violating nobody's identity changes. So identity primitive must be not domain. Could be public key hash. But then "existing readers find them" after domain loss: readers need a way to locate current hub. Can use signed "key directory" stored at each known hub? Maybe when A's domain goes, B's reader has B's contacts? Wait existing readers of A (e.g. B) need find A. If A moves from family.example to new.example, B's reader might not know. Unless A sends an update through some other path. In decentralized systems, you can fetch old URL but domain gone. Could use "follow" as a signed record that includes a list of potential hubs? Or use DNS TXT? No global service. The only way to find A after domain loss is via some other hub or contact that B already knows, or via the content signed and gossiped.

Maybe the design can say: identity is a public key, not URL. Discovery is by "intro" or a signed profile that is distributed to followers. When domain goes, if old hub unreachable, reader can use any cached profile/update or contact method. Existing RSS readers? Interop via RSS means public content. But private content needs hubs.

Need answer likely acceptable: identity is Ed25519 public key fingerprint. The "person" is keypair. Key loss recovery: maybe via social recovery with trusted contacts (e.g., daughter) holding encrypted key shares, or a "recovery key" stored by daughter's app. Grandma's daughter can vouch/restore. Need design.

But floor assurance 4 cross-hub private without access control agreement between hubs. How can B on family.example share family-only content with A on a.example? If private to chosen people encrypted end-to-end by author. Hubs are just storage/relay. So B encrypts to A's public key(s). A's hub can't read. How address without publishing audience? Need hide who encrypted message is for. We can use per-recipient wrapped keys or key encapsulation. But if hub stores each message with envelope containing recipient hints? Need hide *who* from non-recipient? Non-goal says beyond hiding *who* encrypted message is for. Adversary hub operator might be inside audience for family-only, but for messages not for host: host cannot read content; but can host learn recipients? Probably maybe yes via envelope metadata? We need construction: address recipients without publishing audience. Could use a "recipient key" per audience group? Hmm.

If content is encrypted to a symmetric key; symmetric key encrypted to each recipient's public key. If each recipient is public key, listing public keys in envelope reveals audience. Need hide who encrypted message is for (traffic). But non-goal says anonymity beyond hiding *who* an encrypted message is for. Wait phrase: "Anonymity or traffic-analysis resistance beyond hiding *who* an encrypted message is for." Means non-goal includes anonymity except hiding who encrypted message is for? Actually "beyond hiding *who* an encrypted message is for" could mean the design does hide recipients? They want in section 6: "how recipients are addressed without publishing the audience". So need some recipient privacy.

Could use pairings? No dependencies. Ed25519 only. Hiding recipients with public-key cryptography without pairing is possible using "key encapsulation to a group key"? But recipients need recognize message is for them. If no list, hub can't learn. Need design.

Simplest with Ed25519: We can encrypt message with random symmetric key, then for each recipient compute wrapped key. But envelope lists wrapped keys; outsiders see count maybe and maybe not identities if wrapped key doesn't include recipient ID but recipients try decrypt each? For each recipient, the sender can compute ECDH ephemeral + recipient public key? Ed25519 is signature, not encryption. Need encryption construction no dependencies. Cannot use X25519? Standard library Ed25519 maybe Ed25519 is signature. Encryption can be constructed with ephemeral X25519? But no JOSE. They list Ed25519, SHA-256. Could implement Diffie-Hellman using X25519 if standard library has Ed25519? Actually Ed25519 keys are Edwards; X25519 is Montgomery. Many libs provide both? They specifically said Ed25519. Need perhaps design using Ed25519 signatures only plus symmetric encryption? But standard library may not include AES? Need standard library encryption? They say "Ed25519, SHA-256, HTTP, JSON, base64." No mention AES, but need encryption. Could use XChaCha20/Poly1305? Standard library may not include. Hm. The constraint "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." Maybe they assume standard crypto includes Ed25519 and AES? But listed Ed25519. Could use Ed25519 for signatures, but for encryption need some public-key encryption. We may need define a construction using X25519 (which is often paired with Ed25519 in libs) or use Ed25519 keys converted to X25519. But "no JOSE library" maybe okay using X25519 and ChaCha20/Poly1305? But #1 lists no AES? Need interpret: "no dependencies" means implementable from standard library items: Ed25519, SHA-256, HTTP, JSON, base64. Maybe standard library includes Ed25519 but not X25519? In many languages stdlib may include Ed25519? Go has crypto/ed25519. But X25519 in stdlib? Go has crypto/ecdh? Not sure. Node crypto includes Ed25519 and X25519. Python has hashlib but Ed25519 not stdlib? Actually PyNaCl not stdlib. But design not implementation.

We need choose encryption. Could use "sealed box" with ephemeral X25519 and recipient's X25519 public key. But identity uses Ed25519 signing keys. Could derive X25519 from Ed25519? Not generally. Could have users generate both signing and encryption keys? But identity primitive one key? We can define identity keypair as Ed25519 for signing; encryption subkey maybe X25519 included in signed profile. But floor assurance 2 host cannot read content. Need encrypt to recipient's encryption public key. This can be an X25519 key. But no dependencies? Use X25519 + ChaCha20Poly1305 maybe. Could define encryption using X25519 and AES-GCM. Need no JOSE but raw.

Maybe we can design encryption with only Ed25519 signatures? Public-key encryption from signatures? There is "Elligator" etc, not easy. Better include X25519 and AES-GCM / ChaCha20. But brief says Ed25519 only? It says "from a language's standard library: Ed25519, SHA-256..." Might be list of allowed primitives. Could we implement X25519 from standard library Ed25519? Not practical. Could use Ed25519 key for X25519 conversion if using birationally equivalent? Ed25519 public key can be converted to Curve25519 point? Actually Ed25519 signatures use Edwards curve; X25519 uses Montgomery. There is a known conversion from Ed25519 public key to X25519 public key (edwards to montgomery) if sign bit? Secret key conversion not trivial but possible. But "standard library Ed25519" doesn't expose scalar. Could use ephemeral shared secret via "crypto_sign_ed25519_pk_to_curve25519" in libsodium, not standard. Hmm.

Maybe we can avoid public-key encryption by using signed "postcards"? No confidentiality. Need encryption.

Maybe design can specify "box" using X25519 + ChaCha20-Poly1305 and identity key is Ed25519; keypair includes X25519 encryption key. This adds complexity but okay. But priorities say Ed25519. Could use "crypto_box" (Curve25519+XSalsa20/Poly1305) but no JOSE. But no dependency? Implement from standard library? Maybe not.

Alternative: Use "password-authenticated" / "shared secret" for private groups? But cross-hub without previous agreement? People can share family-only content addressed to chosen people. Could use "topic keys" distributed via key encapsulation? Need public key encryption.

Could use RSA? No.

Maybe we can define all encryption with "sealed envelopes" using ECIES over X25519 and AES-256-GCM; even if not standard library, implementable with small code? But brief says only standard library. Hmm.

Maybe we can argue that any real protocol needs an AEAD and a Diffie-Hellman primitive; the allowed list should include X25519 and ChaCha20/Poly1305 or AES-GCM. But user explicitly lists Ed25519 only? "No dependencies. Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." Ed25519 is signature; SHA-256 hash; HTTP, JSON, base64. There is no AEAD. But encryption requirement impossible without symmetric encryption. Maybe we must assume standard library has AES-GCM? Most have some. But original says no dependencies beyond standard library; standard library includes AES-GCM in many languages? Maybe yes. But they named Ed25519 but not AES. Maybe "Ed25519, SHA-256, HTTP, JSON, base64" as examples, not exhaustive? They said "from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." Could include AES-GCM. But they emphasize no JSON canonicalizer, no JOSE. We can use AES-GCM manually. We can also use X25519? If not in stdlib, maybe use Ed25519 for signatures and "sealed box" using ephemeral X25519; but maybe standard libs have X25519 as "Ed25519"? Hmm.

Need decide. In answer, maybe state "I require one extra primitive beyond the letter of the brief: an AEAD and an ephemeral DH function. I will use X25519 + ChaCha20-Poly1305. If forced to Ed25519 only, confidentiality is impossible. I flag this." But user wants design from first principles, not necessarily challenge? They said if think floor achievable only at price not worth paying say. But we can design.

Need maybe address "host cannot read what wasn't meant for it" with encryption where sender encrypts to recipient's "encryption subkey". Host cannot read. If hub operator is an abusive family member inside audience? They may be a legitimate recipient of some family posts. The adversary says operator may be inside family—entitled to see family-only content, holding legitimate credentials. For posts not meant for them, they can't read. If they are recipient, they can read; that's okay. Requirement: "Content addressed to chosen people is unreadable by anyone else, the host included." So host cannot read if not chosen.

But "host cannot keep you": key and copy always on device. Need the client stores private key and data locally. Hub stores encrypted/signed copies but cannot withhold. Person can leave with identity and everything she wrote. If host deletes content, can she still have everything? The brief says "because the key and a copy were always on your device." That suggests client keeps full copy of one's own content. For grandma phone lost, no copy? But if daughter helps recovery, maybe backup of keys not content? Need discuss.

Let's build architecture.

Potential design: 
- Artifacts:
  - Identity: a signing Ed25519 keypair. Identity ID is the public key fingerprint (e.g., base64url of full key or SHA-256? Need choose).
  - Profile document: JSON signed by identity key containing current hub URL(s), encryption subkey(s), display name, avatar, recovery delegates? This is "person record".
  - Post/entry: JSON object with content, timestamp, reply targets, reactions, visibility. Signed by author key.
  - Envelope for private: encrypted JSON to recipients, with header.

- Hubs serve collections: HTTP endpoints. Maybe each identity has a "collection" of signed events. Hub stores and serves items. For public posts, items are signed. For private, items are encrypted to recipients; the signed content is inside encrypted payload? Need host cannot alter/backdate. For private, hub cannot read content, but can it alter ciphertext? If it deletes/reorders? Signature inside? Need design.

Assurance 1: For public content, signed by author key. For private, the plaintext must be signed by author, then encrypted. Recipients verify. Hub cannot forge.

Assurance 2: Private content encryption.

Assurance 3: identity key and copy always on device. Hub cannot keep you: reader can re-point to new hub via signed profile. Host may refuse to serve, but can't stop.

Assurance 4: Cross-hub private: A's hub stores ciphertext. B's reader fetches from A's hub? Or from A's and B's hubs? Need interaction.

Let's define "hubs" as dumb storage and delivery. A person publishes to their own hub. Others read by fetching from author's hub. Replies are published to replier's hub, but need link to original and maybe deliver notification to original's hub? For private cross-hub, if B replies to A's private post, B encrypts reply to recipients (original audience? maybe thread participants). B's hub serves reply. A's reader needs find B's reply? If B is on family.example and A on a.example. A's reader polls A's hub (her own) and maybe also B's hub? How does A know B replied? In decentralized systems, reply delivery can be "mention" or "send" a copy to the original's hub, or readers poll all known contacts. Brief: "Two hubs, one thread. A on a.example, B on family.example. A family-only post, a reply, and a reaction cross the hub boundary, with no access-control configuration on either hub." We need design.

Could have hubs "relay" or "inbox" endpoints. When B replies to A's private post, B's client can POST an encrypted envelope to B's hub (so B's own hub stores reply) and also POST a "delivery" copy/pointer to A's hub (A's inbox), encrypted to A (and maybe thread audience). A's hub cannot read. A's reader fetches inbox. But A's hub could be hostile to A (scenario divorce): host controls inbound message path. He could drop incoming replies, or not deliver. But can he forge? No. Can he read? No. Can he block? Yes. But assurance 4 says people on other hubs are first-class; with no access-control agreement. It doesn't require hostile hub delivering all inbound. In divorce, hostile hub may block private messages; but she leaves. Maybe "People on other hubs are first-class" means they can exchange without hubs agreeing; but if recipient's hub is hostile, it may block. Is that a failure? Floor assurance 4: "Two relatives self-hosting on separate domains share, reply, and react to each other's family-only content as if they were on one hub, with no access-control agreement between the hubs." If one hub hostile, maybe not "as if one hub". But scenario 1 doesn't include cross-hub private while she is on hostile hub? Maybe he can't read, but can he block family from seeing? This would be denial of service. The floor doesn't explicitly guarantee availability against host. "The host cannot keep you" means you can leave. "People on other hubs are first-class" maybe requires that no access control agreement needed, not that malicious hub can't drop.

Need design delivery.

Maybe use "inboxes" as feeds. Each person has an inbox endpoint on their hub. When someone replies, their client sends the signed/encrypted reply to both the replier's hub (their own outbox) and the parent author's hub (inbox), and maybe to all participants' hubs? But hub can filter.

Alternatively, readers can fetch from all participants' outboxes directly, no delivery. For a thread, A's post is on A's hub, B's reply on B's hub. A's reader can discover B's reply via B posting a "reference" to A's post? But if A doesn't know B replied, how? Could poll hubs of all contacts? "small groups" maybe feasible. On first contact, A follows B? If family-only, A and B likely have exchanged keys. Reader can poll each contact's hub. Reply contains `in-reply-to` pointing to A's post; if A's reader polls B's hub, it sees reply. This avoids inbound message path. But if A doesn't know B's hub? They know via profile. Could be okay. Big lazy hub with ten thousand identities: polling all contacts might be heavy but per-identity cost flat? If a user has few contacts, okay. Commercial hub with ten thousand customers not all contacts.

Could also have "delivery copies" to original hub for notification, optional. The host can't forge or read. But can drop. To survive hostile host, one can leave.

Need design content addressing and timestamps. Host cannot alter/backdate. Need signed items include timestamp and hash links? "frozen copy of old content reads as stale rather than as her" in scenario 1. This suggests use of signed "profile" with current hub and maybe a "key change" log. If mother's app follows her with one tap after she leaves, how does it not use old hub's frozen copy? The follow one tap likely gets a new pointer from the woman's device (QR/URL) or signed profile. The old hub may still serve old profile saying old hub. Mother's app must know new hub. She gets a new URL or introduction. "his frozen copy of her old content reads as stale rather than as her" means if readers fetch old hub, they see old signed content but profile with current key? If the old hub serves a stale signed profile, it's still signed by her but old. If profile includes a "sequence" or timestamp, newer profile at new hub supersedes. Reader can detect stale if they have seen newer. But first contact after key loss? Hmm.

Need define "staleness" mechanism. Host cannot backdate because signed timestamps. But if host serves old signed post from before, that's genuinely hers. It reads as old because timestamp. It cannot be presented as new. "Frozen copy of old content reads as stale rather than as her" likely means because no new signed posts after departure. Her new posts on new hub signed with same key; old hub only has old posts. No need special mechanism.

But if host serves an old signed profile that points to old hub, a new reader might be fooled into following old hub? But if she has moved, new readers should not use old profile. Need discovery from a "one tap" via QR/URL to new hub or new signed profile. The old hub can't forge new. Maybe okay.

Need identity primitive. Let's evaluate options:
- URL (e.g., acct:user@domain) — host can control, violates leave.
- WebFinger acct — same.
- DNS domain — host controls.
- Decentralized identifier (DID) tied to public key, e.g., did:key. But no dependency? did:key is just a public key encoded. Good.
- Raw Ed25519 public key as ID. Simpler. Public key fingerprint base64url of full 32-byte key. Short: `k1...`. But if key rotates, identity changes? Scenario key loss/rotation. Need separate identity from current key? We can allow identity to be the original key fingerprint; rotation adds successor keys. Or identity = stable public-key fingerprint of a "root" key; current signing key can rotate. But if root key lost? Non-goal continuity across total key loss. For grandma, maybe she recovers root key from daughter.

Need argue identity as Ed25519 public key fingerprint. Person is the keypair. Alternatives rejected: URL (host can hold), DNS, username@domain (same), DID document (needs resolution), blockchain (dependency). Public key is self-authenticating. We can encode as `pfp:<base64url>`? Need avoid fancy IRI? Can just use `key:z6Mk...`. But no need.

However, if identity is raw public key fingerprint, there is no human-readable name. Profiles can have display name. But identity string is long. That's okay. Grandma "picks a name" but app shows name; identity is key fingerprint. She is never shown key.

Need key rotation and recovery. Need design robust.

Maybe structures:
- "Persona" or "Identity" is an Ed25519 signing key. We call `root` key? Maybe only one key. Rotating to new key is problematic: if identity = public key, rotating changes identity. But can sign a "delegation" from old key to new key. The identity can remain old key fingerprint; new key is authorized. For verification of posts, a reader must trust a chain of key rotations from old to new. After total loss, cannot rotate because old key lost. Non-goal says continuity of stranger's view across total key loss. But scenario grandma loses phone and is back by calling daughter: maybe no need same identity for strangers? But scenario says "She is back by calling her daughter." Could mean daughter has a backup of her private key (recovery) so identity continues. We can design social recovery to restore the same key.

Maybe:
- A keypair can be recovered via a "recovery bundle": encrypted copy of the private key to one or more recovery delegates (e.g., daughter). On onboarding, app creates a random symmetric recovery key, encrypts the identity private key with it, splits or encrypts that recovery key to recovery delegate's public key? Simpler: encrypt the private key to the daughter's public key. Daughter's device stores a recovery envelope. When grandma loses phone, she calls daughter; daughter sends recovery envelope back; grandma's new app decrypts. Daughter cannot read grandma's private key because envelope encrypted to grandma? Wait if encrypted to daughter, daughter can read. Need not let recovery delegates access key. Could envelope be encrypted to grandma's own recovery password? If no password, phone lost, no way. Daughter could hold an encrypted blob encrypted to a "recovery key" that is itself encrypted to daughter? Let's design.

Need "never shown a key, never told to store a file outside the house." Daughter can help. The daughter likely has a relationship in the app. Onboarding grandma picks name; app generates signing key. It might display a QR for daughter's phone to scan as recovery contact. Daughter's app stores a "recovery share" (e.g., a sealed copy of grandma's private key encrypted to a randomly generated recovery secret, and the recovery secret is split between grandma's app? Hmm). If grandma loses phone, daughter can send the recovery share back to grandma's app. But if the share is encrypted to a secret only in grandma's lost phone, no. Could daughter's app also hold the recovery secret? Then daughter can read if coerced? Maybe okay? The adversary is hostile ex-partner, not necessarily daughter. But if daughter is malicious? Need maybe.

Simplest: On onboarding, app generates identity key and a random recovery password (or passphrase). It can encrypt the identity private key with the recovery password and store the encrypted blob on the daughter's device. It also tells grandma to call daughter; never show key. But if grandma loses phone, she installs app on new phone, calls daughter. Daughter sends the encrypted blob. Grandma needs recovery password. Does she know it? She wasn't told to store a file, but maybe the app shows a recovery passphrase? The scenario says never shown a key, never told to store a file outside the house. It doesn't say never shown a recovery passphrase. But grandma might not remember. Could use "Daughter approves recovery" with daughter's app holding the actual recovery password (or a share). Then grandma only needs daughter to approve. That seems right. Daughter's app has recovery capability. The threat model is hostile hub, not necessarily family. But if daughter is malicious, she could take over. However, this is a recovery contact, a trusted role. Need maybe use two contacts or daughter holds a "recovery key share" not enough alone.

But user wants simple small groups. Could define recovery contacts as people with existing identities; your app gives them a "recovery token" sealed to their identity. They can't read it? Actually their device can use their private key to decrypt a recovery secret? Let's think: When Alice sets Bob as recovery delegate, Alice's app creates a recovery secret `r` (random 32 bytes). It encrypts Alice's private signing key with `r` (AES-GCM) -> recovery blob. Then it encrypts `r` to Bob's encryption public key -> recovery ticket for Bob. Bob's device stores the ticket. If Alice loses phone, Bob's device can decrypt `r` (because Bob's private key) and send `r` and blob to Alice's new app. But Bob's device could also decrypt Alice's private key if it has blob too? If Bob has only ticket, he can decrypt `r`; then if Alice's recovery blob is stored on Bob? Actually Alice's app could store both recovery blob and ticket with Bob. Then Bob can decrypt everything. That makes Bob fully able to read/impersonate Alice. Is that acceptable? A recovery delegate is trusted. Maybe yes. But "hostile operator inside family" might be the daughter? Not the adversary model. 

Alternative: threshold of 2 recovery contacts with Shamir secret sharing. But no secret sharing? Can implement Shamir but maybe too much. Could use simple XOR split: `r = r1 xor r2`; give shares to two contacts. Requires two to recover. More complexity. But grandma calls daughter only, so one daughter suffices; maybe daughter holds a share and cloud? Not allowed? She calls daughter, not second.

Maybe use "social recovery with one trusted contact" explicitly trusted. "Recovery contact holds a sealed copy of the private key encrypted to them; they can, by policy, recover it. This is a key escrow by a family member, not the hub. If your recovery contact is also your adversary, this fails—this design does not fix that." Good honesty.

Need also key rotation for theft. If private key stolen? Non-goal continuity across total key loss maybe. But section 5 asks key change and recovery: rotation, loss, theft, and contested departure hostile operator claims departure is forgery. Need design:
- Rotation: current key signs a "rotation" statement: old key signs new key and timestamp. Identity maybe remains old key, with a chain. Or if identity is current key, rotation creates new identity, which breaks following. Better identity is a stable "identity key" that can delegate? Wait if identity = public key of original signing key, and that key is lost, cannot rotate. If identity is a separate "root identity key" that only signs key rotations, it can remain offline. But grandma onboards with one key; maybe app generates root and a signing subkey? Need manage. Let's design more concretely.

Could define identity as a "stable identifier" which is the hash of a "genesis key" that signs a "key document" listing current signing keys. The root key is the identity; it can be kept offline? But grandma's phone holds it; if lost, recovery can restore. Signing subkey can be rotated by root. Posts signed by subkey. Verification requires fetching key document. Host cannot forge.

Maybe overkill. Simpler: identity key itself signs content and profile. Rotation is possible only if identity key is available: it signs a statement authorizing a new key. The identity remains the same (old public key). Readers verify chain from old to new. If identity key lost, cannot rotate; recovery restores old key from backup, or start new identity (non-goal). Theft: if attacker steals identity key, they can sign as you; rotation by thief can lock you out? If you also have key, you can sign rotation too; conflict. Need device copy. If key stolen, you can rotate to a new key signed by old key, but thief can also. Need perhaps "contested departure": hostile operator claims departure is forgery. If operator doesn't have key, can't. If he claims old profile signed by her is valid and new posts are not? New posts signed same key; old signature verifies. If she rotates, old key signs new key; operator can serve rotation? If operator doesn't have key, can't. If operator has old key? Then all bets. Need name failure mode.

Maybe use "identity = Ed25519 public key; posts signed with that key." Profile can be signed same key. The old hub can serve stale profile but cannot forge new. The woman leaves: she continues signing with same key. Old hub's copy has old signed profile. Readers who already follow her may have cached her key and maybe current hub. Mother's app one tap follows new hub but verifies key same. Old hub's stale content reads as old (timestamps).

This is simple. Key rotation can be supported by a signed "key update" record in the feed. But if identity = old key, after rotation your ID remains old key; new posts signed by new subkey, with a signed delegation. Readers need follow chain. We can define but maybe say rotation is deliberately limited; root key is identity; if lost, recovery. Theft: use root key to rotate to new? Hmm.

Maybe define "person" as an Ed25519 public key (the *identity key*). All content signed by that key. Key rotation/recovery:
- Recovery: private identity key encrypted to recovery contact(s).
- Rotation: identity key signs a "key rotation" object naming a new identity key. The person's identity does *not* carry over? If identity is key, rotating to new key means identity changes, which violates "identity changes" unless old key remains anchor. Could preserve by defining identity as the *genesis key fingerprint* and allow current signing keys. But then root key is identity. If root key lost, recovery; if root key stolen, you can't disown without changing identity (non-goal?).

Let's design with a **root identity key** and **signing subkeys**. But for ease maybe all posts signed by root? Subkeys complicate. Weekend implementer? Need simplicity. We can say "There is one key. Rotation is not a first-class continuity mechanism. If it is lost/stolen, you recover it or start a new identity. This is an explicit tradeoff for weekend implementation." But user asks key change and recovery; need answer.

Maybe use a "key document" signed by a root key:
- Identity ID = base64url(sha256(root_pubkey))[:?] or full root pubkey.
- Profile/key document includes:
  - `id`: identity ID
  - `root`: root Ed25519 public key
  - `enc`: X25519 encryption public key
  - `rel`: current hub URL(s)
  - `name`, `avatar`
  - `created` timestamp
  - `recovery` (optional)
  - `signingKeys`? If only root signing, simpler.

Could just use root key for signing and an encryption subkey for ECDH. Profile signed by root. Identity is root pubkey. Content signed root. Rotation of encryption key possible via signed profile. Rotation of signing root changes identity; not supported except recovery. This meets non-goal "no continuity across total key loss". But scenario grandma recovers root key via daughter. Good.

Need avoid host serving old profile as current. If profile includes `updated` timestamp. Readers cache profile and can accept newer signed profile. But can a hostile hub serve an old profile that points to old hub, and because signed, reader thinks stale but valid? Need reader know there is newer? If reader first contact? Scenario: mother follows after she leaves, she one-taps from daughter? Hmm.

Profile discovery:
- People exchange "contact cards" out of band or via QR/URL. A contact card is a signed profile object (or a URL to fetch one). The recipient verifies signature. It contains identity key, current hub, encryption key.
- When following someone, you fetch their profile from their current hub URL and verify signature.
- On poll, you fetch the profile again? Could detect updated hub. But if hub is hostile and serves old profile, you can't know if moved unless you have an out-of-band update.
- For public RSS interop, we can serve RSS/JSON Feed with signed? Hmm.

Need "The domain goes. Everyone moves. Nobody's identity changes. Existing readers find them." If identity is key, existing readers can find them if they can get new profile. How? If old domain unaffordable, maybe they use a "profile update" that was delivered to followers before the domain went away. Or a "follow" relationship includes a last-known profile cached. But
```

</details>

