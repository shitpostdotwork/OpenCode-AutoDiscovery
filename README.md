# OpenCode AutoDiscovery Plugin

Auto-discovers models from OpenAI-compatible endpoints and populates opencode's model list. Works with llama.cpp, Ollama, LM Studio, and anything else that uses the `/v1/models` API.

## Why

opencode doesn't auto-discover models from local endpoints. You have to manually define each model in your config. This plugin fixes that by hitting your endpoint's `/models` endpoint and loading whatever's available.

## Features

- Discovers models from your OpenAI-compatible endpoint, respecting any you've already configured manually
- Beautifies ugly model IDs into readable names (`qwen2-5-7b-instruct` -> `Qwen 2.5 7B Instruct`)
- Detects context and output limits from standard fields (`context_length`, `max_model_len`, `max_completion_tokens`, etc.)
- Falls back to `min(context/4, 32000)` for output limits when undetectable
- Supports auth via `apiKey` in provider options
- Maps [llama-router](https://git.shitpost.work/shitpost.work/llama-router)'s API addon report: reasoning effort variants, the advertised default effort, a thinking-off variant, `supported_parameters`, and full `pricing`
- Works with any `@ai-sdk/openai-compatible` provider in your config

## Installation

### Via npm

Add to your `opencode.json`:

```json
{
  "plugin": [
    "@shitpost.work/opencode-autodiscovery"
  ]
}
```

Configure the Forgejo registry if needed:

```bash
npm config set @shitpost.work:registry https://git.shitpost.work/api/packages/shitpost.work/npm/
```

### From local path

```json
{
  "plugin": [
    "/path/to/opencode-autodiscovery"
  ]
}
```

## Configuration

No config needed. Just make sure your OpenAI-compatible provider is defined in your `opencode.json`:

```json
{
  "provider": {
    "my-local-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8080/v1"
      }
    }
  }
}
```

For endpoints that require auth, add `apiKey`:

```json
{
  "provider": {
    "my-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "your-api-key"
      }
    }
  }
}
```

The plugin will automatically discover models for any provider using `@ai-sdk/openai-compatible`. If you've already manually configured some models on a provider, only the remaining ones are discovered.

## How it works

On opencode startup, the plugin:

1. Scans your providers for any using `@ai-sdk/openai-compatible`
2. Hits each provider's `/v1/models` endpoint (with Bearer auth if `apiKey` is set)
3. Reads context/output limits from standard response fields (`context_length`, `max_model_len`, `max_completion_tokens`, `max_output_tokens`, `meta.n_ctx`)
4. Skips models you've already configured manually
5. Beautifies model IDs into human-readable names
6. Registers discovered models with opencode

## llama-router API addon

[llama-router](https://git.shitpost.work/shitpost.work/llama-router) rewrites its `/v1/models` report through an API addon (`src/api_addon.py`) into an OpenRouter-style shape. The plugin maps that report onto opencode's model config:

- `reasoning_effort.levels` -> one variant per level, each sending `reasoning_effort: <level>` on the wire
- `reasoning_effort.default` -> the model's default `reasoningEffort`, so "no variant" matches the router's advertised default
- `reasoning_effort.disable` -> a `none` variant that turns thinking off: `none` sends `reasoning_effort: "none"`, `lowest` sends the lowest level, `qwen` sends `chat_template_kwargs: { "enable_thinking": false }`
- `supported_parameters` -> `tool_call` from the presence of `tools`
- `pricing` -> `cost`, including `cache_read` and `cache_write`
- `architecture.input_modalities` / `output_modalities` -> input/output modalities
- `context_length` / `max_output_tokens` -> `limit.context` / `limit.output`

Models with a reasoning surface also get `reasoning: true` so opencode advertises the capability.

## Model name beautification

The plugin has built-in knowledge of common model prefixes and tags:

- `qwen2-5-7b-instruct` -> `Qwen 2.5 7B Instruct`
- `gemma-3-27b-it` -> `Gemma 3 27B Instruct`
- `glm-4-9b-chat` -> `GLM 4 9B Chat`
- `kimi-k2-0905-preview` -> `Kimi K2 0905 Preview`

Unknown parts are capitalized and joined with spaces.

## License

MIT, optionally credit this if you implement the code in your codebase, would be appreciated.
