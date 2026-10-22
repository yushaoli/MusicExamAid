.PHONY: build test typecheck check-shared migrate test-ml

build:
	npm run build

test:
	npm test

typecheck:
	npm run typecheck

check-shared:
	./scripts/check-shared.sh

migrate:
	./scripts/migrate.sh

test-ml:
	OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 python3 -m unittest discover -s scripts/ml_lab/tests -v
