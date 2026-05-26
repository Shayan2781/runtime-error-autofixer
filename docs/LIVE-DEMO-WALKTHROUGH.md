# Live Demo - GitHub PR Walkthrough

One app, one `src/`. Push `examples/live-demo/` to GitHub; the same files are bundled for the browser and patched by the auto-fixer.

---

## One-time setup

### 1. Push to GitHub

```bash
cd examples/live-demo
git init
git add src test package.json .github .gitignore README.md
git commit -m "Live demo app"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

### 2. Configure backend (project root)

```bash
cp .env.example .env
```

```env
GITHUB_TOKEN=ghp_your_token
LLM_API_KEY=your_key          # optional; mock works without it
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct
```

### 3. Link project to repo (project root)

```bash
./scripts/setup-live-demo-github.sh https://github.com/YOUR_USER/YOUR_REPO
```

### 4. Build bundle

```bash
npm run build:live-demo
```

---

## Live demo (3 terminals from project root)

| Terminal | Command |
|----------|---------|
| 1 | `npm run dev` |
| 2 | `npm run serve:live-demo` |
| Browser | http://localhost:8080/examples/live-demo/ |

### Click sequence

1. Page load → source map uploads automatically
2. **Load Dashboard** → real crash in `src/utils.js` → Error ID
3. **Analyze** → Analysis ID
4. **Generate Patch** → diff for `src/utils.js`
5. **Create GitHub PR** → open link on GitHub

---

## ID reference

| Action | Endpoint | ID used |
|--------|----------|---------|
| Analyze | `POST /api/v1/analyze/:id` | Error ID |
| Patch | `POST /api/v1/analyze/:id/patch` | Analysis ID |
| PR | `POST /api/v1/pr/:id` | Analysis ID |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Source map failed | `npm run build:live-demo` |
| No GitHub token | `GITHUB_TOKEN` in `.env`, restart server |
| No repo URL | `./scripts/setup-live-demo-github.sh YOUR_REPO_URL` |
| Patch manual review | Repo not linked or not public |
