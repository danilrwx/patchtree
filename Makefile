# Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
.PHONY: all deps vendor queries fonts zip check clean

all: deps

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

check:
	node --check content.js
	node --check providers.js
	node --check review.js
	node --check options.js
	node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"

zip: check
	rm -f patchtree.zip
	zip -qr patchtree.zip \
		manifest.json background.js content.js providers.js review.js \
		options.html options.js viewer.css icons fonts vendor queries themes.json
	@ls -la patchtree.zip

zip-firefox: check
	rm -rf build/firefox patchtree-firefox.zip
	mkdir -p build/firefox
	cp -R manifest.json background.js content.js providers.js review.js \
		options.html options.js viewer.css icons fonts vendor queries themes.json build/firefox/
	node scripts/firefox-manifest.mjs build/firefox/manifest.json
	cd build/firefox && zip -qr ../../patchtree-firefox.zip .
	@ls -la patchtree-firefox.zip

clean:
	rm -rf vendor fonts queries themes.json build patchtree.zip patchtree-firefox.zip