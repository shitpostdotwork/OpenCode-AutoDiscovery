/*
 * Author: HarutoHiroki
 * License: MIT
 * Comment: some script i whipped up cuz opencode doesnt do auto discovery properly
 */

export default async () => {
  const capitalize = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

  // Special formatting stuff, most models are first letter capitalized otherwise
  const KNOWN_PREFIXES = {
    wordslop: "WordSlop",
    thinkingcap: "ThinkingCap",
  };

  const KNOWN_MODELS = {
    glm: "GLM",
    minimax: "MiniMax",
  };

  const KNOWN_TAGS = {
    uncensored: "Uncensored",
    flash: "Flash",
    single: "Single",
    instruct: "Instruct",
    code: "Code",
    moe: "MoE"
  };

  const beautifyModelName = (id) => {
    const parts = id.split("-");
    const segments = [];
    let i = 0;

    while (i < parts.length) {
      const seg = parts[i].toLowerCase();

      if (seg in KNOWN_PREFIXES) {
        segments.push(KNOWN_PREFIXES[seg]);
        i++;
      } else if (seg in KNOWN_MODELS) {
        segments.push(KNOWN_MODELS[seg]);
        i++;
      } else if (/^\d+$/.test(seg)) {
        let version = seg;
        while (i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
          i++;
          version += "." + parts[i];
        }
        segments.push(version);
        i++;
      } else if (/^\d+[bkmg]$/i.test(seg)) {
        segments.push(seg.replace(/\d+[bkmg]$/i, (m) => m.toUpperCase()));
        i++;
      } else if (/^a(\d+)([bmt]?)$/i.test(seg)) {
        const match = seg.match(/^a(\d+)([bmt]?)$/i);
        const num = match[1];
        const suffix = match[2] ? match[2].toUpperCase() : "";
        segments.push(`A${num}${suffix}`);
        i++;
      } else if (seg in KNOWN_TAGS) {
        segments.push(KNOWN_TAGS[seg]);
        i++;
      } else if (/^[a-z]\d+$/i.test(seg)) {
        if (i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
          segments.push(seg.toUpperCase() + "." + parts[i + 1]);
          i += 2;
        } else {
          segments.push(seg.toUpperCase());
          i++;
        }
      } else {
        segments.push(
          seg.length === 1 ? seg.toUpperCase() : capitalize(seg),
        );
        i++;
      }
    }

    return segments.join(" ");
  };

  const positive = (value) => {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const contextLimitOf = (m) => {
    return positive(m.context_length) ?? positive(m.max_model_len) ?? positive(m.meta?.n_ctx);
  };

  const outputLimitOf = (m) => {
    return positive(m.max_completion_tokens)
      ?? positive(m.top_provider?.max_completion_tokens)
      ?? positive(m.max_output_tokens);
  };

  const defaultOutputLimit = (contextLimit) => {
    return Math.min(Math.floor(contextLimit / 4), 32000);
  };
  
  const reasoningOf = (m) => {
    const raw = m.reasoning_effort;
    if (!raw || !Array.isArray(raw.levels)) return undefined;
    const levels = raw.levels.filter((l) => typeof l === "string" && l !== "");
    if (levels.length === 0) return undefined;
    return {
      levels,
      disable: typeof raw.disable === "string" ? raw.disable : undefined,
      default: typeof raw.default === "string" && levels.includes(raw.default) ? raw.default : undefined,
    };
  };

  // The router's disable keyword -> how thinking-off is encoded on the wire:
  //   "none"   -> reasoning_effort "none"
  //   "lowest" -> the lowest available level
  //   "qwen"   -> chat_template_kwargs.enable_thinking false
  const disableVariantOf = (reasoning) => {
    switch (reasoning.disable) {
      case "none":
        return { reasoningEffort: "none" };
      case "lowest":
        return { reasoningEffort: reasoning.levels[0] };
      case "qwen":
        return { chat_template_kwargs: { enable_thinking: false } };
      default:
        return undefined;
    }
  };

  const discover = async (id, cfg) => {
    let baseURL = cfg.options?.baseURL;
    if (!baseURL) return;
    baseURL = baseURL.replace(/\/+$/, "");
    if (!baseURL.endsWith("/v1")) baseURL += "/v1";
    const apiKey = cfg.options?.apiKey;
    try {
      const headers = {};
      if (apiKey && typeof apiKey === "string" && apiKey !== "") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const res = await fetch(baseURL + "/models", { headers: Object.keys(headers).length > 0 ? headers : undefined });
      const data = await res.json();
      const existingModels = cfg.models || {};
      const models = { ...existingModels };
      for (const m of data.data || []) {
        // Respect existing configured models
        if (existingModels[m.id]) continue;
        // Skip embedding models
        if (m.id.toLowerCase().includes("embedding") || m.id.toLowerCase().includes("embed")) continue;
        const contextLimit = contextLimitOf(m);
        const outputLimit = outputLimitOf(m) ?? (contextLimit ? defaultOutputLimit(contextLimit) : undefined);
        const inputModalities = (m.architecture?.input_modalities ?? m.modalities ?? ["text"]).map((s) => s.toLowerCase());
        const outputModalities = (m.architecture?.output_modalities ?? ["text"]).map((s) => s.toLowerCase());
        const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined;
        const reasoning = reasoningOf(m);
        const entry = {
          name: beautifyModelName(m.id),
          tool_call: params ? params.includes("tools") : true,
          modalities: { input: inputModalities, output: outputModalities },
        };
        if (contextLimit && outputLimit) {
          entry.limit = { context: contextLimit, output: outputLimit };
        }
        if (reasoning) {
          entry.reasoning = true;
          entry.variants = {};
          for (const level of reasoning.levels) {
            entry.variants[level] = { reasoningEffort: level };
          }
          if (reasoning.default) {
            entry.options = { reasoningEffort: reasoning.default };
          }
          // Thinking-off variant per the router's disable keyword
          const off = disableVariantOf(reasoning);
          if (off) entry.variants.none = off;
        }
        const pricing = m.pricing;
        if (pricing?.input || pricing?.output) {
          entry.cost = {
            input: pricing.input ?? 0,
            output: pricing.output ?? 0,
            cache_read: pricing.cache_read ?? 0,
            cache_write: pricing.cache_write ?? 0,
          };
        }
        models[m.id] = entry;
      }
      if (Object.keys(models).length > 0) {
        cfg.models = models;
        if (cfg.options) cfg.options.baseURL = baseURL;
        // console.log(`openai-compatible-autodiscover: loaded ${Object.keys(models).length} models for "${id}"`);
      }
    } catch (e) {
      console.warn(`openai-compatible-autodiscover: failed to discover models for "${id}":`, e.message);
    }
  };

  return {
    config: async (cfg) => {
      const providers = cfg.provider || {};
      for (const [id, p] of Object.entries(providers)) {
        if (p.npm === "@ai-sdk/openai-compatible") {
          await discover(id, p);
        }
      }
    },
  };
};
