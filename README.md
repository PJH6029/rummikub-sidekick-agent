# Rummikub Sidekick

Browser companion for Rummikub play. Press the advice button, capture the visible game surface, send the screenshot to an OpenAI-compatible backend, and show the response as a speech bubble.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The server binds to `127.0.0.1` by default. Keep it local when using real model credentials or screen captures. For any remote deployment, put it behind authentication and set an explicit allowed origin.

## Model access

Official OpenAI API:

```bash
OPENAI_API_KEY=sk-... RUMMIKUB_MODEL=gpt-5.5 RUMMIKUB_REASONING_EFFORT=medium npm run dev
```

Local `openai-oauth` experiment:

```bash
npx @openai/codex login
npx openai-oauth
OPENAI_BASE_URL=http://127.0.0.1:10531/v1 OPENAI_API_KEY=not-needed RUMMIKUB_MODEL=gpt-5.5 RUMMIKUB_REASONING_EFFORT=medium npm run dev
```

If no key or compatible base URL is configured, the server returns deterministic mock advice so the UI and capture flow remain testable.

## Capture notes

- `Board` capture uses same-origin DOM capture and works for the built-in demo board.
- `Screen` capture uses the browser screen-capture permission. Use it for external Rummikub pages or cross-origin iframes, because browsers do not allow a page to silently read third-party iframe pixels.
- Some game sites block embedding or require browser storage that a sandboxed iframe does not expose. In that case, open the game normally and use `Screen` capture.

## Verify

```bash
npm test
npm run build
```
