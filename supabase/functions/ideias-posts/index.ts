// Recebe o resumo do produto (saída do analisar-produto), pesquisa na web
// o que os concorrentes postam e devolve ideias de carrossel pro usuário escolher.
import { z } from "npm:zod";
import { corsHeaders, ErroIA, gerarJSON, json, temIAConfigurada } from "../_shared/ia.ts";

const Ideias = z.object({
  concorrentes: z.array(
    z.object({
      nome: z.string(),
      url: z.string(),
      o_que_postam: z.string(),
    }),
  ),
  ideias: z.array(
    z.object({
      titulo: z.string(),
      gancho: z.string(),
      formato: z.string(),
      por_que_funciona: z.string(),
      inspirado_em: z.string(),
      plataformas: z.array(z.enum(["instagram", "tiktok"])),
    }),
  ),
});

const SYSTEM = `Você é estrategista de conteúdo pra Instagram e TikTok no Brasil.
Recebe o resumo de um produto. Pesquise na web quem são os concorrentes diretos e que tipo de post eles e criadores do nicho fazem que engaja (carrosséis, listas, antes e depois, mitos, bastidores).
Depois proponha 6 ideias de carrossel pro produto, cada uma com um gancho forte pro primeiro slide.
Regras:
- Português do Brasil, informal, sem travessão.
- Em concorrentes, só inclua quem você realmente encontrou na pesquisa, com a URL.
- Em inspirado_em, diga qual padrão dos concorrentes a ideia aproveita e como ela se diferencia.
- Em formato, use algo como "lista", "passo a passo", "mito x verdade", "antes e depois", "história", "comparação".
- Em plataformas, marque onde a ideia funciona melhor (pode ser as duas).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  if (!temIAConfigurada()) return json({ error: "falta ANTHROPIC_API_KEY ou GEMINI_API_KEY nos secrets" }, 500);

  let resumo: unknown;
  try {
    resumo = (await req.json()).resumo;
    if (!resumo || typeof resumo !== "object") throw new Error();
  } catch {
    return json({ error: "mande { resumo: {...} } com a saída do analisar-produto" }, 400);
  }

  try {
    const { dados, provider } = await gerarJSON({
      schema: Ideias,
      system: SYSTEM,
      prompt: `Resumo do produto:\n${JSON.stringify(resumo, null, 2)}`,
      pesquisarWeb: true,
    });
    return json({ ...dados, provider });
  } catch (error) {
    if (error instanceof ErroIA) return json({ error: error.message }, error.status);
    throw error;
  }
});
