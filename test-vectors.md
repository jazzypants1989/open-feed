# Open Feed test vectors

Known-good files for every construction in `open-feed-spec.md`. Each is produced by `tools/regen.js`,
which signs them with the weekend publisher, verifies them by running **two independent readers** over
them in the order §7 states, and then checks that this file carries them verbatim. Run
`node tools/regen.js` after any change to a schema, the signing format, or the envelope; it exits
non-zero on drift.

Keys are deterministic so the bytes reproduce. Note that a *different* signature line for the same
body is equally valid (§2.2): a verifier hashes the body and checks the signature, and never compares
files byte for byte.

## 1. Keys

```
alice anchor   (Ed25519 public)  pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY
alice rotated   (Ed25519 public)  kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs
alice restored  (Ed25519 public)  17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M
mum             (Ed25519 public)  5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU
sis             (Ed25519 public)  lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ
bro             (Ed25519 public)  Tt-buDzctWsjDmOG9DDd3IPy-4grdRXTB1VJTds1a5Q
alice reading   (X25519 public)   cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc
mum reading     (X25519 public)   Yu9nDDrlZOLjeg9rT9ZOffojS6Kne4lF4m93Ag8NGiU
```

## 2. The recovery commitment (§3.4)

Three members, committed one member at a time; two of them are a majority (§3.3). `sis` vouching
reveals `saltsis` and her key, and nothing about `mum` or `bro`.

```
salts             mum "saltmum"  sis "saltsis"  bro "saltbro"
SHA-256(salt|key) WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4
                  wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc
                  frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ
committed         {"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]}
```

## 3. Profile, `version` 1 (anchor)

The chain is one link long and the file is signed by the anchor key.

```
{"anchor":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY","version":1,"name":"Alice","chain":[{"key":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY"}],"recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
ns9k4GGpvO_nrDqF7kX0XDqZS-cYEMO_te5dERd7cR7VdX2UL5BQa8ZgjlHwtqwsJRuQ4anFeWCB1J7FTVKMBw
```

## 4. Profile, `version` 2 (a rotation)

The link carries the list that stood before it and is signed by the key it replaces, over the ASCII
bytes `<previous>-><new>` (§3.3).

```
{"anchor":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY","version":2,"name":"Alice","chain":[{"key":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"sig":"nWLFgpsi0aH7-kK-6p8OCOOlIRmI5VMRdOq0oiE3WuDjVxet2prcYFdQMLcmDI-r74mZGEnYxLe3k0Fi3rBUDA"}],"recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
fEaUyfiExFhauLWOoDi37at9BUYyrC-MNsnvXLVusx2BFhJzi8fOTHzaxLgClZlmUW-cSiVIbHxL3Yin04GTBg
```

## 5. Profile, `version` 3 (a restore)

The same link shape with vouchers instead of a signature: two of three — a majority — each revealing
only its own salt, counted against the `recovery` the link carries (§3.3).

```
{"anchor":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY","version":3,"name":"Alice","chain":[{"key":"pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"sig":"nWLFgpsi0aH7-kK-6p8OCOOlIRmI5VMRdOq0oiE3WuDjVxet2prcYFdQMLcmDI-r74mZGEnYxLe3k0Fi3rBUDA"},{"key":"17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M","recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"vouchers":[{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","salt":"saltmum","sig":"zlSag21icaKQIgVI-iopptghcCruIYne8uv1aI9P94VOSm-CoFQ3e44Ajp5zR0DPmvCwl3KJNKbJgCyFi-ZxBg"},{"key":"lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ","salt":"saltsis","sig":"ttyqfT-I4auqFG0udf45r76o5gavmZEnStB0E5oAcQAKIAYNpkJRz9LjIqJfu8ZiolEB9Gtabq9w-RYtVOIHDw"}]}],"recovery":{"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
cFu5nHM58WG2v12ax_h67RMagOUjSOy6yCVMZSTlOrej-YPl-ycPGO7rZ3sGirpDIhymc_ajtCV6uKCHxyjnDA
```

## 6. Post

The number is inside the signed bytes (§5.1).

```
{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}
Pe6ZO_mwGsToFUaNh1sRuPI7kTastKn7qJ3KpXyPBupKLLJzuoZiAnfwUbXTxnULHkLkqevKxmU3q3xPj1ehDQ
```

## 7. Post — a reply

The target names the author's anchor key, the number, all 43 characters of the address, and where
the replier last knew that author to live (§5.4).

```
{"n":3,"at":"2026-07-19T09:30:00Z","text":"congratulations, both of you","rel":"reply","target":{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","n":12,"hash":"_wcb5V3yCD3C6KmN7mOmNw3DKJcRdBJItfW0Z-Ic_kc","loc":"https://mom.example/mom"}}
S4mRckyGslGrhS5n9O6KmD0qqweGXOzu784PMH3sUHgrDqD5SliKvKiecBa6JWbIm9y1hkFTzor1_Bzqd433Dw
```

## 8. Post — encrypted

Only `n` and `at` are in the clear; the text, the relation, the target and the media references are
inside the envelope (§6.5), and so is the audience, naming each recipient by anchor key, reading key and
location (§6.4): one slot per recipient. The carrier bound into the associated data is
`pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY:5`.

```
{"n":5,"at":"2026-08-18T21:40:00Z","encrypted":{"epk":"bulurRC1e4YYuDGwVZj_Yh9ZgswZoponWSc5JsAp5z8","slots":[["cwNqOZ1KtPU","LRz0F-kLZzeE3HcRmOcfbdxrFr7PIszC4GJ6JiiQBW2D_2yuzRMWiemDHEawzpsH"],["SzNzzQy4o2c","2rsCQZAjQMhlxocGQd4baI0tsCQiZqRX8BtHmJ8mihXiGd5DtWA0mmPvzLY0Ite-"]],"ct":"bT2l-Lxak1AeelnJGWv8BBR7v_ZbRKLIJOr_Wy-mTOMsw6Vmuh8aPGJw1khx8Y8nFNm7surpaSrQA0FoVrlovHagSt458HjVN_PPMJR0f_HEpenv5Mw1mMwJfPgjmQ3i3HQHZH1k7OAdAkxrigitWvW2KafkXYmftdwsd2N7xYwmgC6fBN_Tx86kB63qmd1vxffuImo89EJM3iffumuNIsFsloJnTge6pqP2KLwavavh61BNIDLZsOmNfZjYlgY8WhnK_4VPwALUibrTWn_8XaSo_AV-vOGMbk9A-OFDr3hmHO1ZMeWoPtaEr30hj7um2zfGVV7aMMGZz-FEsJzWyalTgmQ5VwWXrYYKet625X_x-OFh0yrYn5kNk-0YUH5wtMQbfTz0TF9ZOXOzilzRKbcafpPjh2NRz1j7AbO5TJc0uTY1zjJCt9Nge_k4SmpG22qylKSA9LXZT1VcsfW9CctzBRhf4LpSCA"}}
bN2ROy23DEOd_SBE55RYioGMlTHxb0zyQqoVVzK85-fQg8Nq2mV_dHR3OSrsyPB3jdBfjHpBILQnlnbFoMZeBg
```

## 9. Index, `version` 1

Three posts live.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"]],"version":1,"top":3}
XnVqNxHU5m3eu4qelsg77HFs7tngexX7YLv-y7MgxX00DH61GdGr9Lhms_65vxnCMHLYDYKiA5C_lQF7-10qDQ
```

## 10. Index, `version` 2 — a withdrawal, a media file

Post 2 is withdrawn by an appended line, post 5 is the encrypted one, and the media file is listed by its
address alone. The media file's bytes are 26 bytes hashing to `fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g`.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[2,null],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"8qFSXwoaFAli1MIuMi8T52UhD-XvYuIMLALNt_OEQQs"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"]],"version":2,"top":5}
d3-yqAPg2iItXYasKxmht2vpwfGenGkTXzU-BFPd0sPk64VZzSsDOKL6wS04MPyA1IHk9k0dtqjckoJoCmFRAQ
```

## 11. Index, `version` 3 — the rewrite, and a number that comes back

The lines the withdrawal left behind are gone (§4.7), and post 2 is re-listed at the hash it had
(§4.2). A reader holding `version` 2 accepts this: it remembers the withdrawn hash, and the same bytes
coming back are not a change.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"8qFSXwoaFAli1MIuMi8T52UhD-XvYuIMLALNt_OEQQs"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"]],"version":3,"top":5}
9HJTbv8f48aF1GYk7SySc1aRFK1mm0eSjMo-xr3S3Dowv1OitC_nMVTwta3pJowJ-d27eYYOR1kUYG9eKp1DCQ
```

## 12. The spoken code (§3.1)

Six 11-bit indices into the BIP-39 English list, and the words they select, from the anchor key above — or from any key (§3.1).

```
HKDF-SHA256(ikm = key, salt = "", info = "openfeed/v1/spoken", 9 bytes)
indices  923 1951 1851 172 1664 898
words    inflict view trash better source icon
```
