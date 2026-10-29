# Offline ML tooling and trial evidence

The tools are ready for experiments and teacher review; the models do not yet establish reliable four-class performance. Grouped cross-validation beats all three baselines in 17/25 family/dimension comparisons, but a [retrospective forward-season check](#forward-season-check--2026-10-28) wins only 7/20 on a different cohort. Zero-rated entries are never correctly classified in either check. These results do not justify model promotion. The studies and their different denominators are documented below; both reuse the existing archive.

## Calibration plan — 2026-10-29 owner decision

The owner has no capacity for a new teacher-scoring campaign now. Defer the 200 manual reviews and use this year's incoming official examiner results as the reference for 5D calibration, when the corresponding recordings and scores become available. This uses the normal examination process and requires no additional scoring assignment. Historical official scores remain available for offline model development; manual review is not a prerequisite for that work.

The new cohort must contain unseen learner/duplicate-video groups whose official labels have not been used in development. The existing 20265 archive has already contributed to analysis and cannot become a fresh cohort by being renamed. Keep the original 200 reserved groups excluded from training; their blank recording-quality labels remain blank.

Before inspecting the incoming scores, record the historical data cutoff, candidate model and preprocessing versions, numeric label policy, calibration method, evaluation metrics and enrollment rule in a private protocol. Assign incoming eligible learner/video groups deterministically to calibration and final-test partitions, with all linked clips/exams together and neither partition entering base-model training. Use approximately half for calibration and half for testing, allocated within instrument families without looking at scores. Fix the cohort closing rule before inspecting results so it cannot be extended selectively to improve metrics. These are planned steps; this documentation change does not enroll a cohort or fit a calibrator.

Use official exam-level 5D scores only on the calibration partition to adjust the frozen model's outputs. After freezing that adjustment, evaluate once on the untouched test partition alongside the same baselines. Count each exam once after aggregating its clips. Report family/dimension counts, class support, confusion matrices and errors; small or missing classes remain unsupported. Future development after inspecting the final test needs another untouched cohort. No fixed 200-clip target is required by this revised plan.

Continue using observed numeric scores 0, 3, 6 and 10 under the existing missing/all-zero policy until an authoritative named-rating dictionary and zero semantics are available. Performance scores do not label recording usability or establish 初审 false acceptance/rejection. That gate-calibration work is deferred, and automatic portal decisions remain disabled. The existing CLI `calibrate` evaluates an audio silence heuristic against teacher quality labels; it does not implement this prospective 5D calibration plan or accept performance scores as quality verdicts.

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

Next steps identified at the initial trial (extraction and the larger grouped trial are now complete; manual-review work is deferred by the [2026-10-29 decision](#calibration-plan--2026-10-29-owner-decision)):

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

Following the [2026-10-29 decision](#calibration-plan--2026-10-29-owner-decision), historical-label development can continue while new official scores are awaited for separate calibration and testing. Manual teacher labels are deferred. Preserve the existing reservation and keep model predictions separate from teacher labels. Named-rating/zero semantics and rare-rating/voice support remain unresolved. The current calibration code measures only an audio silence heuristic; visual identity, photos, piece correctness and full initial-review safety still need separate validation.

## Teacher review page and score-definition investigation — 2026-10-28

Code `6f5542f65ce36a97661f4da72b77c070d2569ca2` adds a [private review page](../scripts/ml_lab/README.md#private-teacher-review-page) for the original 200-clip packet. It plays only reserved videos, supports seeking, hides historical/model scores and calibration/test membership, and saves only explicit teacher judgments. It collects recording-quality verdicts and notes; five-dimensional ratings remain untouched. Teachers use an internal alias and the server records the actual save time. Saved rows pass the existing strict CSV validator and remain compatible with calibration import.

The page is running on `ubtxiaomi` at `127.0.0.1:8765`, with private state under `/mnt/DAS1T/musicexamaid_ml_dataset/experiments/teacher-review-20261028/state`. Access requires an SSH tunnel and the random login in `state/access.json`. It is separate from the live API. The original teacher CSV, reservation, shared cache and live weights have unchanged fingerprints; the working CSV starts with 0 reviewed and 200 pending. Readiness evidence is in `teacher-review-20261028/readiness.json`. No teacher judgments were generated by the tooling.

All 19 ML/reviewer tests pass. New checks cover authentication, Host/Origin restrictions, blinded metadata, safe media paths and byte ranges, explicit saves, stale-save rejection, original-packet preservation, multiline notes, resume, state locking and packet identity. A browser check on synthetic clips confirmed playback, seeking, saving, a blank next verdict and no mobile overflow; it produced no console errors. Browser test judgments apply only to temporary synthetic fixtures, not the reserved dataset.

The importer preserves explicit numeric zero and converts absent/non-numeric scores to NULL; it does not define the portal meaning of zero. Inspection of the 31,939-row original exam archive found free-text rating words paired with multiple numeric scores, so comments cannot establish a rating dictionary. The public common JavaScript was also checked and contains neither the five-dimensional score field nor these rating labels. The named mapping and zero semantics remain unconfirmed; the teacher page therefore collects recording-quality judgments without inventing performance-score names. An authoritative rubric or confirmation from the examining teacher is still required.

The owner renewed the official portal connection on 2026-10-28. The current session is inside the `musicexamaid-api` container; the similarly named host `/tmp` file was an older session and should not be treated as the current connection. Read-only authenticated requests successfully opened the admin navigation, [completed-exam results](https://kjzx002120.kj5.zgyyxykj.com/admins/exam/info_finished) and [video-review list](https://kjzx002120.kj5.zgyyxykj.com/admins/video/not_review). The results page contains the five numeric score fields, but these views and their available scripts expose no named-rating dictionary. Private source evidence remains under `experiments/rubric-investigation-20261028` on the mainland host. No score-update/export-generation actions were invoked, and portal writes remained disabled. Zero semantics are still unverified.

## Forward-season check — 2026-10-28

Code `2429cc0ebdd1d2d03fc30b7a71f7ace6ae46bbaf` adds `forward-trial`. The protocol chose **20265**, the latest season with usable labels in the frozen archive, from availability counts before examining this check's metrics. Settings were fixed at 100 iterations, seed 42, two threads, at least 20 historical training groups and five test groups per family/dimension. Every group appearing anywhere in season 20265 was purged from earlier training, including unlabeled or unavailable test-season recordings. All 200 teacher-review groups were excluded from both partitions. No future-season rows enter training. This is retrospective validation, not an untouched final test: these archive seasons already contributed to the earlier grouped CV.

The private run is `ubtxiaomi:/mnt/DAS1T/musicexamaid_ml_dataset/experiments/forward-20265-20261028-2429cc0`. Its `protocol.json` records the settings before fitting. Purging removed 962 of 9,856 available labeled historical clips. Training used 8,894 clips from 2,559 exams and 2,036 groups; the test snapshot contains 1,187 clips from 320 exams and 319 groups. One percussion exam has too little support for evaluation, leaving 319 exams across four evaluated families. Voice has no test examples. Each dimension uses its own available labels, so its denominator can be smaller.

| Instrument family | Test exams per dimension | Wins against all three baselines | Full-model rank MAE range |
|---|---:|---:|---:|
| Bowed strings | 10 | 3 / 5 | 0.7000–1.3000 |
| Keyboard | 162–163 | 3 / 5 | 0.2945–1.2393 |
| Plucked strings | 135–136 | 1 / 5 | 0.1250–0.9926 |
| Winds | 10 | 0 / 5 | 0.0000–0.4000 |
| Percussion | At most 1 | Not evaluated | — |
| Voice | 0 | Not evaluated | — |

The full model wins 7/20 comparisons under this split. In particular, plucked-string gains from grouped CV do not consistently transfer to the latest season. Bowed-string and wind cohorts have only ten exams each. Two wind dimensions contain only score 6, so an MAE of zero there also occurs for the trivial baselines and is not evidence of four-class recognition. Zero-score recall is 0/33 exam/dimension ratings. Do not pool these overlapping archive checks or interpret their win fractions as controlled before/after accuracy changes.

Label distributions differ substantially between historical training and the latest scored subset. For keyboard tone, score 10 occurs in 79/1,031 training exams (7.7%) versus 108/163 test exams (66.3%). For plucked-string expression, score 3 occurs in 255/1,024 training exams (24.9%) versus 123/135 test exams (91.1%). These are observed label-distribution shifts; they do not establish whether examiner policy, selection, instrument mix or performance changed. The latest season is only its scored archive subset, not a population estimate.

The run finished in about 71 seconds. Saved test predictions include every variant; training-only models were not refit using test labels. `validation_report.json` independently recomputed all **100** variant confusion matrices and their exam counts, accuracy, rank/native-score MAE, fixed-four-class F1 and quadratic kappa from 5,903 clip/dimension prediction rows. It also verified source/code provenance, complete unique prediction coverage, label/probability validity, the chronological boundary and zero shared learner/duplicate groups. The original packet, source manifest/cache and shared/live weights retained identical before/after fingerprints.

All **23** ML/reviewer tests pass, including new tests for purging unavailable/unlabeled learner groups, excluding future/reserved data, training-model invariance when test labels change, baseline exam weighting and explicit protocol requirements. The API build, type checks and 41 existing tests also pass; two live tests remain opt-in. No automatic promotion, recurring evaluation or teacher label generation was added. The [2026-10-29 plan](#calibration-plan--2026-10-29-owner-decision) replaces the immediate teacher-review request with incoming official-score calibration and a separate prospective test. Further model changes need validation that addresses the observed season shift; the rubric remains unresolved.
