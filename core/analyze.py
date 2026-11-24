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
from scipy import ndimage, signal
from scipy.spatial.distance import cosine as cosine_dist

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
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(np.atleast_1d(beat_frames), sr=sr).tolist()
    # 4/4 assumed: every 4th beat is a downbeat. A real downbeat detector is a later pass.
    downbeats = beats[::4] if beats else []
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key, scale, confidence = detect_key(chroma)
    rms = librosa.feature.rms(y=y)[0]
    loudness = float(20.0 * np.log10(np.mean(rms) + 1e-9))
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    energy = float(np.mean(onset))
    sections = detect_sections(y, sr, chroma, beats, float(len(y) / sr))
    return {
        "bpm": round(bpm, 1),
        "key": key,
        "key_scale": scale,
        "key_confidence": confidence,
        "loudness": round(loudness, 2),
        "energy": round(energy, 3),
        "duration": round(float(len(y) / sr), 1),
        "beat_grid": [round(float(x), 3) for x in downbeats],
        "beats": [round(float(x), 3) for x in beats],
        "sections": sections["sections"],
        "energy10": sections["energy10"],
    }


def _checkerboard_novelty(rec, kernel_size=16):
    """Structural novelty: a checkerboard kernel slid along the recurrence diagonal."""
    n = rec.shape[0]
    if n < 4:
        return np.zeros(n)
    k = min(kernel_size, max(2, n - 1))
    half = k // 2
    kernel = np.ones((k, k))
    kernel[:half, :half] = -1
    kernel[half:, half:] = -1
    rec_pad = np.pad(rec, half, mode="reflect")
    novelty = np.zeros(n)
    for i in range(n):
        window = rec_pad[i:i + k, i:i + k]
        if window.shape == (k, k):
            novelty[i] = float(np.sum(window * kernel))
    return novelty


def detect_sections(y, sr, chroma, beat_times, duration):
    """Musical sections, the way Mixed In Key lays them out: boundaries snapped to
    downbeats, each section labelled by its position and its RMS relative to the track.

    The method is the published one: beat-synchronous chroma, a recurrence matrix,
    checkerboard novelty, gaussian smoothing, peak picking, then labelling.
    """
    empty = {"sections": [], "energy10": None}
    if len(beat_times) < 16 or chroma is None or chroma.size == 0:
        return empty
    hop = 512
    beat_frames = librosa.time_to_frames(np.asarray(beat_times), sr=sr, hop_length=hop)
    beat_frames = np.clip(beat_frames, 0, chroma.shape[1] - 1)
    chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
    if chroma_sync.shape[1] < 8:
        return empty

    rec = librosa.segment.recurrence_matrix(chroma_sync, mode="affinity", sym=True)
    novelty = ndimage.gaussian_filter1d(_checkerboard_novelty(rec, 16), sigma=1.5)
    min_dist = max(4, int(len(novelty) * 0.03))
    height = float(np.percentile(novelty, 55)) if len(novelty) > 10 else 0.0
    peaks, _ = signal.find_peaks(novelty, distance=min_dist, height=height)

    n_beats = min(chroma_sync.shape[1], len(beat_times))
    boundary_beats = sorted({0, n_beats - 1, *[int(p) for p in peaks if p < n_beats]})
    # every boundary on a downbeat, because a cue that is not on the grid is a cue a DJ moves
    times = []
    for bi in boundary_beats:
        snapped = max(0, min(round(min(bi, len(beat_times) - 1) / 4) * 4, len(beat_times) - 1))
        times.append(float(beat_times[snapped]))
    times = sorted(set(times))
    if times and times[0] > 1.0:
        times.insert(0, 0.0)
    if times and times[-1] < duration - 2.0:
        times.append(float(duration))

    segments, chromas = [], []
    for i in range(len(times) - 1):
        start, end = times[i], times[i + 1]
        if end - start < 2.0:
            continue
        f0 = librosa.time_to_frames(start, sr=sr, hop_length=hop)
        f1 = min(librosa.time_to_frames(end, sr=sr, hop_length=hop), chroma.shape[1])
        if f1 <= f0:
            continue
        seg_audio = y[int(start * sr):int(end * sr)]
        rms = float(np.sqrt(np.mean(seg_audio ** 2))) if seg_audio.size else 0.0
        segments.append({"start": start, "end": end, "rms": rms})
        chromas.append(np.mean(chroma[:, f0:f1], axis=1))
    if not segments:
        return empty

    # group repeated sections by chroma, so "the chorus" is the part that comes back
    labels = [-1] * len(segments)
    group = 0
    for i in range(len(segments)):
        if labels[i] >= 0:
            continue
        labels[i] = group
        for j in range(i + 1, len(segments)):
            if labels[j] >= 0:
                continue
            sim = 1.0 - cosine_dist(chromas[i], chromas[j])
            if sim > 0.85:
                labels[j] = group
        group += 1
    counts = {}
    for g in labels:
        counts[g] = counts.get(g, 0) + 1
    repeated = {g for g, n in counts.items() if n >= 2}

    rms_all = [s["rms"] for s in segments]
    p25, p50, p75 = (float(np.percentile(rms_all, q)) for q in (25, 50, 75))
    peak = max(rms_all) or 1.0
    out = []
    for i, seg in enumerate(segments):
        rms = seg["rms"]
        first, last, again = i == 0, i == len(segments) - 1, labels[i] in repeated
        if first and rms < p50:
            kind = "intro"
        elif last and rms < p50:
            kind = "outro"
        elif again and rms >= p75:
            kind = "chorus"
        elif again and rms < p50:
            kind = "verse"
        elif not again and rms < p25:
            kind = "breakdown"
        elif not again and rms < p50:
            kind = "bridge"
        elif rms >= p75:
            kind = "chorus"
        else:
            kind = "verse"
        if i < len(segments) - 1 and rms < p50 and segments[i + 1]["rms"] >= p75 and 4.0 <= seg["end"] - seg["start"] <= 32.0:
            kind = "build"
        out.append({
            "type": kind,
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "energy": round(1.0 + (rms / (peak + 1e-10)) * 9.0, 1),
        })
    overall = round(1.0 + (float(np.mean(rms_all)) / (peak + 1e-10)) * 9.0, 1)
    return {"sections": out, "energy10": overall}


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
