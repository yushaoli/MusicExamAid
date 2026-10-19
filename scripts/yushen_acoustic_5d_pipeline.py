#!/usr/bin/env python3
"""
MusicExamAid — Real Acoustic 5D Pre-Exam Assessment (考前预审) & Compliance Gate (初审) Pipeline.

Capabilities:
1. Backfills 24kHz mono WAVs from cached MP4s on DAS (`--extract-wavs`), prioritizing 5D-scored & gold-50 clips.
2. Runs sliding-window (3.0s window / 1.5s hop) spectral & onset DSP analysis on 24kHz WAVs (`--analyze-and-train`):
   - Pinpoints exact `mm:ss-mm:ss` defect windows for:
     * 完整性 (Completeness): mid-piece breakdown / hesitation pauses (`hesitation_windows`)
     * 节奏 (Rhythm): rushing or dragging windows (`rhythm_rush_drag_windows`)
     * 音准 (Pitch/Intonation): chroma concentration / harmonic stability drops (`pitch_instability_windows`)
     * 音色 (Tone/Timbre): harsh high-frequency scratchiness or thin tone (`tone_harsh_or_weak_windows`)
     * 表现力 (Expression): flat dynamic contour windows (`expression_flat_windows`)
   - Computes 12-bin Pitch-Class Chroma fingerprints (`chroma_12`) to build Per-Piece Reference Templates
     for `初审` song matching (detecting wrong-song uploads / `货不对板`).
3. Trains 5D regression heads (`音准`, `节奏`, `音色`, `表现力`, `完整性`) against official adjudicator 5D scores
   (`3 / 6 / 10` per dimension) and exports portable JSON weights + piece templates + per-exam acoustic cache to:
   - `/mnt/DAS1T/musicexamaid_ml_dataset/yushen_5d_model_weights.json`
   - `/opt/stacks/musicexamaid/services/api/data/yushen_5d_model_weights.json`
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import KFold
from sklearn.preprocessing import StandardScaler

DATASET_ROOT_DEFAULT = "/mnt/DAS1T/musicexamaid_ml_dataset"
API_MODEL_JSON_DEFAULT = "/opt/stacks/musicexamaid/services/api/data/yushen_5d_model_weights.json"

FEATURE_NAMES = [
    "duration_sec",
    "active_ratio",
    "pause_count",
    "longest_pause_sec",
    "rms_db_mean",
    "rms_db_std",
    "dynamic_range_db",
    "phrase_modulation_db",
    "onset_rate_per_sec",
    "tempo_cv",
    "rhythm_instability_ratio",
    "spectral_centroid_hz_mean",
    "spectral_centroid_hz_std",
    "spectral_flatness_mean",
    "hf_harsh_ratio",
    "pitch_clarity_mean",
    "pitch_clarity_std",
    "pitch_instability_ratio",
    "grade_norm",
]

DIMENSIONS_5D = [
    "yinzhun_pitch",
    "jiezou_rhythm",
    "yinse_tone",
    "biaoxianli_expression",
    "wanzhengxing_completeness",
]


def fmt_mmss(sec: float) -> str:
    s = max(0, int(round(sec)))
    return f"{s // 60:02d}:{s % 60:02d}"


def find_ffmpeg() -> str:
    return (
        shutil.which("ffmpeg")
        or (
            "/home/ubt/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
            if Path("/home/ubt/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg").exists()
            else "ffmpeg"
        )
    )


def load_manifest(dataset_root: Path) -> list[dict[str, Any]]:
    manifest_path = dataset_root / "manifest_all_clips.jsonl"
    rows: list[dict[str, Any]] = []
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def extract_missing_wavs(dataset_root: Path, limit: int = 1500, workers: int = 4) -> int:
    ffmpeg_bin = find_ffmpeg()
    rows = load_manifest(dataset_root)

    # Prioritize clips that have 5D numeric scores and cached MP4s on disk
    def priority_key(r: dict[str, Any]) -> tuple:
        s_tot = r.get("score_total_50")
        is_gold = s_tot == 50
        has_5d = s_tot is not None
        return (0 if is_gold else (1 if has_5d else 2), int(r.get("exam_id") or 0))

    rows.sort(key=priority_key)
    todo: list[tuple[Path, Path]] = []
    for r in rows:
        vp = dataset_root / r["rel_video_path"]
        ap = dataset_root / r["rel_audio_path"]
        if vp.exists() and vp.stat().st_size >= 1024:
            if not (ap.exists() and ap.stat().st_size >= 4096):
                todo.append((vp, ap))
                if 0 < limit <= len(todo):
                    break

    if not todo:
        print("No missing WAVs to extract for currently cached MP4s.")
        return 0

    print(f"Extracting {len(todo)} 24kHz mono WAVs with {workers} workers...")

    def _one(pair: tuple[Path, Path]) -> bool:
        vp, ap = pair
        ap.parent.mkdir(parents=True, exist_ok=True)
        res = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-i",
                str(vp),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "24000",
                str(ap),
            ],
            check=False,
        )
        return res.returncode == 0 and ap.exists() and ap.stat().st_size >= 4096

    extracted = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for ok in ex.map(_one, todo):
            if ok:
                extracted += 1
    print(f"Extracted {extracted}/{len(todo)} WAV files.")
    return extracted


def build_chroma_filterbank(freqs: np.ndarray) -> np.ndarray:
    """Maps FFT frequency bins (Hz) to 12 pitch classes (C..B)."""
    fb = np.zeros((12, len(freqs)), dtype=np.float32)
    valid = (freqs >= 65.0) & (freqs <= 3520.0)
    idx = np.where(valid)[0]
    if len(idx) == 0:
        return fb
    midi = 69.0 + 12.0 * np.log2(freqs[idx] / 440.0)
    pitch_class = np.mod(np.round(midi).astype(int), 12)
    for k, pc in zip(idx, pitch_class):
        fb[pc, k] = 1.0
    # Normalize each chroma bin
    row_sums = np.maximum(fb.sum(axis=1, keepdims=True), 1.0)
    return fb / row_sums


def analyze_single_wav(wav_path: Path, grade_level: int = 5) -> dict[str, Any] | None:
    try:
        sr, data = wavfile.read(str(wav_path))
    except Exception:
        return None

    if data.ndim > 1:
        data = data.mean(axis=1)
    if len(data) < sr * 3:
        return None

    # Normalize to float32 [-1, 1]
    if np.issubdtype(data.dtype, np.integer):
        max_val = float(np.iinfo(data.dtype).max)
        x = data.astype(np.float32) / max(1.0, max_val)
    else:
        x = data.astype(np.float32)

    # Cap analysis to first 210 seconds for speed while measuring full duration
    duration_sec = float(len(x)) / float(sr)
    max_samples = min(len(x), int(sr * 210))
    x_proc = x[:max_samples]

    # STFT with 2048 window (~85ms at 24kHz), 1024 hop (~42.6ms)
    freqs, times, Zxx = stft(x_proc, fs=sr, nperseg=2048, noverlap=1024, boundary=None)
    mag = np.abs(Zxx) + 1e-8
    power = mag ** 2

    # Frame-level RMS in dB relative to clip peak
    frame_rms = np.sqrt(np.mean(power, axis=0))
    peak_rms = float(np.percentile(frame_rms, 98)) + 1e-8
    frame_db = 20.0 * np.log10(np.maximum(frame_rms / peak_rms, 1e-5))

    # Active playing frames (> -36 dB rel to peak)
    active_mask = frame_db > -36.0
    active_ratio = float(np.mean(active_mask))

    # Find start and end of actual performance
    active_indices = np.where(active_mask)[0]
    if len(active_indices) < 10:
        return None
    first_active = int(active_indices[0])
    last_active = int(active_indices[-1])
    hop_sec = float(times[1] - times[0]) if len(times) > 1 else (1024.0 / sr)

    # Detect mid-piece hesitation / breakdown pauses (>= 1.1s silent gap inside performance)
    hesitation_windows: list[dict[str, Any]] = []
    pause_count = 0
    longest_pause_sec = 0.0
    in_pause = False
    pause_start_idx = first_active
    for idx in range(first_active, last_active + 1):
        if not active_mask[idx]:
            if not in_pause:
                in_pause = True
                pause_start_idx = idx
        else:
            if in_pause:
                in_pause = False
                p_dur = (idx - pause_start_idx) * hop_sec
                if p_dur >= 1.1:
                    pause_count += 1
                    longest_pause_sec = max(longest_pause_sec, p_dur)
                    t0 = float(times[pause_start_idx])
                    t1 = float(times[min(idx, len(times) - 1)])
                    hesitation_windows.append({
                        "start_sec": round(t0, 1),
                        "end_sec": round(t1, 1),
                        "mmss": f"{fmt_mmss(t0)}-{fmt_mmss(t1)}",
                        "duration_sec": round(p_dur, 2),
                    })

    # Spectral centroid, flatness, and high-frequency harshness (>4.2kHz energy share)
    freq_col = freqs[:, None]
    spec_sum = np.sum(mag, axis=0) + 1e-8
    centroid_hz = np.sum(freq_col * mag, axis=0) / spec_sum
    geom_mean = np.exp(np.mean(np.log(mag), axis=0))
    arith_mean = np.mean(mag, axis=0) + 1e-8
    flatness = geom_mean / arith_mean

    hf_mask = freqs >= 4200.0
    hf_ratio_frames = np.sum(power[hf_mask, :], axis=0) / (np.sum(power, axis=0) + 1e-8)

    # Chroma 12-vector and Pitch Clarity (concentration of energy in top pitch classes per frame)
    chroma_fb = build_chroma_filterbank(freqs)
    chroma_frames = chroma_fb @ mag  # (12, T)
    chroma_norm = chroma_frames / (np.sum(chroma_frames, axis=0, keepdims=True) + 1e-8)
    # Pitch clarity: max pitch class share minus uniform (1/12)
    pitch_clarity_frames = np.max(chroma_norm, axis=0)

    # Global 12-bin Chroma fingerprint over active frames
    chroma_mean = np.mean(chroma_norm[:, active_mask], axis=1)
    chroma_mean = chroma_mean / (np.linalg.norm(chroma_mean) + 1e-8)

    # Onset strength envelope
    log_mag = np.log1p(100.0 * mag)
    onset_env = np.maximum(0.0, np.diff(log_mag, axis=1, prepend=log_mag[:, :1])).mean(axis=0)
    onset_thresh = float(np.percentile(onset_env[active_mask], 72)) if np.any(active_mask) else 0.1
    onset_peaks = (onset_env > onset_thresh) & active_mask
    onset_rate_per_sec = float(np.sum(onset_peaks)) / max(1.0, float(len(times)) * hop_sec)

    # Sliding-window (3.0s window, 1.5s hop) defect localization
    win_frames = max(10, int(round(3.0 / hop_sec)))
    step_frames = max(5, int(round(1.5 / hop_sec)))

    window_onset_rates: list[float] = []
    window_pitch_clarities: list[float] = []
    window_hf_ratios: list[float] = []
    window_db_stds: list[float] = []
    window_spans: list[tuple[float, float]] = []

    for start_f in range(first_active, max(first_active + 1, last_active - win_frames + 1), step_frames):
        end_f = min(len(times), start_f + win_frames)
        if np.mean(active_mask[start_f:end_f]) < 0.45:
            continue
        t0 = float(times[start_f])
        t1 = float(times[end_f - 1])
        w_dur = max(0.5, t1 - t0)
        w_onset_rate = float(np.sum(onset_peaks[start_f:end_f])) / w_dur
        w_pitch = float(np.mean(pitch_clarity_frames[start_f:end_f]))
        w_hf = float(np.mean(hf_ratio_frames[start_f:end_f]))
        w_db_std = float(np.std(frame_db[start_f:end_f]))

        window_onset_rates.append(w_onset_rate)
        window_pitch_clarities.append(w_pitch)
        window_hf_ratios.append(w_hf)
        window_db_stds.append(w_db_std)
        window_spans.append((t0, t1))

    rhythm_rush_drag_windows: list[dict[str, Any]] = []
    pitch_instability_windows: list[dict[str, Any]] = []
    tone_harsh_or_weak_windows: list[dict[str, Any]] = []
    expression_flat_windows: list[dict[str, Any]] = []

    if window_onset_rates:
        med_onset = float(np.median(window_onset_rates)) + 1e-5
        tempo_cv = float(np.std(window_onset_rates) / med_onset)
        med_pitch = float(np.median(window_pitch_clarities))
        med_hf = float(np.median(window_hf_ratios))

        for (t0, t1), w_or, w_pc, w_hf, w_dbs in zip(
            window_spans, window_onset_rates, window_pitch_clarities, window_hf_ratios, window_db_stds
        ):
            rel_tempo_dev = (w_or - med_onset) / med_onset
            if abs(rel_tempo_dev) >= 0.32 and len(rhythm_rush_drag_windows) < 3:
                rhythm_rush_drag_windows.append({
                    "start_sec": round(t0, 1),
                    "end_sec": round(t1, 1),
                    "mmss": f"{fmt_mmss(t0)}-{fmt_mmss(t1)}",
                    "issue": "抢拍加速" if rel_tempo_dev > 0 else "拖拍迟滞",
                    "deviation_pct": round(rel_tempo_dev * 100.0, 1),
                })
            if w_pc < min(0.22, med_pitch * 0.82) and len(pitch_instability_windows) < 3:
                pitch_instability_windows.append({
                    "start_sec": round(t0, 1),
                    "end_sec": round(t1, 1),
                    "mmss": f"{fmt_mmss(t0)}-{fmt_mmss(t1)}",
                    "clarity": round(w_pc, 3),
                })
            if w_hf > max(0.18, med_hf * 1.45) and len(tone_harsh_or_weak_windows) < 3:
                tone_harsh_or_weak_windows.append({
                    "start_sec": round(t0, 1),
                    "end_sec": round(t1, 1),
                    "mmss": f"{fmt_mmss(t0)}-{fmt_mmss(t1)}",
                    "hf_ratio": round(w_hf, 3),
                })
            if w_dbs < 2.2 and len(expression_flat_windows) < 2:
                expression_flat_windows.append({
                    "start_sec": round(t0, 1),
                    "end_sec": round(t1, 1),
                    "mmss": f"{fmt_mmss(t0)}-{fmt_mmss(t1)}",
                    "db_std": round(w_dbs, 2),
                })
    else:
        tempo_cv = 0.25

    active_db = frame_db[active_mask]
    rms_db_mean = float(np.mean(active_db))
    rms_db_std = float(np.std(active_db))
    dynamic_range_db = float(np.percentile(active_db, 95) - np.percentile(active_db, 10))
    phrase_modulation_db = float(np.std(window_db_stds)) if window_db_stds else 1.0

    n_wins = max(1, len(window_spans))
    rhythm_instability_ratio = float(len(rhythm_rush_drag_windows)) / float(n_wins)
    pitch_instability_ratio = float(len(pitch_instability_windows)) / float(n_wins)

    features_dict = {
        "duration_sec": round(duration_sec, 2),
        "active_ratio": round(active_ratio, 4),
        "pause_count": pause_count,
        "longest_pause_sec": round(longest_pause_sec, 2),
        "rms_db_mean": round(rms_db_mean, 3),
        "rms_db_std": round(rms_db_std, 3),
        "dynamic_range_db": round(dynamic_range_db, 3),
        "phrase_modulation_db": round(phrase_modulation_db, 3),
        "onset_rate_per_sec": round(onset_rate_per_sec, 3),
        "tempo_cv": round(tempo_cv, 4),
        "rhythm_instability_ratio": round(rhythm_instability_ratio, 4),
        "spectral_centroid_hz_mean": round(float(np.mean(centroid_hz[active_mask])), 1),
        "spectral_centroid_hz_std": round(float(np.std(centroid_hz[active_mask])), 1),
        "spectral_flatness_mean": round(float(np.mean(flatness[active_mask])), 4),
        "hf_harsh_ratio": round(float(np.mean(hf_ratio_frames[active_mask])), 4),
        "pitch_clarity_mean": round(float(np.mean(pitch_clarity_frames[active_mask])), 4),
        "pitch_clarity_std": round(float(np.std(pitch_clarity_frames[active_mask])), 4),
        "pitch_instability_ratio": round(pitch_instability_ratio, 4),
        "grade_norm": round(float(grade_level) / 10.0, 2),
    }

    return {
        "features": features_dict,
        "feature_vec": [float(features_dict[k]) for k in FEATURE_NAMES],
        "chroma_12": [round(float(v), 4) for v in chroma_mean],
        "defects": {
            "hesitation_windows": hesitation_windows[:3],
            "rhythm_rush_drag_windows": rhythm_rush_drag_windows[:3],
            "pitch_instability_windows": pitch_instability_windows[:3],
            "tone_harsh_or_weak_windows": tone_harsh_or_weak_windows[:3],
            "expression_flat_windows": expression_flat_windows[:2],
        },
    }


def run_analyze_and_train(dataset_root: Path, api_model_path: Path, max_clips: int = 2000) -> dict[str, Any]:
    rows = load_manifest(dataset_root)
    cache_jsonl = dataset_root / "acoustic_features_cache.jsonl"

    existing_cache: dict[str, dict[str, Any]] = {}
    if cache_jsonl.exists():
        with open(cache_jsonl, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    obj = json.loads(line)
                    existing_cache[obj["clip_id"]] = obj

    # Prioritize clips that have WAV on disk and 5D scores
    avail_rows: list[dict[str, Any]] = []
    for r in rows:
        ap = dataset_root / r["rel_audio_path"]
        if ap.exists() and ap.stat().st_size >= 4096:
            avail_rows.append(r)

    avail_rows.sort(
        key=lambda r: (
            0 if r.get("score_total_50") == 50 else (1 if r.get("score_total_50") is not None else 2),
            int(r.get("exam_id") or 0),
        )
    )
    avail_rows = avail_rows[:max_clips]
    print(f"Found {len(avail_rows)} WAV clips on disk ({len(existing_cache)} already in acoustic cache).")

    new_analyzed = 0
    with open(cache_jsonl, "a", encoding="utf-8") as out_f:
        for r in avail_rows:
            cid = r["clip_id"]
            if cid in existing_cache:
                continue
            ap = dataset_root / r["rel_audio_path"]
            res = analyze_single_wav(ap, int(r.get("grade_level") or 5))
            if not res:
                continue
            entry = {
                "clip_id": cid,
                "exam_id": r["exam_id"],
                "clip_index": r["clip_index"],
                "season_code": r["season_code"],
                "instrument_cn": r["instrument_cn"],
                "grade_level": r["grade_level"],
                "piece_title": r["piece_title"],
                "score_total_50": r.get("score_total_50"),
                "score_5d": r.get("score_5d"),
                **res,
            }
            existing_cache[cid] = entry
            out_f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            new_analyzed += 1
            if new_analyzed % 50 == 0:
                print(f"  Analyzed {new_analyzed} new WAVs...")

    print(f"Total acoustically analyzed clips in cache: {len(existing_cache)} (newly analyzed: {new_analyzed}).")

    # Build Per-Piece Reference Chroma & Duration Templates for 初审 song verification
    piece_groups: dict[str, list[dict[str, Any]]] = {}
    for entry in existing_cache.values():
        title = (entry.get("piece_title") or "").strip()
        if not title or title.startswith("clip_"):
            continue
        key = f"{entry['instrument_cn']}::{entry['grade_level']}::{title}"
        piece_groups.setdefault(key, []).append(entry)

    piece_templates: dict[str, dict[str, Any]] = {}
    for key, items in piece_groups.items():
        # Prefer high-scoring clips (>=35/50) when building reference template
        gold_items = [it for it in items if (it.get("score_total_50") or 0) >= 35] or items
        chromas = np.array([it["chroma_12"] for it in gold_items], dtype=np.float32)
        mean_chroma = np.mean(chromas, axis=0)
        mean_chroma = mean_chroma / (np.linalg.norm(mean_chroma) + 1e-8)
        durs = [it["features"]["duration_sec"] for it in gold_items]
        piece_templates[key] = {
            "sample_count": len(gold_items),
            "median_duration_sec": round(float(np.median(durs)), 1),
            "min_duration_sec": round(float(np.percentile(durs, 10)), 1),
            "max_duration_sec": round(float(np.percentile(durs, 90)), 1),
            "reference_chroma_12": [round(float(v), 4) for v in mean_chroma],
        }

    # Compute per-instrument acoustic statistics (so piano vs guzheng vs violin are normalized within instrument)
    inst_groups: dict[str, list[dict[str, Any]]] = {}
    for entry in existing_cache.values():
        inst_groups.setdefault(entry["instrument_cn"], []).append(entry)

    inst_stats: dict[str, dict[str, float]] = {}
    for inst_name, items in inst_groups.items():
        centroids = [it["features"]["spectral_centroid_hz_mean"] for it in items]
        clarities = [it["features"]["pitch_clarity_mean"] for it in items]
        dyn_ranges = [it["features"]["dynamic_range_db"] for it in items]
        tempo_cvs = [it["features"]["tempo_cv"] for it in items]
        scored_items = [it["score_total_50"] for it in items if it.get("score_total_50") is not None]
        inst_stats[inst_name] = {
            "count": len(items),
            "centroid_mean": float(np.mean(centroids)),
            "centroid_std": max(20.0, float(np.std(centroids))),
            "clarity_mean": float(np.mean(clarities)),
            "clarity_std": max(0.01, float(np.std(clarities))),
            "dyn_mean": float(np.mean(dyn_ranges)),
            "dyn_std": max(0.5, float(np.std(dyn_ranges))),
            "tempo_cv_mean": float(np.mean(tempo_cvs)),
            "tempo_cv_std": max(0.02, float(np.std(tempo_cvs))),
            "avg_score_50": float(np.mean(scored_items)) if scored_items else 32.5,
        }

    ext_feature_names = FEATURE_NAMES + [
        "inst_z_centroid",
        "inst_z_pitch_clarity",
        "inst_z_dynamic_range",
        "inst_z_tempo_cv",
        "inst_prior_score_10",
        "chroma_piece_similarity",
    ]

    def build_ext_vec(entry: dict[str, Any]) -> tuple[list[float], float | None]:
        ist = inst_stats.get(entry["instrument_cn"]) or {
            "centroid_mean": 1200.0,
            "centroid_std": 400.0,
            "clarity_mean": 0.25,
            "clarity_std": 0.06,
            "dyn_mean": 14.0,
            "dyn_std": 3.5,
            "tempo_cv_mean": 0.28,
            "tempo_cv_std": 0.08,
            "avg_score_50": 32.5,
        }
        ft = entry["features"]
        t_key = f"{entry['instrument_cn']}::{entry['grade_level']}::{entry.get('piece_title', '').strip()}"
        tpl = piece_templates.get(t_key)
        chroma_sim: float | None = None
        if tpl:
            c_vec = np.array(entry["chroma_12"], dtype=np.float32)
            r_vec = np.array(tpl["reference_chroma_12"], dtype=np.float32)
            chroma_sim = round(
                float(np.dot(c_vec, r_vec) / (np.linalg.norm(c_vec) * np.linalg.norm(r_vec) + 1e-8)),
                3,
            )
        ext = list(entry["feature_vec"]) + [
            (ft["spectral_centroid_hz_mean"] - ist["centroid_mean"]) / ist["centroid_std"],
            (ft["pitch_clarity_mean"] - ist["clarity_mean"]) / ist["clarity_std"],
            (ft["dynamic_range_db"] - ist["dyn_mean"]) / ist["dyn_std"],
            (ft["tempo_cv"] - ist["tempo_cv_mean"]) / ist["tempo_cv_std"],
            ist["avg_score_50"] / 5.0,
            chroma_sim if chroma_sim is not None else 0.85,
        ]
        return ext, chroma_sim

    # Train 5D models on all analyzed clips that have 5D examiner labels
    labeled = [
        e
        for e in existing_cache.values()
        if e.get("score_5d")
        and all(e["score_5d"].get(d) is not None for d in DIMENSIONS_5D)
        and len(e.get("feature_vec") or []) == len(FEATURE_NAMES)
    ]
    print(f"Training 5D acoustic models (v1.1 instrument-calibrated) on {len(labeled)} labeled clips...")

    X = np.array([build_ext_vec(e)[0] for e in labeled], dtype=np.float64)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X) if len(labeled) >= 10 else X

    models_export: dict[str, Any] = {}
    metrics_summary: dict[str, Any] = {}
    trained_gbrs: dict[str, GradientBoostingRegressor] = {}

    for dim in DIMENSIONS_5D:
        y = np.array([float(e["score_5d"][dim]) for e in labeled], dtype=np.float64)
        if len(labeled) >= 20:
            ridge = Ridge(alpha=20.0)
            ridge.fit(X_scaled, y)
            gbr = GradientBoostingRegressor(
                n_estimators=90,
                max_depth=4,
                min_samples_leaf=12,
                learning_rate=0.05,
                subsample=0.85,
                random_state=42,
            )
            gbr.fit(X_scaled, y)
            trained_gbrs[dim] = gbr

            # 5-fold CV MAE using GBR + Ridge ensemble
            kf = KFold(n_splits=5, shuffle=True, random_state=42)
            cv_preds = np.zeros_like(y)
            for tr_idx, va_idx in kf.split(X_scaled):
                m_gbr = GradientBoostingRegressor(
                    n_estimators=80,
                    max_depth=3,
                    min_samples_leaf=15,
                    learning_rate=0.05,
                    subsample=0.85,
                    random_state=42,
                )
                m_gbr.fit(X_scaled[tr_idx], y[tr_idx])
                cv_preds[va_idx] = np.clip(m_gbr.predict(X_scaled[va_idx]), 3.0, 10.0)
            cv_mae = float(mean_absolute_error(y, cv_preds))
            in_mae = float(mean_absolute_error(y, np.clip(gbr.predict(X_scaled), 3.0, 10.0)))

            # Feature importances from GBR
            top_feats = sorted(
                zip(ext_feature_names, [round(float(v), 4) for v in gbr.feature_importances_]),
                key=lambda kv: kv[1],
                reverse=True,
            )[:6]

            models_export[dim] = {
                "intercept": round(float(ridge.intercept_), 5),
                "weights": [round(float(w), 5) for w in ridge.coef_],
                "top_features": top_feats,
            }
            metrics_summary[dim] = {
                "train_samples": len(labeled),
                "cv_mae_out_of_10": round(cv_mae, 3),
                "gbr_in_sample_mae": round(in_mae, 3),
                "mean_target": round(float(np.mean(y)), 2),
                "top_features": top_feats,
            }
        else:
            models_export[dim] = {
                "intercept": 6.5,
                "weights": [0.0] * len(ext_feature_names),
                "top_features": [],
            }

    # Build per-exam acoustic telemetry summary keyed by "{season_code}:{exam_id}" for instant Node.js lookup
    exam_acoustic_index: dict[str, dict[str, Any]] = {}
    for entry in existing_cache.values():
        ekey = f"{entry['season_code']}:{entry['exam_id']}"
        rec_exam = exam_acoustic_index.setdefault(
            ekey,
            {
                "season_code": int(entry["season_code"]),
                "exam_id": int(entry["exam_id"]),
                "instrument_cn": entry["instrument_cn"],
                "grade_level": int(entry["grade_level"]),
                "clips": {},
            },
        )
        ext_vec, chroma_sim = build_ext_vec(entry)
        f_vec = np.array(ext_vec, dtype=np.float64)
        f_sc = (f_vec - scaler.mean_) / np.maximum(scaler.scale_, 1e-8) if len(labeled) >= 10 else f_vec
        pred_5d: dict[str, float] = {}
        for dim in DIMENSIONS_5D:
            if dim in trained_gbrs:
                raw_p = float(trained_gbrs[dim].predict(f_sc.reshape(1, -1))[0])
            else:
                m_info = models_export[dim]
                raw_p = float(m_info["intercept"] + np.dot(f_sc, np.array(m_info["weights"])))
            pred_5d[dim] = round(float(np.clip(raw_p, 3.0, 10.0)), 1)

        rec_exam["clips"][str(entry["clip_index"])] = {
            "clip_id": entry["clip_id"],
            "piece_title": entry.get("piece_title"),
            "duration_sec": entry["features"]["duration_sec"],
            "active_ratio": entry["features"]["active_ratio"],
            "dynamic_range_db": entry["features"]["dynamic_range_db"],
            "tempo_cv": entry["features"]["tempo_cv"],
            "pitch_clarity_mean": entry["features"]["pitch_clarity_mean"],
            "chroma_piece_similarity": chroma_sim,
            "predicted_5d": pred_5d,
            "defects": entry["defects"],
        }

    artifact = {
        "model_version": "yushen-acoustic-5d-v1.1",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "total_analyzed_clips": len(existing_cache),
        "total_labeled_training_clips": len(labeled),
        "total_indexed_exams": len(exam_acoustic_index),
        "feature_names": ext_feature_names,
        "instrument_cohort_stats": inst_stats,
        "scaler_mean": [round(float(v), 5) for v in (scaler.mean_ if len(labeled) >= 10 else np.zeros(len(ext_feature_names)))],
        "scaler_scale": [round(float(v), 5) for v in (scaler.scale_ if len(labeled) >= 10 else np.ones(len(ext_feature_names)))],
        "models_5d": models_export,
        "validation_metrics": metrics_summary,
        "piece_templates_count": len(piece_templates),
        "piece_templates": piece_templates,
        "exam_acoustic_index": exam_acoustic_index,
    }

    out_dataset_json = dataset_root / "yushen_5d_model_weights.json"
    out_dataset_json.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved trained model & acoustic index to {out_dataset_json}")

    if api_model_path:
        api_model_path.parent.mkdir(parents=True, exist_ok=True)
        api_model_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Synced trained model & acoustic index to API path: {api_model_path}")

    return {
        "model_version": artifact["model_version"],
        "total_analyzed_clips": artifact["total_analyzed_clips"],
        "total_labeled_training_clips": artifact["total_labeled_training_clips"],
        "total_indexed_exams": artifact["total_indexed_exams"],
        "piece_templates_count": artifact["piece_templates_count"],
        "validation_metrics": metrics_summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train & Run Acoustic 5D Pre-Exam Assessment (考前预审) Model")
    parser.add_argument("--dataset-root", default=DATASET_ROOT_DEFAULT)
    parser.add_argument("--api-model-path", default=API_MODEL_JSON_DEFAULT)
    parser.add_argument("--extract-wavs", action="store_true", help="Extract missing 24kHz WAVs from cached MP4s")
    parser.add_argument("--wav-limit", type=int, default=800, help="Max WAVs to extract in this batch")
    parser.add_argument("--analyze-and-train", action="store_true", help="Analyze WAVs, train 5D models, export JSON")
    parser.add_argument("--max-clips", type=int, default=1500, help="Max WAV clips to analyze")
    args = parser.parse_args()

    dataset_root = Path(args.dataset_root)
    api_model_path = Path(args.api_model_path) if args.api_model_path else None

    if args.extract_wavs:
        extract_missing_wavs(dataset_root, limit=args.wav_limit)

    if args.analyze_and_train:
        summary = run_analyze_and_train(dataset_root, api_model_path, max_clips=args.max_clips)
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
