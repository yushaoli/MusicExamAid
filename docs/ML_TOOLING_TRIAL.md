# Offline ML tooling and trial evidence

The completed mirror now supports a full-cohort trial: the full model beats majority, median and context-only baselines in 17 of 25 family/dimension comparisons. Bowed and plucked strings show the clearest value; winds do not beat the context baseline in any dimension. Zero-score recall is 0 of 69 exam/dimension ratings, so this does not establish four-class recognition or justify model promotion. The [completed-run results and validation](#completed-mirror-and-larger-trial--2026-10-27) below were reviewed on 2026-10-28.

## Initial trial — 2026-10-23

The first trial ran successfully on the downloaded/extracted subset while the mirror continued. Its full model beat all three baselines in 10 of 25 comparisons. The initial and full-cohort trials use different cohorts and settings; their win counts are not a controlled before/after accuracy comparison.

### Evidence and reproduction

- Training code: commit `62d7ae831c7a1bcf70fe4a79b25c16695903bbd0`. Later additions batch inference and restrict extraction/inference to a teacher packet; they do not change this trial's fitted models or metrics.
- Private mainland run: `ubtxiaomi:/mnt/DAS1T/musicexamaid_ml_dataset/experiments/tooling-62d7ae831c7a`.
- Artifacts: `trial-001/trial_report.json`, `training_snapshot.jsonl`, `oof_predictions.jsonl`, `models.joblib`, `data_audit.json`, `code_provenance.json`. Keep individual-level artifacts on the host.
- Input audit at the run: 20,144 available MP4s, 20,143 available WAVs, and 10,372 cached feature clips. The new bounded extraction analyzed 96 clips with zero failures; the shared cache and live weights retained their original sizes and modification times.
- Settings: 3 learner/duplicate-video-disjoint folds, at most 150 learner groups per family, 40 boosting iterations, 2 threads, seed 42. Selection included 2,650 feature clips; each dimension used its labeled subset. Evaluation had 69–156 exams per family/dimension.
- Runtime environment: Python 3.14.7, NumPy 2.5.4, SciPy 1.18.1, scikit-learn 1.9.1. The initial model trial took about 74 seconds after loading/extraction stages.

The [tooling guide](../scripts/ml_lab/README.md) contains installation, audit, extraction, incremental continuation, teacher-label import, calibration, and inference commands. Input and code hashes are recorded in each private output directory. Do not rerun the legacy trainer with its production-default output path for these experiments.

### Initial result

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

### Teacher calibration preparation

A blinded 200-clip packet reserves 200 independent learner/duplicate-video groups across six families, with 100 calibration clips and 100 held-out test clips. All recordings belonging to those learners/groups are excluded from training, including their other exams. Official and model scores are absent from the teacher CSV.

The labels remain blank: 0 reviewed, 200 pending. Validation succeeds; no teacher judgments or safety metrics were invented. A follow-up using code `819e5cf634ca0b6f82bb9398d64912b22f88e3a3` completed packet-only feature extraction: all 200 reserved clips now have features, stored separately in `teacher-features/features.jsonl`.

The saved models also passed a real offline inference check on the reserved packet, producing 835 dimension predictions. The 33 voice clips have no fitted voice model, so their 165 dimension predictions are absent rather than replaced with default scores. Prediction outputs stay separate from the blinded CSV. `gate-readiness-complete-features/` still reports that calibration must await real teacher labels. Protected shared-cache/live-weight file sizes and modification times were unchanged after this follow-up too.

Next steps identified at the initial trial (extraction and the larger grouped trial are now complete):

1. Confirm the teacher scoring rubric, including zero-score semantics, then collect blind labels.
2. Finish incremental feature extraction after the mirror completes; reuse this fixed teacher reservation and compare the final audit to the partial-data audit.
3. Run a larger grouped trial, inspect rare-class support and per-family confusion matrices, and investigate dimensions that fail the context baseline.
4. Use calibration labels to choose silence-heuristic thresholds and the untouched test subset to measure errors with intervals. This only covers an audio heuristic; identity, photos, song correctness, and the full initial-review gate need separate validation.

The API, shared feature cache, portal-write setting, and live model were not changed by these experiments. Raw data, per-clip outputs and teacher packets remain on the mainland host. Git contains only code, tests, documentation and aggregate results.

## Completed mirror and larger trial — 2026-10-27

The mirror finished on 2026-10-24 at 14:40 UTC with no final error and zero consecutive blocks: 17,307 new downloads, 7,020 cached clips and 974 unavailable (404) clips account for all 25,301 queued clips. A fresh manifest/file audit confirms 24,327 videos and 24,326 audio files meeting the size check. One keyboard video has no usable extracted audio; it is excluded from audio-based training.

At launch, the existing caches contained 10,473 usable feature clips, including all 200 teacher-review clips. Outside the reserved learner/video groups, 4,315 labeled audio clips still needed features; 1,986 exams already had at least one labeled feature clip. The teacher CSV still has 0 reviewed and 200 pending clips. Voice has only four labeled audio clips in two learner groups outside the reservation, so additional downloads alone do not solve its label shortage.

Code `c3646c0ead8bbd446231ad9127bac4bc02a02251` adds `extract --labeled-only`. It uses the existing validated historical labels, excluding unknown scores and ambiguous all-zero vectors. Its regression test checks that partially labeled clips are included and completed feature caches are reused. All 14 ML tests pass. The prior build, type checks and 41 API/shared tests remain applicable; this continuation changes only the offline lab.

A bounded continuation completed privately at `ubtxiaomi:/mnt/DAS1T/musicexamaid_ml_dataset/experiments/completed-mirror-20261027-c3646c0` on 2026-10-27 at 14:09 UTC. All 4,630 labeled audio extractions succeeded across 19 batches, including the 4,315 outside the reserved groups; the additional reserved clips remain excluded from training. Feature coverage reached 15,103 clips, with zero remaining feature gaps among available labeled audio outside the reservation. The complete extraction, trial, inference and label-validation sequence took about 26 minutes.

The trial used five learner/duplicate-disjoint folds, 100 boosting iterations, two threads, seed 42 and all eligible groups. Its snapshot contains 14,036 feature clips, including unlabeled clips; the evaluated models use 11,039 labeled clips from 3,150 unique exams and 2,383 learner/duplicate groups across five families. Voice remains unsupported. Each dimension uses its own available labels, averages clip probabilities within an exam and counts the exam once.

### Full-cohort results

The win definition is unchanged: strictly lower rank MAE than majority, median and context-only models on the same folds. Accuracy and rank MAE have different meanings; neither the win fraction nor the table's MAE ranges are a population accuracy estimate.

| Instrument family | Labeled exams per dimension | Wins / evaluated dimensions | Full-model rank MAE range | Dimensions missing score 0 |
|---|---:|---:|---:|---:|
| Bowed strings | 251 | 5 / 5 | 0.3506–0.5219 | 0 |
| Plucked strings | 1,255–1,258 | 5 / 5 | 0.2774–0.4193 | 0 |
| Percussion | 115–173 | 4 / 5 | 0.1565–0.2832 | 5 |
| Keyboard | 989–1,318 | 3 / 5 | 0.3850–0.6684 | 1 |
| Winds | 149 | 0 / 5 | 0.1208–0.3356 | 5 |
| Voice | Insufficient labeled groups | 0 evaluated | — | — |

The full model beats context-only in 19/25 comparisons, median in 20/25 and acoustic-only in 18/25. Bowed and plucked strings beat all three baselines in all five dimensions. Keyboard pitch does not beat context or median; keyboard completeness and percussion pitch do not beat median. All five wind dimensions fail to beat context. Wind accuracy ranges from 69% to 88%, but its dominant score-6 class makes that accuracy insufficient evidence of acoustic value.

Eleven cohorts lack score 0 entirely. The other fourteen contain 69 zero-rated exam/dimension entries across 48 distinct exams; **none is correctly predicted as zero**. These 69 entries are not independent exams. Six of the 125 family/dimension validation splits have an observed class absent from training. Some high-score classes are also missed: keyboard rhythm predicts none of its 113 score-10 exams as 10. Four-class performance remains unverified even where all four values occur. No statistical significance claim or automatic family/model selection follows from these comparisons.

### Completed-run validation — 2026-10-28

Private aggregate evidence is in `review-20261028/validation_report.json` and `baseline_validation.json`. Validation checked source/code provenance, teacher-group exclusion, unique and complete out-of-fold coverage, label agreement, valid probability distributions and one validation fold per learner/duplicate group and exam for each model. It independently recomputed all 25 full-model exam confusion matrices, accuracy and rank/native-score MAE, and all 50 majority/median confusion matrices. No mismatches were found across 53,617 out-of-fold clip/dimension predictions. These are saved-artifact checks; the models were not retrained during review.

The 200 reserved groups remain excluded. Saved-model inference produced 835 dimension predictions for the reserved packet; voice predictions remain absent. Teacher validation still reports 0 reviewed and 200 pending clips. The input manifest, shared cache and shared/live weights have identical before/after fingerprints. The worker held `/tmp/musicexamaid-ml-experiment.lock`, used low priority and wrote only to its new private directory. `continuation_status.json` records completion; no recurring job or model release was created.

The next useful work is to confirm the named-rating mapping and zero semantics, collect the blinded teacher labels, and obtain enough reviewed rare-rating/voice examples before testing changes for weak families. Preserve the existing reservation and keep model predictions separate from teacher labels. The current calibration code measures only an audio silence heuristic; visual identity, photos, piece correctness and full initial-review safety still need separate validation.

## Teacher review page and score-definition investigation — 2026-10-28

Code `6f5542f65ce36a97661f4da72b77c070d2569ca2` adds a [private review page](../scripts/ml_lab/README.md#private-teacher-review-page) for the original 200-clip packet. It plays only reserved videos, supports seeking, hides historical/model scores and calibration/test membership, and saves only explicit teacher judgments. It collects recording-quality verdicts and notes; five-dimensional ratings remain untouched. Teachers use an internal alias and the server records the actual save time. Saved rows pass the existing strict CSV validator and remain compatible with calibration import.

The page is running on `ubtxiaomi` at `127.0.0.1:8765`, with private state under `/mnt/DAS1T/musicexamaid_ml_dataset/experiments/teacher-review-20261028/state`. Access requires an SSH tunnel and the random login in `state/access.json`. It is separate from the live API. The original teacher CSV, reservation, shared cache and live weights have unchanged fingerprints; the working CSV starts with 0 reviewed and 200 pending. Readiness evidence is in `teacher-review-20261028/readiness.json`. No teacher judgments were generated by the tooling.

All 19 ML/reviewer tests pass. New checks cover authentication, Host/Origin restrictions, blinded metadata, safe media paths and byte ranges, explicit saves, stale-save rejection, original-packet preservation, multiline notes, resume, state locking and packet identity. A browser check on synthetic clips confirmed playback, seeking, saving, a blank next verdict and no mobile overflow; it produced no console errors. Browser test judgments apply only to temporary synthetic fixtures, not the reserved dataset.

The importer preserves explicit numeric zero and converts absent/non-numeric scores to NULL; it does not define the portal meaning of zero. Inspection of the 31,939-row original exam archive found free-text rating words paired with multiple numeric scores, so comments cannot establish a rating dictionary. The public common JavaScript was also checked and contains neither the five-dimensional score field nor these rating labels. The named mapping and zero semantics remain unconfirmed; the teacher page therefore collects recording-quality judgments without inventing performance-score names. An authoritative rubric or confirmation from the examining teacher is still required.
