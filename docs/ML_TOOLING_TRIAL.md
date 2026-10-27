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

## Completed mirror and larger trial — 2026-10-27

The mirror finished on 2026-10-24 at 14:40 UTC with no final error and zero consecutive blocks: 17,307 new downloads, 7,020 cached clips and 974 unavailable (404) clips account for all 25,301 queued clips. A fresh manifest/file audit confirms 24,327 videos and 24,326 audio files meeting the size check. One keyboard video has no usable extracted audio; it is excluded from audio-based training.

The existing caches contain 10,473 usable feature clips, including all 200 teacher-review clips. Outside the reserved learner/video groups, 4,315 labeled audio clips still need features; 1,986 exams already have at least one labeled feature clip. The teacher CSV still has 0 reviewed and 200 pending clips. Voice has only four labeled audio clips outside the reservation, so additional downloads alone do not solve its label shortage.

Code `c3646c0ead8bbd446231ad9127bac4bc02a02251` adds `extract --labeled-only`. It uses the existing validated historical labels, excluding unknown scores and ambiguous all-zero vectors. Its regression test checks that partially labeled clips are included and completed feature caches are reused. All 14 ML tests pass. The prior build, type checks and 41 API/shared tests remain applicable; this continuation changes only the offline lab.

A bounded continuation is running privately at `ubtxiaomi:/mnt/DAS1T/musicexamaid_ml_dataset/experiments/completed-mirror-20261027-c3646c0`. It processes 4,630 labeled audio clips in batches of 250, including the 4,315 outside the reserved groups; the additional reserved clips remain excluded from training. It reuses both previous caches and every completed batch, then runs the full eligible cohort with five learner/duplicate-disjoint folds, 100 boosting iterations, two threads and seed 42. It reuses the original teacher reservation, checks saved-model inference on that packet, validates the teacher CSV and records input/cache/live-weight fingerprints before and after. Failed extractions stop further extraction batches rather than retrying indefinitely; any resulting feature gaps are recorded before the trial.

`continuation_status.json` and the per-phase logs record progress and completion. The worker holds `/tmp/musicexamaid-ml-experiment.lock`, runs at low priority and writes only to its new private directory. This is a single requested run, with no recurring job or automatic model release. Larger-trial metrics are pending; the initial trial above remains the only completed model comparison recorded here. Its capped three-fold cohort and this full five-fold cohort should not be treated as a controlled before/after accuracy comparison.
