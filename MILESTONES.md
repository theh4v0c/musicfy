# Milestones

## v0.2 Guided Ask (current)

Goal: the Ask/agent surface never creates a playlist or queues a download on the first
turn. Every mutation is a proposal with a visible track list, counts and a reason, and
runs only after an explicit confirm.

Scope:
- preview and confirm for playlist creation, album download and missing-audio download
- local-first playlist proposals, scored by taste (plays, likes, playlists) instead of
  the catalogue's generic top results
- style presets: dance, house, techno, indie dance, downtempo, Burning Man
- mood heuristics from key, scale, BPM and energy: euphoric, melancholic, unsettling
- reference artist ("like Burial"): follow its BPM, key and genre family
- same behaviour with no model configured; the model only fills the same plan slots

Out of scope for v0.2:
- free-form conversation and memory beyond one pending proposal
- discovery of new artists outside the library (catalogue fill is deliberately off)
- multi-user identity and per-user taste profiles

## v0.3 Library building

- opt-in catalogue/discovery fill, with source quality shown before download
- reference artist that is not in the library (via catalogue similarity)
- deeper psychological tags once the analysis worker stores more than BPM/key/energy
- per-user taste profiles and shared crates
