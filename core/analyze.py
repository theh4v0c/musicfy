#!/usr/bin/env python3
"""Analyse audio for DJ metadata: BPM, key, loudness, energy.

Reads a JSON array of {"id": int, "path": str} on stdin and writes one JSON
object per line to stdout. No network, no account, no models to download.
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import librosa

# Krumhansl-Schmuckler key profiles
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def detect_key(chroma):
    profile = chroma.mean(axis=1)
    profile = profile / (np.linalg.norm(profile) + 1e-9)
    best = (-2.0, "C", "major")
    for i in range(12):
        for scale, ref in (("major", MAJOR), ("minor", MINOR)):
            rolled = np.roll(ref, i)
            rolled = rolled / np.linalg.norm(rolled)
            score = float(np.dot(profile, rolled))
            if score > best[0]:
                best = (score, NOTES[i], scale)
    return best[1], best[2], round(best[0], 4)


def analyse(path):
    y, sr = librosa.load(path, sr=22050, mono=True)
    if y.size == 0:
        raise ValueError("empty audio")
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key, scale, confidence = detect_key(chroma)
    rms = librosa.feature.rms(y=y)[0]
    loudness = float(20.0 * np.log10(np.mean(rms) + 1e-9))
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    energy = float(np.mean(onset))
    return {
        "bpm": round(bpm, 1),
        "key": key,
        "key_scale": scale,
        "key_confidence": confidence,
        "loudness": round(loudness, 2),
        "energy": round(energy, 3),
        "duration": round(float(len(y) / sr), 1),
    }


def main():
    items = json.load(sys.stdin)
    for item in items:
        try:
            out = analyse(item["path"])
            out["id"] = item["id"]
        except Exception as exc:  # noqa: BLE001
            out = {"id": item.get("id"), "error": str(exc)[:160]}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
