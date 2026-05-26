# Live Demo App

Single source tree: `src/` is bundled for the browser **and** patched by the auto-fixer on GitHub.

## Layout

```
examples/live-demo/
├── src/           # application source (bugs live here)
├── test/          # CI tests (fail until bug is fixed)
├── dist/          # build output (gitignored)
├── index.html     # demo UI shell
├── index.js       # demo bootstrap (SDK + auto pipeline)
├── css/           # shared + page styles
├── dashboard/     # error history dashboard
├── js/            # demo-only UI helpers (nav, log)
├── config.js      # projectKey, endpoint, release
├── package.json
```

## Push to GitHub (one-time)

Push **this folder** as its own repository:

```bash
cd examples/live-demo
git init
git add src test package.json .github .gitignore README.md
git commit -m "Live demo app"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Link it to the auto-fixer (from project root):

```bash
./scripts/setup-live-demo-github.sh https://github.com/YOUR_USER/YOUR_REPO
```

## Run the demo

From the **BSC project root**:

```bash
npm run build:live-demo
npm run dev              # terminal 1
npm run serve:live-demo  # terminal 2
```

Open http://localhost:8080/examples/live-demo/ (note trailing slash)

Click a crash button - analyze, patch, and PR run automatically. Error history: http://localhost:8080/examples/live-demo/dashboard/
