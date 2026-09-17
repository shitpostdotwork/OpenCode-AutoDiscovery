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
      } else if (/^\d+b$/i.test(seg)) {
        segments.push(seg.replace(/\d+b$/i, (m) => m.toUpperCase()));
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
        segments.push(seg.toUpperCase());
        i++;
      } else {
        segments.push(
          seg.length === 1 ? seg.toUpperCase() : capitalize(seg),
        );
        i++;
      }
    }

    return segments.join(" ");
  };

  const parseArg = (args, flag) => {
    const i = args.indexOf(flag);
    if (i >= 0 && i + 1 < args.length) return parseInt(args[i + 1], 10);
    return undefined;
  };

  const fetchLimits = async (baseURL) => {
    const base = baseURL.replace(/\/v1$/, "");
    try {
      const res = await fetch(base + "/models");
      const data = await res.json();
      const limits = {};
      for (const m of data.data || []) {
        const ctx = m.meta?.n_ctx ?? parseArg(m.status?.args, "--ctx-size");
        const out = parseArg(m.status?.args, "--n-predict");
        if (ctx || out) {
          limits[m.id] = { context: ctx, output: out };
        }
      }
      if (Object.keys(limits).length > 0) {
        // console.log(`openai-compatible-autodiscover: fetched limits for ${Object.keys(limits).length} models from llama.cpp /models`);
        // console log debug is the best >:D
      }
      return limits;
    } catch {
      return {};
    }
  };

  const discover = async (id, cfg) => {
    let baseURL = cfg.options?.baseURL;
    if (!baseURL) return;
    baseURL = baseURL.replace(/\/+$/, "");
    if (!baseURL.endsWith("/v1")) baseURL += "/v1";
    try {
      const res = await fetch(baseURL + "/models");
      const data = await res.json();
      const limits = await fetchLimits(baseURL);
      const models = {};
      for (const m of data.data || []) {
        const lim = limits[m.id];
        const entry = {
          name: beautifyModelName(m.id),
          tool_call: true,
          modalities: { input: ["text", "image"], output: ["text"] },
          ...(lim && (lim.context || lim.output) && { limit: lim }),
        };
        // Check for reasoning effort capabilities
        const caps = m.capabilities;
        if (caps?.reasoning_effort?.levels?.length > 0) {
          const levels = caps.reasoning_effort.levels;
          const defaultLevel = caps.reasoning_effort.default || levels[0];
          // Build variants for each reasoning effort level
          entry.variants = {};
          for (const level of levels) {
            entry.variants[level] = {
              reasoningEffort: level,
            };
          }
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
