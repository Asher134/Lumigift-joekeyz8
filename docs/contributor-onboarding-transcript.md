# Contributor Onboarding Video — Transcript

> **Status:** Placeholder — transcript will be added once the onboarding video is recorded and published.
> See [CONTRIBUTING.md](../CONTRIBUTING.md#onboarding-video-walkthrough) for the video links.
> Closes #315.

---

## Overview

This transcript accompanies the Lumigift contributor onboarding video. It is provided for accessibility (deaf/hard-of-hearing contributors) and for contributors who prefer reading over watching.

The video covers four steps:

1. **Fork & clone the repository**
2. **Docker environment setup**
3. **Running the test suite**
4. **Creating and submitting a PR**

---

## Step 1 — Fork & Clone the Repository

*(Transcript to be added once video is recorded.)*

**On screen:** GitHub repository page for `joekeyz8/Lumigift-lumigift`.

```
# Fork the repo via GitHub UI, then clone your fork:
git clone https://github.com/<your-username>/Lumigift-lumigift.git
cd Lumigift-lumigift

# Add upstream remote so you can pull future changes:
git remote add upstream https://github.com/joekeyz8/Lumigift-lumigift.git
```

---

## Step 2 — Docker Environment Setup

*(Transcript to be added once video is recorded.)*

**On screen:** Terminal running Docker Compose commands.

```bash
# Copy environment variables
cp .env.example .env.local
# Edit .env.local and fill in required values

# Start all services (PostgreSQL, Redis, Next.js dev server)
docker compose -f docker-compose.dev.yml up -d

# Verify services are healthy
docker compose -f docker-compose.dev.yml ps
```

For a full walkthrough of the Docker setup, see [`docs/docker-setup.md`](../docs/docker-setup.md) and [`DOCKER_QUICK_START.md`](../DOCKER_QUICK_START.md).

---

## Step 3 — Running the Test Suite

*(Transcript to be added once video is recorded.)*

**On screen:** Terminal running Jest and Rust contract tests.

```bash
# Install Node.js dependencies
npm install

# Run all JavaScript/TypeScript tests
npm test

# Type-check the codebase
npm run type-check

# Run ESLint
npm run lint

# Build and test the Soroban smart contract
npm run contract:build
npm run contract:test
```

---

## Step 4 — Creating and Submitting a PR

*(Transcript to be added once video is recorded.)*

**On screen:** GitHub PR creation flow.

```bash
# Create a feature branch from main
git checkout main
git pull upstream main
git checkout -b feat/your-feature-name

# Make your changes, then commit using Conventional Commits format
git add .
git commit -m "feat(scope): short description of what you did"

# Push to your fork
git push -u origin feat/your-feature-name
```

Then open a pull request from your fork's branch against `joekeyz8/Lumigift-lumigift:main` via the GitHub UI. Fill in the PR template and request a review.

---

## Accessibility Notes

- Closed captions are enabled on the YouTube video.
- This transcript is the canonical text version.
- If you notice an error in the transcript, please open a PR against this file.

---

*Last updated: 2026-10-20. Review when setup steps change significantly.*
