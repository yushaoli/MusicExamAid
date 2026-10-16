.PHONY: build test typecheck check-shared

build:
	npm run build

test:
	npm test

typecheck:
	npm run typecheck

check-shared:
	./scripts/check-shared.sh
