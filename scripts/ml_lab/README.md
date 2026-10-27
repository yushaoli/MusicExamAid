# MusicExamAid offline ML lab

Prepare tools and run trials while the video mirror continues. This package reads existing local files. It never connects to the exam portal or database, changes the shared feature cache, publishes model weights, or enables portal writes.

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
