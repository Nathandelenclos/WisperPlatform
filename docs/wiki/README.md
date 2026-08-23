# Wiki sources

These files are the GitHub wiki pages, kept in the repository so they are reviewed with the code that
they describe.

GitHub only creates the wiki's git repository (`WisperPlatform.wiki.git`) once a first page exists,
and that first page has to be created from the web interface. After that:

```bash
git clone https://github.com/Nathandelenclos/WisperPlatform.wiki.git /tmp/wisper-wiki
cp docs/wiki/*.md /tmp/wisper-wiki/
rm /tmp/wisper-wiki/README.md          # this file is not a wiki page
cd /tmp/wisper-wiki && git add -A && git commit -m "docs: sync wiki from the repository" && git push
```

Page names come from file names: `Self-hosting.md` becomes the `Self-hosting` page, and the links
between pages already use that form. `Home.md` is the wiki's landing page.
