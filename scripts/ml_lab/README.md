# MusicExamAid offline ML lab

Prepare tools and run offline trials on downloaded recordings. This package reads existing local files. It never connects to the exam portal or database, changes the shared feature cache, publishes model weights, or enables portal writes.

**Current plan (2026-10-29):** manual teacher review is deferred because teacher capacity is unavailable. Continue development with historical official scores, then use unseen incoming exams with official 5D results for separate calibration and testing. The prepared 200-group reservation stays excluded from training. The [prospective workflow](#official-score-calibration) is implemented; a fresh cohort has not yet been enrolled or evaluated.

## Environment and tests

Run from the repository root with Python 3.11 or newer:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/ml_lab/requirements.txt
. .venv/bin/activate
make test-ml
```

The DAS dataset already has a Python environment at `/mnt/DAS1T/musicexamaid_ml_dataset/.venv`. Use it for private experiments on `ubtxiaomi`; do not upgrade that shared environment as part of a trial. Trial reports record the actual Python, NumPy, SciPy and scikit-learn versions.

## First trial

Choose a **new** experiment directory. Commands refuse to overwrite an existing output directory or write into media / production paths. Generated files use private permissions. Keep all manifests, pseudonymous predictions, teacher packets, and models on the mainland machine; only aggregate metrics belong in git or shared reports.

```bash
export OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2
DATASET=/mnt/DAS1T/musicexamaid_ml_dataset
LAB_RUN="$DATASET/experiments/my-run"

python -m scripts.ml_lab packet --dataset-root "$DATASET" \
  --out "$LAB_RUN/teacher-packet" --size 200

# Optional bounded batch of previously unanalyzed, already extracted audio.
# New cache files are separate; the downloader's cache and live model stay untouched.
python -m scripts.ml_lab extract --dataset-root "$DATASET" \
  --out "$LAB_RUN/features-001" --limit 100

python -m scripts.ml_lab trial --dataset-root "$DATASET" \
  --out "$LAB_RUN/trial-001" --packet "$LAB_RUN/teacher-packet" \
  --extra-cache "$LAB_RUN/features-001/features.jsonl" \
  --max-groups-per-family 150 --folds 3 --iterations 60 --threads 2
```

`trial_report.json` contains per-family/per-dimension comparisons. `models.joblib` supports later offline inference. `training_snapshot.jsonl`, source hashes, code hashes and version metadata make a run reviewable. All model fits use two threads by default; use `nice -n 10` and the experiment lock `/tmp/musicexamaid-ml-experiment.lock` on the shared host. Stage experiment code under its host deployment lock; do not overwrite the running API or mirror scripts.

## When downloads finish

Use the same teacher packet so its learners remain reserved. Run another `audit`, extract additional features to a new directory, and pass each cache with repeated `--extra-cache`. Cached rows are joined by season **and** clip ID, never by clip ID alone. Conflicting duplicate feature rows fail instead of silently replacing previous features.

For a supervised trial, use `extract --labeled-only` to process clips with at least one usable historical dimension label first. Unknown scores and ambiguous all-zero vectors are excluded by the same label policy used for training. This saves work on unlabeled audio; it does not supply missing teacher labels. Use bounded batches (for example, `--limit 250`) and include all earlier caches on the next batch. Each batch checkpoints its own output; neither the shared cache nor earlier batches are overwritten.

```bash
python -m scripts.ml_lab audit --dataset-root "$DATASET" --out "$LAB_RUN/final-audit"
python -m scripts.ml_lab extract --dataset-root "$DATASET" \
  --out "$LAB_RUN/features-002" --extra-cache "$LAB_RUN/features-001/features.jsonl" --limit 30000
python -m scripts.ml_lab trial --dataset-root "$DATASET" \
  --out "$LAB_RUN/full-trial" --packet "$LAB_RUN/teacher-packet" \
  --extra-cache "$LAB_RUN/features-001/features.jsonl" \
  --extra-cache "$LAB_RUN/features-002/features.jsonl" \
  --max-groups-per-family 0 --folds 5 --iterations 100 --threads 2
```

This is a deliberate manual continuation, not a scheduled job or automatic model release.

## Forward-season check

`forward-trial` trains on earlier seasons and evaluates one explicitly chosen season. It uses all available labeled feature clips outside the teacher reservation and purges every group appearing in the test season from historical training, including groups whose test-season recordings are unlabeled or unavailable. Future-season data is excluded. The regular `trial` fold/group-cap options do not apply.

```bash
python -m scripts.ml_lab forward-trial --dataset-root "$DATASET" \
  --out "$LAB_RUN/forward-20265" --packet "$LAB_RUN/teacher-packet" \
  --test-season 20265 --iterations 100 --threads 2 \
  --min-groups 20 --min-test-groups 5 \
  --extra-cache "$LAB_RUN/features-001/features.jsonl"
```

Pass every immutable cache from the full-cohort run, including the packet features and completed labeled-feature batches, using repeated `--extra-cache`. Choose the test season and settings before inspecting its results. The report saves train/test snapshots, every variant's test probabilities, exam-level metrics and training-only model artifacts. Families/dimensions with insufficient historical groups, test groups or training classes have no default prediction.

This is a **retrospective** check: seasons in the existing archive already contributed to earlier grouped CV. It is not a new untouched final test or a basis for tuning repeatedly on the latest season. It checks whether historical training transfers to newer learners/seasons. Partial labels, rare classes and unverified score semantics still limit conclusions; teacher labels remain necessary for gate calibration.

## Official-score calibration

`python -m scripts.ml_lab.prospective` provides a separate four-step workflow. It reads local files and needs no new teacher-scoring campaign. Run on the mainland host under the same experiment lock and two-thread limit. Choose the upcoming official season and closing timestamp before examining incoming scores; set `COHORT_SEASON` and `COHORT_CLOSE_AT` accordingly. The commands below illustrate separate stages, not a script to run all at once.

Freeze a trusted existing lab candidate and its training-only snapshot. `freeze` copies the model, records all historical/reserved identity hashes, and fits context/acoustic baselines on that same training snapshot. It fixes the split seed, numeric label policy, temperature bounds, support minimums, closing time and source/code versions.

```bash
umask 077
NEXT_RUN="$DATASET/experiments/new-official-cohort"
python -m scripts.ml_lab.prospective freeze --dataset-root "$DATASET" \
  --model-dir "$LAB_RUN/full-trial" --packet "$LAB_RUN/teacher-packet" \
  --season "${COHORT_SEASON:?Set the upcoming official season}" \
  --close-at "${COHORT_CLOSE_AT:?Set a future ISO timestamp with timezone}" \
  --out "$NEXT_RUN/frozen" --threads 2
```

Capture the intake manifest **before the fixed closing time**, then preserve it. Use an ordinary copy with its actual capture time; do not preserve/backdate its modification time. The original manifest can later receive official score updates. Pass every immutable feature cache at enrollment, including incremental batches.

```bash
cp "$DATASET/manifest_all_clips.jsonl" "$NEXT_RUN/intake_manifest.jsonl"
```

After the closing time, enroll once from that snapshot. A prospective run rejects snapshots modified after closing. Enrollment ignores scores, excludes groups connected to any historical exam/learner/video or the original teacher reservation, and assigns each new group by a fixed hash to calibration or final test. Groups stay together across exams, clips and instrument families. The approximately half/half split does not guarantee balanced families/classes; `enrollment.json` reports realized family counts. Unavailable/unfeatured groups stay enrolled and appear in coverage counts. Predictions use only available cached audio at enrollment, average probabilities per exam, and are saved separately for each partition without labels.

```bash
python -m scripts.ml_lab.prospective enroll --dataset-root "$DATASET" \
  --frozen "$NEXT_RUN/frozen" --intake-manifest "$NEXT_RUN/intake_manifest.jsonl" \
  --extra-cache "$LAB_RUN/features-001/features.jsonl" --out "$NEXT_RUN/enrolled"
```

When official exam-level 5D results reach the normal local manifest, fit only against calibration scores. The held-out scores are not inspected by this step. With default settings, each family/dimension needs at least 20 calibration groups, two observed classes and five exams in each observed class. Missing classes are reported. If a true class has zero base probability, calibration is unsupported rather than inventing class support. Missing labels leave the run pending.

```bash
python -m scripts.ml_lab.prospective calibrate --dataset-root "$DATASET" \
  --frozen "$NEXT_RUN/frozen" --enrolled "$NEXT_RUN/enrolled" \
  --out "$NEXT_RUN/calibration-001"
```

This first method uses [temperature scaling](https://proceedings.mlr.press/v70/guo17a.html): one positive temperature per supported family/dimension, fitted to exam-level log loss over the fixed range 0.05–20. Exact zero probabilities and the most likely class stay unchanged. It adjusts confidence, **not score-class accuracy**, and cannot repair the observed rare-class misses. Reports include classification errors, log loss, multiclass Brier loss (sum across four classes) and confidence-bin counts/accuracy. These scores do not isolate calibration quality by themselves; see the [scikit-learn calibration guide](https://scikit-learn.org/stable/modules/calibration.html). Support minimums are operational checks, not a guarantee of statistical precision.

Freeze the adjustment and wait until the final group's official results are ready before running the final test. It reports available-label counts and all five fixed comparisons plus calibrated full-model probabilities where supported. It requires five test groups per evaluated family/dimension by default. A successful test records completion and rejects subsequent tuning/evaluation on the same enrollment; retain its saved report. Changed identities linking history, calibration and test groups are rejected before using labels.

```bash
python -m scripts.ml_lab.prospective evaluate --dataset-root "$DATASET" \
  --frozen "$NEXT_RUN/frozen" --enrolled "$NEXT_RUN/enrolled" \
  --calibration "$NEXT_RUN/calibration-001" --out "$NEXT_RUN/final-test"
```

For historical practice only, `freeze --rehearsal` permits a past closing timestamp and marks every subsequent artifact `retrospective_rehearsal`; it cannot become a fresh test. Ordinary prospective runs require a future closing time. Keep all snapshots, predictions, models and labels private; no step promotes a model or changes portal settings. Performance scores do not replace recording-quality labels for the separate silence-heuristic `calibrate` command below.

## Method and limits

- Group by learner and connect identical source videos using nonempty MD5 or source host/path. These groups stay together during validation, including different exams or seasons. Learner IDs can still contain archive mistakes; unrecognized duplicate content remains a limitation.
- Fit cumulative ordinal models for the observed numeric levels **0, 3, 6, 10**, separately for keyboard, plucked strings, bowed strings, winds, percussion and voice. The mapping to named categories **好/较好/一般/尚可 is unverified**. Do not invent a mapping. Exclude all-zero historical vectors as ambiguous; retain zero dimensions in otherwise nonzero exams. Unknown score values are reported and excluded.
- Fit encoders and models within training folds. No score-derived priors, exam IDs, piece-title templates or validation labels enter model features. Compare majority, median, context-only (grade/instrument), acoustic-only and full models on the same folds.
- Each exam has equal total training weight. Average its clip probabilities and count the exam once in accuracy, rank/native-score MAE, four-level macro F1, quadratic kappa and confusion matrices. Historical examiner labels apply to exams; the trial does not establish clip-specific or timestamp-specific accuracy.
- Report absent classes and skip families/dimensions with insufficient learner groups. A three-level cohort does not establish four-level recognition. Small-group stratification cannot guarantee every class in every fold.
- Features currently reuse the legacy acoustic extractor and its first-210-second analysis cap. It does not validate exact error timestamps, visual identity, photos or song correctness.
- The mirror downloads scored material first and cached features cover a selected subset. These results are exploratory; compare the final data audit before drawing conclusions about the full archive. `production_ready` remains false.

Primary library references: [grouped stratification](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.StratifiedGroupKFold.html), [histogram gradient boosting](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingClassifier.html).

## Teacher review and gate calibration

This optional workflow is deferred under the current plan. Its labels concern recording quality; incoming official performance scores must not be entered as PASS / NEEDS_HUMAN_CHECK / REJECT. The `calibrate` command below calibrates the audio silence heuristic, not the 5D performance model.

`packet` selects one available clip per independent learner/video group, balanced across instrument families without conditioning on official scores. The default 200 clips have 100 calibration and 100 held-out test clips. **All recordings from their learners/duplicate-video groups are excluded from every trial using that packet**, including future recordings linked through learner IDs, MD5 or source paths.

`teacher_labels.csv` is blank and blinded to official/model scores. Teachers review the local MP4 paths and enter PASS / NEEDS_HUMAN_CHECK / REJECT, optional native numeric dimension ratings, an internal reviewer alias and a timestamp with timezone. Confirm the scoring rubric before collecting dimension labels. Partial labels remain pending; nothing generates teacher judgments automatically.

Fill missing features for the reserved packet before calibrating; this does not train on it:

```bash
python -m scripts.ml_lab extract --dataset-root "$DATASET" \
  --packet "$LAB_RUN/teacher-packet" --out "$LAB_RUN/teacher-features" \
  --extra-cache "$LAB_RUN/features-001/features.jsonl" --limit 200
```

```bash
python -m scripts.ml_lab validate-labels --dataset-root "$DATASET" \
  --packet "$LAB_RUN/teacher-packet" --labels "$LAB_RUN/teacher-packet/teacher_labels.csv" \
  --out "$LAB_RUN/label-validation"

python -m scripts.ml_lab calibrate --dataset-root "$DATASET" \
  --packet "$LAB_RUN/teacher-packet" --labels "$LAB_RUN/teacher-packet/teacher_labels.csv" \
  --extra-cache "$LAB_RUN/features-001/features.jsonl" \
  --extra-cache "$LAB_RUN/teacher-features/features.jsonl" \
  --out "$LAB_RUN/gate-calibration"
```

Calibration currently tests only the audio active-ratio silence heuristic. It chooses a threshold on calibration labels and reports the untouched test result with Wilson intervals; it never tunes on test labels. With missing labels or insufficient positive/negative examples it reports `awaiting_teacher_labels_and_feature_coverage`. A non-flagged clip is not an automatic pass. Family-balanced sampling does not establish population error rates, and 100 passing clips with zero mistakes cannot demonstrate a 1% error upper bound at 95% confidence. The full multimodal gate needs separate validation.

Offline inference on cached features:

```bash
python -m scripts.ml_lab predict --dataset-root "$DATASET" \
  --model "$LAB_RUN/trial-001/models.joblib" --out "$LAB_RUN/prediction-check" --threads 2
```

Load only trusted `joblib` artifacts produced by this package; they use executable Python serialization. No command replaces the live API's weights. Model promotion, paid launch, real teacher label collection and any production changes require their own review and authorization.

`predict --packet ...` limits inference to that packet for an offline smoke check. Inference batches by family/dimension. Unsupported families or dimensions have no model prediction; no default score is invented. Keep these outputs separate from blinded teacher labels.

## Private teacher review page

Teachers can watch the existing reserved clips, enter recording-quality judgments and export a compatible CSV without editing spreadsheet rows. This page collects PASS / NEEDS_HUMAN_CHECK / REJECT, an internal reviewer alias and notes. Five-dimensional ratings stay untouched until their rubric is confirmed. No verdict is selected automatically. Saving records the actual review time; playback and navigation do not create labels.

Run on the mainland dataset host, from the staged code directory:

```bash
python -m scripts.ml_lab.review \
  --dataset-root /mnt/DAS1T/musicexamaid_ml_dataset \
  --packet /mnt/DAS1T/musicexamaid_ml_dataset/experiments/tooling-62d7ae831c7a/teacher-packet \
  --state-dir /mnt/DAS1T/musicexamaid_ml_dataset/experiments/teacher-review-20261028/state \
  --port 8765
```

The server listens only on `127.0.0.1`, requires a random password for every page/API/video/CSV request and prints only its private login-file path. Open the page from an authorized mainland workstation through an SSH tunnel. This command ignores the alias's unrelated configured port forwarding:

```bash
ssh -F /dev/null -i ~/.ssh/id_rsa -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8765:127.0.0.1:8765 ubt@100.64.0.4
```

Then visit `http://127.0.0.1:8765`. Read `state/access.json` privately to obtain the username/password; do not put them in git, URLs or shared messages. The state directory uses mode 0700; the login and saved CSV use mode 0600. No public listener or live API deployment is needed. Keep the page and media within the authorized mainland data boundary.

For the staged review above, read the login in your own terminal:

```bash
ssh -o ClearAllForwardings=yes ubtxiaomi \
  'cat /mnt/DAS1T/musicexamaid_ml_dataset/experiments/teacher-review-20261028/state/access.json'
```

Restart with the same arguments to resume. A state-directory lock prevents two server processes editing the same records; revision checks reject stale browser saves. The original packet, reservation and teacher CSV remain unchanged. Progress is saved atomically to `state/teacher_labels.csv`, and that file is also available through **导出已保存记录**. Exported rows retain the fixed calibration/test membership, which the page hides from reviewers along with historical/model scores. Video playback supports byte-range seeking and serves only packet videos. Host/Origin checks and authentication apply to saves.

Import actual reviews using the original reservation:

```bash
python -m scripts.ml_lab validate-labels --dataset-root "$DATASET" \
  --packet "$LAB_RUN/teacher-packet" \
  --labels /mnt/DAS1T/musicexamaid_ml_dataset/experiments/teacher-review-20261028/state/teacher_labels.csv \
  --out "$LAB_RUN/teacher-validation-after-review"
```

The current review concerns recording quality, not student identity, piece matching, performance scores or official exam approval. Do not turn these judgments into measurements of the full multimodal gate. A playback/network error is not evidence that the original video should be rejected. Teachers should choose NEEDS_HUMAN_CHECK when evidence is uncertain and explain that uncertainty.
