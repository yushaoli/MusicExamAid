# Offline ML tooling and initial trial — 2026-10-23

The tools run successfully on the downloaded/extracted subset while the mirror continues. The first trial is exploratory: the full model improves on both simple and context-only baselines in 10 of 25 evaluated family/dimension comparisons. It is not ready for model promotion or paid reports.

## Evidence and reproduction

- Training code: commit `62d7ae831c7a1bcf70fe4a79b25c16695903bbd0`. Later additions batch inference and restrict extraction/inference to a teacher packet; they do not change this trial's fitted models or metrics.
- Private mainland run: `ubtxiaomi:/mnt/DAS1T/musicexamaid_ml_dataset/experiments/tooling-62d7ae831c7a`.
- Artifacts: `trial-001/trial_report.json`, `training_snapshot.jsonl`, `oof_predictions.jsonl`, `models.joblib`, `data_audit.json`, `code_provenance.json`. Keep individual-level artifacts on the host.
- Input audit at the run: 20,144 available MP4s, 20,143 available WAVs, and 10,372 cached feature clips. The new bounded extraction analyzed 96 clips with zero failures; the shared cache and live weights retained their original sizes and modification times.
- Settings: 3 learner/duplicate-video-disjoint folds, at most 150 learner groups per family, 40 boosting iterations, 2 threads, seed 42. Selection included 2,650 feature clips; each dimension used its labeled subset. Evaluation had 69–156 exams per family/dimension.
- Runtime environment: Python 3.14.7, NumPy 2.5.4, SciPy 1.18.1, scikit-learn 1.9.1. The initial model trial took about 74 seconds after loading/extraction stages.

The [tooling guide](../scripts/ml_lab/README.md) contains installation, audit, extraction, incremental continuation, teacher-label import, calibration, and inference commands. Input and code hashes are recorded in each private output directory. Do not rerun the legacy trainer with its production-default output path for these experiments.

## Initial result

Every comparison uses the same learner-disjoint splits and counts an exam once after averaging its clip probabilities. “Wins” means the full model has strictly lower rank MAE than majority, median, and grade/instrument-only baselines. Acoustic-only results are an additional ablation, not included in that win definition. Rank MAE uses four ordered numeric levels; it is not an accuracy percentage or an error score out of ten.

| Instrument family | Evaluated dimensions | Wins against all three baselines | Dimensions missing score 0 |
|---|---:|---:|---:|
| Bowed strings | 5 | 5 | 0 |
| Keyboard | 5 | 0 | 4 |
| Percussion | 5 | 3 | 5 |
| Plucked strings | 5 | 1 | 2 |
| Winds | 5 | 1 | 5 |
| Voice | 0 | Not enough labeled learner groups | — |

The full model beats the context-only model in 13 of 25 comparisons, and the median baseline in 19 of 25. These counts describe this small exploratory trial, not archive-wide accuracy. In particular, keyboard results do not yet demonstrate consistent value beyond the baselines. Bowed-string gains need confirmation on a larger, fixed dataset.

The numeric labels observed are 0, 3, 6 and 10. Their correspondence to 好/较好/一般/尚可 remains unverified. Seven live-season clips had all-zero vectors and were excluded as ambiguous; mixed-zero vectors were retained. Sixteen evaluated family/dimension cohorts lacked score 0 entirely. This does not establish reliable four-class recognition.

## Teacher calibration preparation

A blinded 200-clip packet reserves 200 independent learner/duplicate-video groups across six families, with 100 calibration clips and 100 held-out test clips. All recordings belonging to those learners/groups are excluded from training, including their other exams. Official and model scores are absent from the teacher CSV.

The labels remain blank: 0 reviewed, 200 pending. Validation succeeds; no teacher judgments or safety metrics were invented. A follow-up using code `819e5cf634ca0b6f82bb9398d64912b22f88e3a3` completed packet-only feature extraction: all 200 reserved clips now have features, stored separately in `teacher-features/features.jsonl`.

The saved models also passed a real offline inference check on the reserved packet, producing 835 dimension predictions. The 33 voice clips have no fitted voice model, so their 165 dimension predictions are absent rather than replaced with default scores. Prediction outputs stay separate from the blinded CSV. `gate-readiness-complete-features/` still reports that calibration must await real teacher labels. Protected shared-cache/live-weight file sizes and modification times were unchanged after this follow-up too.

Next steps:

1. Confirm the teacher scoring rubric, including zero-score semantics, then collect blind labels.
2. Finish incremental feature extraction after the mirror completes; reuse this fixed teacher reservation and compare the final audit to the partial-data audit.
3. Run a larger grouped trial, inspect rare-class support and per-family confusion matrices, and investigate dimensions that fail the context baseline.
4. Use calibration labels to choose silence-heuristic thresholds and the untouched test subset to measure errors with intervals. This only covers an audio heuristic; identity, photos, song correctness, and the full initial-review gate need separate validation.

The API, shared feature cache, portal-write setting, and live model were not changed by these experiments. Raw data, per-clip outputs and teacher packets remain on the mainland host. Git contains only code, tests, documentation and aggregate results.
