# MIT License
#
# Copyright (c) 2026 Daniil Antoshin
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
.PHONY: all deps vendor queries fonts themes build node_modules typecheck zip zip-firefox check test e2e changelog clean

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
	cp content.js .cnt.mjs && node --check .cnt.mjs && rm -f .cnt.mjs
	cp review.js .rev.mjs && node --check .rev.mjs && rm -f .rev.mjs
	cp background.js .bg.mjs && node --check .bg.mjs && rm -f .bg.mjs
	node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"

test: check typecheck
	node test/run.mjs
	node test/providers.mjs

# Playwright end-to-end: loads the built extension against the PR .diff fixture
# with the adapter mocked. MV3 extensions need headed Chromium (xvfb on CI).
# First run needs: npx playwright install chromium
e2e: build
	npx playwright test

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