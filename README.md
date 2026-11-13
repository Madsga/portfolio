# Mads Buciek, portfolio

A static site: plain HTML, CSS and JavaScript, no build step.

- `site/` is the publish folder. Everything in it goes live; nothing outside it does.
- `source/` holds the original decks and screenshots. It is ignored by git.

## Preview locally

```bash
python3 -m http.server 4173 --directory site
```

Then open http://localhost:4173.

## Publish (Cloudflare Pages)

Connect the repository and use these settings:

- Build command: none
- Build output directory: `site`
