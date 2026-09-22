// Camada comum das IAs: usa a que tiver chave configurada (ANTHROPIC_API_KEY e/ou GEMINI_API_KEY).
// Se as duas existirem, tenta na ordem de AI_PROVIDERS (padrão "anthropic,gemini")
// e cai pra próxima se der erro.
import Anthropic from "npm:@anthropic-ai/sdk";
import { GoogleGenAI } from "npm:@google/genai";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class ErroIA extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Pedido<T extends z.ZodType> = {
  schema: T;
  system: string;
  prompt: string;
  pesquisarWeb?: boolean;
};

type Provider = <T extends z.ZodType>(apiKey: string, pedido: Pedido<T>) => Promise<z.infer<T>>;

const anthropic: Provider = async (apiKey, { schema, system, prompt, pesquisarWeb }) => {
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  try {
    // pause_turn: o loop de pesquisa do servidor pausou; reenvia o turno pra ele continuar.
    for (let i = 0; i < 5; i++) {
      const response = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 16000,
        output_config: { effort: "medium", format: zodOutputFormat(schema) },
        system,
        messages,
        ...(pesquisarWeb && { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] }),
      });
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal") throw new ErroIA("a IA recusou esse pedido", 422);
      if (!response.parsed_output) throw new ErroIA("a IA não devolveu o formato esperado", 502);
      return response.parsed_output;
    }
    throw new ErroIA("a pesquisa demorou demais", 504);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new ErroIA("muitas requisições, tenta de novo já já", 429);
    if (error instanceof Anthropic.APIError) throw new ErroIA(`erro no Claude (${error.status})`, 502);
    throw error;
  }
};

const gemini: Provider = async (apiKey, { schema, system, prompt, pesquisarWeb }) => {
  const ai = new GoogleGenAI({ apiKey });
  const pedir = () =>
    ai.models.generateContent({
      model: Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash",
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
        ...(pesquisarWeb && { tools: [{ googleSearch: {} }] }),
      },
    });
  // O Gemini devolve 503/429 com frequência quando está sobrecarregado; tenta de novo com espera crescente.
  let response;
  for (let tentativa = 1; ; tentativa++) {
    try {
      response = await pedir();
      break;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (tentativa >= 4 || (status !== 503 && status !== 429)) throw error;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (tentativa - 1)));
    }
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(response.text ?? "null");
  } catch {
    throw new ErroIA("a IA não devolveu o formato esperado", 502);
  }
  const parsed = schema.safeParse(bruto);
  if (!parsed.success) throw new ErroIA("a IA não devolveu o formato esperado", 502);
  return parsed.data;
};

const providers: Record<string, { envKey: string; run: Provider }> = {
  anthropic: { envKey: "ANTHROPIC_API_KEY", run: anthropic },
  gemini: { envKey: "GEMINI_API_KEY", run: gemini },
};

function providersConfigurados() {
  const ordem = (Deno.env.get("AI_PROVIDERS") ?? "anthropic,gemini").split(",").map((p) => p.trim());
  return ordem.flatMap((nome) => {
    const apiKey = providers[nome] && Deno.env.get(providers[nome].envKey);
    return apiKey ? [{ nome, apiKey, run: providers[nome].run }] : [];
  });
}

export function temIAConfigurada() {
  return providersConfigurados().length > 0;
}

export async function gerarJSON<T extends z.ZodType>(pedido: Pedido<T>) {
  let ultimoErro = new ErroIA("falta ANTHROPIC_API_KEY ou GEMINI_API_KEY nos secrets", 500);
  for (const { nome, apiKey, run } of providersConfigurados()) {
    try {
      return { dados: await run(apiKey, pedido), provider: nome };
    } catch (error) {
      console.error(`[${nome}]`, error);
      ultimoErro = error instanceof ErroIA ? error : new ErroIA(`erro na IA (${nome})`, 502);
    }
  }
  throw ultimoErro;
}
