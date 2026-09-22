// Lê a landing page do produto e devolve um resumo estruturado,
// base pras próximas etapas (ideias de post, texto dos slides).
import { z } from "npm:zod";
import { corsHeaders, ErroIA, gerarJSON, json, temIAConfigurada } from "../_shared/ia.ts";

const MAX_CHARS = 200_000;

const ResumoProduto = z.object({
  nome: z.string(),
  o_que_e: z.string(),
  publico_alvo: z.string(),
  dor_principal: z.string(),
  beneficios: z.array(z.string()),
  diferenciais: z.array(z.string()),
  tom_de_voz: z.string(),
  categoria: z.string(),
  palavras_chave_concorrentes: z.array(z.string()),
});

const SYSTEM =
  "Você é estrategista de conteúdo pra Instagram e TikTok. Lê a landing page de um produto e extrai o essencial pra criar posts. Responda em português do Brasil. Use só o que está na página; se algo não aparecer, escreva 'não informado'. Em palavras_chave_concorrentes, liste termos que alguém usaria pra achar produtos concorrentes.";

function htmlParaTexto(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  if (!temIAConfigurada()) return json({ error: "falta ANTHROPIC_API_KEY ou GEMINI_API_KEY nos secrets" }, 500);

  let url: URL;
  try {
    const body = await req.json();
    url = new URL(body.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    return json({ error: "mande { url: 'https://...' }" }, 400);
  }

  let texto: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 AnalyticsOnboard" } });
    if (!res.ok) return json({ error: `a página respondeu ${res.status}` }, 422);
    texto = htmlParaTexto(await res.text());
  } catch {
    return json({ error: "não consegui abrir essa página" }, 422);
  }
  if (texto.length < 50) return json({ error: "a página veio quase vazia (site só em JS?)" }, 422);
  const cortado = texto.length > MAX_CHARS;
  texto = texto.slice(0, MAX_CHARS);

  try {
    const { dados, provider } = await gerarJSON({
      schema: ResumoProduto,
      system: SYSTEM,
      prompt: `URL: ${url}\n\nTexto da landing page:\n${texto}`,
    });
    return json({ resumo: dados, cortado, provider });
  } catch (error) {
    if (error instanceof ErroIA) return json({ error: error.message }, error.status);
    throw error;
  }
});
