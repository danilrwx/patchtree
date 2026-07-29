# Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
.PHONY: all deps vendor queries fonts themes build node_modules typecheck zip zip-firefox check test changelog clean

all: build

# everything the extension needs beyond the sources in git
deps: vendor queries fonts themes

themes:
	./scripts/fetch-themes.sh

vendor:
	./scripts/fetch-vendor.sh

queries:
	./scripts/fetch-queries.sh

fonts:
	./scripts/fetch-fonts.sh

# exact versions are pinned in package.json (this sandbox's npm produces no
# lockfile); npm install is reproducible enough given the pins.
node_modules:
	npm install

# bundle sources + copy pinned assets into dist/ (the loadable/zippable root)
build: deps node_modules
	node build.mjs

typecheck: node_modules
	npm run --silent typecheck

check:
	node --check content.js
	node --check review.js
	cp background.js .bg.mjs && node --check .bg.mjs && rm -f .bg.mjs
	node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"

test: check typecheck
	node test/run.mjs

zip: build
	rm -f patchtree.zip
	cd dist && zip -qr ../patchtree.zip .
	@ls -la patchtree.zip

zip-firefox: build
	rm -rf build/firefox patchtree-firefox.zip
	mkdir -p build
	cp -R dist build/firefox
	node scripts/firefox-manifest.mjs build/firefox/manifest.json
	cd build/firefox && zip -qr ../../patchtree-firefox.zip .
	@ls -la patchtree-firefox.zip

# grouped conventional-commit changelog; RANGE overrides (e.g. RANGE=v1.0.0..HEAD)
changelog:
	@./scripts/changelog.sh $(RANGE)

clean:
	rm -rf vendor fonts queries themes.json build dist patchtree.zip patchtree-firefox.zip