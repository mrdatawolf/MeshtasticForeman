# Deployment

## Building

```sh
pnpm docs:build
```

Output goes to `docs/.vitepress/dist/`.

## Hosting Options

### GitHub Pages

1. Enable Pages in repo settings
2. Set source to `docs/.vitepress/dist`
3. Push on merge:
```yaml
# .github/workflows/docs.yml
name: Deploy Docs
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
```

### Netlify / Vercel

- Root: `docs`
- Build command: `pnpm docs:build`
- Output directory: `docs/.vitepress/dist`

### Docker

```dockerfile
FROM nginx:alpine
COPY docs/.vitepress/dist /usr/share/nginx/html
```

## Base Path

If hosting in a subfolder (e.g., `github.io/repo/`), set in config:

```ts
export default defineConfig({
  base: '/repo/',
})
```