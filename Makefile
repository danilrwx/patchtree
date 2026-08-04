# Copyright 2026 Daniil Antoshin
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

.PHONY: all deps vendor queries fonts themes build node_modules typecheck lint hooks zip zip-firefox check test e2e changelog clean

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

# biome lints the code; check-headers enforces the Apache license notice
lint: node_modules
	npx biome lint
	node scripts/check-headers.mjs

# install the repo's git hooks (pre-commit runs lint + typecheck)
hooks:
	git config core.hooksPath scripts/git-hooks
	@echo "git hooks installed (core.hooksPath=scripts/git-hooks)"

# the sources are TypeScript (covered by typecheck); here we only sanity-check
# that the manifest is valid JSON
check:
	node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"

test: check lint typecheck
	node test/run.mjs
	node test/providers.mjs

# Playwright end-to-end: loads the built extension against the PR .diff fixture
# with the adapter mocked. MV3 extensions load in Chromium's new headless mode,
# so no display is needed; PT_HEADED=1 shows the window while debugging.
# First run needs: npx playwright install chromium
e2e: build
	npx playwright test

# archives go under build/ so the repo root stays clean
zip: build
	mkdir -p build
	rm -f build/patchtree.zip
	cd dist && zip -qr ../build/patchtree.zip .
	@ls -la build/patchtree.zip

zip-firefox: build
	rm -rf build/firefox build/patchtree-firefox.zip
	mkdir -p build
	cp -R dist build/firefox
	node scripts/firefox-manifest.mjs build/firefox/manifest.json
	cd build/firefox && zip -qr ../../build/patchtree-firefox.zip .
	@ls -la build/patchtree-firefox.zip

# grouped conventional-commit changelog; RANGE overrides (e.g. RANGE=v1.0.0..HEAD)
changelog:
	@./scripts/changelog.sh $(RANGE)

clean:
	rm -rf assets/vendor assets/fonts assets/queries assets/themes.json build dist