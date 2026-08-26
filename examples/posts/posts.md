# Posts

**Spec:** §5 entire — §5.1 `number`, §5.2 `at`, §5.3 `rel`, §5.4 `target`, §5.5 `media`, §5.6 private
messages are posts. Appendix B.6 and B.7 are its vectors.
**Run:** `node examples/posts/posts.js`

A post is the last of the three file shapes and the only one that carries what somebody wrote. It is
an ordinary signed file (§2) whose object says at most four things: the number it is published at,
when its author says it was written, what it says, and what it answers. **A post is immutable,
created once, and signed by any key in its author's chain at the time of writing** — so a post
signed before a rotation keeps verifying after it, and no post is ever edited in place.

There is one such object and there are no others. A reply, a reaction, a repost, an edit and a
direct message are all this object with a different `rel`, and the only structural difference
between a public post and a private one is whether the content sits inside an envelope (§6). Nothing
in the protocol is a like endpoint, a boost verb, a revision history, or an inbox.

## What the output shows

**A post, and its members.** The first block prints Appendix B.6 byte for byte — 66 bytes of body,
one `\n`, 86 characters of signature — and names each member against the object §5 opens with. Then
two facts that go together: post 1 verifies under alice's **anchor key** and post 3 under **the key
she rotated to**, because a reader checks a post against *any* key in the chain (§7.4); and a
second, different file PUT at the path where post 1 already lives comes back `409`, because a
numbered post is created once (§8.2). Immutable and signed-by-any-chain-key are the two halves of
the same design: the key can move, the file cannot.

**The number is inside the signed bytes.** §5.1 is one sentence and it is doing structural work. The
example signs one `at` and one `text` at number 2 and again at number 6, and the two files have
different addresses; strip `number` out of the body and both hash to the same thing. That is the whole
mechanism — because the number is inside the bytes, it is inside the address, and post 2 *is not*
post 6 at any hash. So a hub that wants to show you post 2 where post 6 should be has to serve a
whole different file, and the reader that checks the served file's address and its `number` against the
index says **tampered** (§7.2) — `post 6 is not what the index lists`.
Nothing about the file was tampered with: the signature is alice's and the bytes are hers. It is
simply not that post.

**At the hub, the number is the other half of the reclaim rule.** A hub checks nothing on the
ordinary path of a post, so a stranger can `201` a file into a number alice has not reached yet —
and the file he replays can be one of *hers*, signed by the key her chain ends on. What tells the
hub it is not her file for that number is that it does not declare that number. When she publishes
her own post 9 it does, and the hub replaces his (§8.5). Take `number` out of the bytes and the replay is
indistinguishable from her own post 9: the hub would have to keep it and refuse her, forever, on her
own name. `examples/publishing/` owns §8.5; this block only shows the half that §5.1
supplies.

**`at` is content time, and is never a verdict.** This one is worth being emphatic about. The
example publishes a post dated 1970 and a post dated 3026. Both are perfectly valid; the reader
returns **ok** with no note; an app that sorts by `at` gets `5 1 2 3 4 6` while the index's own
order is `1 2 3 4 5 6`. Neither timestamp was consulted to reach any verdict, and neither decides
precedence: a number has one hash ever (§4.1) and the index that says so is signed. The
complete list of places a clock appears in this protocol — `at`, the seven-day "recently restored"
flag, the rewrite cadence — and not one of them gates anything. The reason is in the threat model:
the adversary runs the server, and a party who runs the server also sets its clock.

**A reply, a reaction, and a private message are the same kind of object.** The block prints a
`like` and a `reply` side by side; they differ in `rel` and in whether there is a `text`. The third
line is the encrypted post from further down, which is the same object again. `rel` is `reply`,
`root`, `like`, `repost`, `quote`, `mention` or `supersedes`, or an absolute URL for anything a
vocabulary of seven does not cover.

**An edit is a new post that withdraws the old one.** Post 7 carries `rel: "supersedes"` and a
target naming post 3 and its hash; the index withdraws 3 in the same amendment. The reader reads
**ok** and notes `withdrawn: 3`, and — this is the part that makes the SHOULD implementable — **the
the checkpoint keeps the hash post 3 had**. So sis's older reply, which targets `(3, that hash)`, still
resolves: the reader can see what it was answering even though the post is gone from the live set.
§5.3 asks a reader holding post 7 to show those replies under it, and without the remembered hash
every edit would orphan its thread.

**`target`, and the full hash.** The block prints Appendix B.7 byte for byte and names all four
members. `key` is the target author's **anchor key, never a URL**, because the URL can change and
the identity cannot; `location` is where the replier last knew that author to live, which is how someone
who moved gets found again (§3.5). `hash` is all 43 characters of the target's address — not a
prefix, not an opaque id.

**A reply whose target hash the index does not list is a reply to something else.** This is the rule
that makes the full hash more than decoration, and the example stages the attack it stops. Mum has
two signed files that each say "post 12"; her index lists one of them. Sis replies to each. For a
reader holding a checkpoint for mum, the first reply threads and the second is returned with its target
marked unresolved — and, correctly, the reader says nothing about it, because a mismatched target is
not evidence against anybody in particular (§7.4). Both replies are genuine and signed. What the
rule denies is the *author* who shows one room one post 12 and another room a different one: only
one of them is in the index a given reader verified, so only one of the two threads can look right.
The third reply names a 16-character prefix of the right hash, and it lands nowhere too: the
comparison is the whole string, and a reader that matched a prefix would let a replier thread under
a post whose hash they had only seen part of.

**`media`, and none on an encrypted post.** A public post carries `media` as an array of addresses;
the index lists each file by its address alone and the reader checks that the bytes hash to it
(§4.3). The encrypted post's public members are exactly `number`, `at`, `encrypted` — no `media`, no
`rel`, no `target`, because on an encrypted post all three are inside the envelope, and each media
entry there is `{hash, key}` rather than a bare hash (§6.5). `examples/the-index/` and
`examples/envelope/` are where those live.

**A private message is a post.** It sits at `/alice/posts/4` on **alice's own hub**, listed in her
own index, and there is no inbox anywhere for it to be delivered to — the example PUTs at a
plausible inbox path on mum's hub and gets a `404`, because the path does not exist in the protocol.
A non-recipient's reading key opens nothing; mum's opens it. The costs §5.6 insists on stating are
staged where they belong: what the hub learns from the shape of the file, and that it can withhold
the file and be named for it (`tampered: post 4 is listed and not served` — which does not give mum the
message), are `examples/envelope/` and `examples/reading/`; that alice's signature over this
ciphertext makes it provable by mum forever, and that withdrawing it reaches neither her copy nor
her proof, is `examples/publishing/`.

