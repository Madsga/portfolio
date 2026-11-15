# Mads Buciek, portfolio

A static site: plain HTML and JavaScript, styled with [Tailwind CSS](https://tailwindcss.com) v4.

- `site/` is the publish folder. Everything in it goes live; nothing outside it does.
- `src/styles.css` is the Tailwind entry: design tokens (each case's palette, fonts, type scale,
  breakpoints) and the animated name. Everything else is utility classes in the HTML.
- `site/css/site.css` is compiled from it and is not committed.
- `source/` holds the original decks and screenshots. It is ignored by git.

## Setup

Install [Node.js](https://nodejs.org) (LTS), then:

```bash
npm install
```

## Preview locally

Run these in two terminals:

```bash
npm run watch   # recompiles site/css/site.css on every change
npm run serve   # serves site/ at http://localhost:4173
```

`npm run build` compiles a minified stylesheet once.

## Publish

- Vercel: connected. Every push to `main` deploys to production; `vercel.json` runs `npm run build` and publishes `site`.
- Netlify: connect the repository. `netlify.toml` runs `npm run build` and publishes `site`.
- Cloudflare Pages: connect the repository, set the build command to `npm run build`, and set the build output directory to `site`.
