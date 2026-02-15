# Idividream

Retarmax-Bot web app for Arduino workflows.

## Features
- Guided onboarding checklist for Arduino setup.
- GPT-style markdown chat UI.
- Same assistant response in two readers:
  - Human view (plain markdown)
  - Machine view (markdown wrapped in JSON markdown block)
- Server route `/api/retarmax` with runtime modes:
  - `mock` (default)
  - `openai`
  - `docker` (isolated container, one CPU)

## Run
```bash
npm install
npm run dev
```

## Optional: isolated docker agent mode (Mac/local)
Set env vars before running:

```bash
export RETARMAX_MODE=docker
export RETARMAX_DOCKER_IMAGE=ghcr.io/openai/codex-mini-agent:latest
npm run dev
```

The API executes:
```bash
docker run --rm --cpus=1 -i $RETARMAX_DOCKER_IMAGE
```
and passes markdown input through stdin.

## Optional: OpenAI mode
```bash
export RETARMAX_MODE=openai
export OPENAI_API_KEY=...
export RETARMAX_MODEL=gpt-5-nano
npm run dev
```
