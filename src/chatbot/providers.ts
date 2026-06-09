import { httpPost } from "./http";
import type { ChatRequest, ChatResponse, Provider, ProviderInfo } from "./types";

// ─── OpenAI-Compatible Response Shape ─────────────────────────────────────────

interface OAIResponse {
  model?: string;
  choices: Array<{
    message: { role: string; content: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: { message?: string; code?: string };
}

// ─── Factory: OpenAI-compatible providers ─────────────────────────────────────

function makeOAI(
  info: ProviderInfo,
  extraHeaders?: (key: string) => Record<string, string>
): Provider {
  return {
    info,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const t0 = Date.now();
      const url = `${info.baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
        ...(extraHeaders ? extraHeaders(req.apiKey) : {}),
      };

      const payload = {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
        stream: false,
      };

      const resp = await httpPost(url, headers, JSON.stringify(payload));

      if (resp.statusCode === 401 || resp.statusCode === 403) {
        throw new Error("Invalid or missing API key. Check your credentials.");
      }
      if (resp.statusCode === 429) {
        throw new Error("Rate limit exceeded. Please wait and try again.");
      }
      if (resp.statusCode !== 200) {
        let msg = `API error ${resp.statusCode}`;
        try {
          const e = JSON.parse(resp.body) as OAIResponse;
          if (e.error?.message) msg = e.error.message;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const data = JSON.parse(resp.body) as OAIResponse;
      const choice = data.choices?.[0];
      if (!choice) throw new Error("No response choices returned by model");

      return {
        content: choice.message.content ?? "",
        model: data.model ?? req.model,
        provider: info.id,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        latencyMs: Date.now() - t0,
      };
    },
  };
}

// ─── Factory: Cloudflare Workers AI ────────────────────────────────────────────

interface CFResponse {
  result?: { response?: string };
  success?: boolean;
  errors?: Array<{ message?: string }>;
}

function makeCloudflare(info: ProviderInfo): Provider {
  return {
    info,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const t0 = Date.now();
      const accountId = req.extraConfig?.["accountId"] ?? "";

      if (!accountId) {
        throw new Error("Cloudflare Account ID is required. Enter it in the sidebar.");
      }

      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${req.model}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
      };

      const payload = {
        messages: req.messages,
        max_tokens: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0.7,
      };

      const resp = await httpPost(url, headers, JSON.stringify(payload));

      if (resp.statusCode === 401 || resp.statusCode === 403) {
        throw new Error("Invalid Cloudflare API token or Account ID.");
      }
      if (resp.statusCode !== 200) {
        throw new Error(`Cloudflare API error ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
      }

      const data = JSON.parse(resp.body) as CFResponse;

      if (!data.success) {
        throw new Error(data.errors?.[0]?.message ?? "Cloudflare API returned an error");
      }

      return {
        content: data.result?.response ?? "",
        model: req.model,
        provider: info.id,
        latencyMs: Date.now() - t0,
      };
    },
  };
}

// ─── All Providers ─────────────────────────────────────────────────────────────

export const ALL_PROVIDERS: Provider[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────────
  makeOAI({
    id: "openai",
    name: "OpenAI",
    homepage: "https://platform.openai.com/",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    rateLimits: "Depends on usage tier",
    notes: "Requires paid account. GPT-4o Mini is cheapest option.",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "o1-mini", name: "o1 Mini" },
      { id: "o1", name: "o1" },
      { id: "o3-mini", name: "o3 Mini" },
    ],
  }),

  // ── OpenRouter ──────────────────────────────────────────────────────────────
  makeOAI(
    {
      id: "openrouter",
      name: "OpenRouter",
      homepage: "https://openrouter.ai/",
      baseUrl: "https://openrouter.ai/api/v1",
      envVar: "OPENROUTER_API_KEY",
      rateLimits: "20 req/min · 50 req/day (free)",
      notes: "Aggregates many providers. Free models need no credit card.",
      models: [
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", notes: "free" },
        { id: "deepseek/deepseek-chat-v3-5:free", name: "DeepSeek V3 Flash", notes: "free" },
        { id: "google/gemma-3-27b-it:free", name: "Gemma 3 27B", notes: "free" },
        { id: "mistralai/mistral-nemo:free", name: "Mistral Nemo", notes: "free" },
        { id: "microsoft/phi-4:free", name: "Phi-4", notes: "free" },
        { id: "qwen/qwen3-235b-a22b:free", name: "Qwen3 235B", notes: "free" },
        { id: "nousresearch/hermes-3-llama-3.1-405b:free", name: "Hermes 3 405B", notes: "free" },
        { id: "google/gemma-3-12b-it:free", name: "Gemma 3 12B", notes: "free" },
        { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B", notes: "free" },
      ],
    },
    () => ({
      "HTTP-Referer": "https://github.com/cheahjs/free-llm-api-resources",
      "X-Title": "Free LLM Chatbot",
    })
  ),

  // ── Groq ────────────────────────────────────────────────────────────────────
  makeOAI({
    id: "groq",
    name: "Groq",
    homepage: "https://console.groq.com/",
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    rateLimits: "llama-3.1-8b: 14,400/day · llama-3.3-70b: 1,000/day",
    notes: "Fastest free inference. No credit card required.",
    models: [
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", notes: "14,400/day" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", notes: "1,000/day" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B 32K", notes: "14,400/day" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B IT", notes: "14,400/day" },
      { id: "llama3-70b-8192", name: "Llama 3 70B", notes: "1,000/day" },
      { id: "llama3-8b-8192", name: "Llama 3 8B", notes: "14,400/day" },
    ],
  }),

  // ── Mistral (La Plateforme) ─────────────────────────────────────────────────
  makeOAI({
    id: "mistral",
    name: "Mistral (La Plateforme)",
    homepage: "https://console.mistral.ai/",
    baseUrl: "https://api.mistral.ai/v1",
    envVar: "MISTRAL_API_KEY",
    rateLimits: "1 req/sec · 500K tokens/min · 1B tokens/month per model",
    notes: "Phone verification required. Free tier opts into data training.",
    models: [
      { id: "open-mistral-7b", name: "Mistral 7B", notes: "open" },
      { id: "open-mixtral-8x7b", name: "Mixtral 8x7B", notes: "open" },
      { id: "open-mistral-nemo", name: "Mistral Nemo 12B", notes: "open" },
      { id: "mistral-small-latest", name: "Mistral Small Latest", notes: "free tier" },
    ],
  }),

  // ── Cerebras ────────────────────────────────────────────────────────────────
  makeOAI({
    id: "cerebras",
    name: "Cerebras",
    homepage: "https://cloud.cerebras.ai/",
    baseUrl: "https://api.cerebras.ai/v1",
    envVar: "CEREBRAS_API_KEY",
    rateLimits: "30 req/min · 14,400 req/day (both models)",
    notes: "Ultra-fast Wafer-Scale Engine inference. No credit card needed.",
    models: [
      { id: "llama3.1-8b", name: "Llama 3.1 8B" },
      { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    ],
  }),

  // ── NVIDIA NIM ──────────────────────────────────────────────────────────────
  makeOAI({
    id: "nvidia",
    name: "NVIDIA NIM",
    homepage: "https://build.nvidia.com/",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envVar: "NVIDIA_API_KEY",
    rateLimits: "40 req/min",
    notes: "Phone verification required. Context windows may be limited.",
    models: [
      { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
      { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "nvidia/llama-3.1-nemotron-nano-8b-v1", name: "Nemotron Nano 8B" },
      { id: "mistralai/mistral-7b-instruct-v0.3", name: "Mistral 7B v0.3" },
      { id: "microsoft/phi-3-mini-128k-instruct", name: "Phi-3 Mini 128K" },
      { id: "google/gemma-2-9b-it", name: "Gemma 2 9B IT" },
    ],
  }),

  // ── GitHub Models ───────────────────────────────────────────────────────────
  makeOAI({
    id: "github",
    name: "GitHub Models",
    homepage: "https://github.com/marketplace/models",
    baseUrl: "https://models.inference.ai.azure.com",
    envVar: "GITHUB_TOKEN",
    rateLimits: "Varies by Copilot tier. Very restrictive token limits.",
    notes: "Requires GitHub account. Use a Personal Access Token (PAT).",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "meta-llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "meta-llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
      { id: "mistral-nemo", name: "Mistral Nemo" },
      { id: "Phi-3.5-mini-instruct", name: "Phi-3.5 Mini" },
      { id: "DeepSeek-R1", name: "DeepSeek R1" },
    ],
  }),

  // ── Google AI Studio (OpenAI-compat endpoint) ───────────────────────────────
  makeOAI({
    id: "google",
    name: "Google AI Studio",
    homepage: "https://aistudio.google.com/",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GOOGLE_API_KEY",
    rateLimits: "Gemini 2.0 Flash: 1,500 req/day · 1M tokens/day",
    notes: "Data used for training outside EU/UK/EEA. No credit card needed.",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", notes: "1,500/day" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", notes: "1,500/day" },
      { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B", notes: "1,500/day" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", notes: "50/day" },
      { id: "gemma-3-27b-it", name: "Gemma 3 27B IT", notes: "free" },
      { id: "gemma-3-12b-it", name: "Gemma 3 12B IT", notes: "free" },
    ],
  }),

  // ── Cohere (OpenAI-compat endpoint) ─────────────────────────────────────────
  makeOAI({
    id: "cohere",
    name: "Cohere",
    homepage: "https://cohere.com/",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    envVar: "COHERE_API_KEY",
    rateLimits: "20 req/min · 1,000 req/month",
    notes: "Trial key available without credit card.",
    models: [
      { id: "command-r", name: "Command R" },
      { id: "command-r-plus", name: "Command R+" },
      { id: "command", name: "Command" },
      { id: "command-light", name: "Command Light" },
    ],
  }),

  // ── HuggingFace Inference API ────────────────────────────────────────────────
  makeOAI({
    id: "huggingface",
    name: "HuggingFace",
    homepage: "https://huggingface.co/",
    baseUrl: "https://api-inference.huggingface.co/v1",
    envVar: "HF_API_KEY",
    rateLimits: "$0.10/month credits (thousands of free calls)",
    notes: "Access to 1000s of open models. Free tier available.",
    models: [
      { id: "HuggingFaceH4/zephyr-7b-beta", name: "Zephyr 7B Beta" },
      { id: "mistralai/Mistral-7B-Instruct-v0.2", name: "Mistral 7B v0.2" },
      { id: "microsoft/Phi-3-mini-4k-instruct", name: "Phi-3 Mini 4K" },
      { id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B" },
      { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B" },
    ],
  }),

  // ── Cloudflare Workers AI ────────────────────────────────────────────────────
  makeCloudflare({
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    homepage: "https://developers.cloudflare.com/workers-ai/",
    baseUrl: "https://api.cloudflare.com",
    envVar: "CLOUDFLARE_API_TOKEN",
    rateLimits: "10,000 neurons/day (free tier)",
    notes: "Requires Cloudflare account ID + API token. 40+ models.",
    extraConfig: {
      key: "accountId",
      label: "Account ID",
      placeholder: "Your Cloudflare Account ID",
    },
    models: [
      { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
      { id: "@cf/meta/llama-3-8b-instruct", name: "Llama 3 8B" },
      { id: "@cf/mistral/mistral-7b-instruct-v0.1", name: "Mistral 7B v0.1" },
      { id: "@cf/google/gemma-7b-it", name: "Gemma 7B IT" },
      { id: "@cf/qwen/qwen1.5-7b-chat", name: "Qwen 1.5 7B Chat" },
      { id: "@cf/microsoft/phi-2", name: "Phi-2" },
    ],
  }),
];

export const PROVIDERS = new Map<string, Provider>(
  ALL_PROVIDERS.map((p) => [p.info.id, p])
);
