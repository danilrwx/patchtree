.PHONY: all deps vendor queries fonts zip check clean

all: deps

# everything the extension needs beyond the sources in git
deps: vendor queries fonts

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
		options.html options.js viewer.css icons fonts vendor queries
	@ls -la patchtree.zip

clean:
	rm -rf vendor fonts patchtree.zip
