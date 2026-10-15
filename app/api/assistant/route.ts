import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type AssistantRequest = {
  question?: string;
  metrics?: Record<string, unknown>;
  forecast?: Record<string, unknown>;
  losses?: Array<{ name: string; value: number }>;
  filters?: Record<string, unknown>;
  dataQuality?: string[];
};

export async function POST(request: NextRequest) {
  const body = await request.json() as AssistantRequest;
  if (!body.question?.trim()) return NextResponse.json({ error: "Escreva uma pergunta para continuar." }, { status: 400 });
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "Assistente indisponível: configure OPENROUTER_API_KEY no ambiente seguro da Vercel." }, { status: 503 });

  const context = {
    filters: body.filters || {},
    indicators: body.metrics || {},
    forecast_next_operational_day: body.forecast || {},
    losses_minutes: body.losses || [],
    missing_inputs: body.dataQuality || []
  };
  const system = `Você é GAP Insight, um analista industrial que explica OEE e previsões operacionais em português do Brasil. Use exclusivamente o resumo JSON fornecido. A previsão numérica é estatística e deve ser tratada como estimativa, nunca como certeza. Não invente causas, metas, números ou dados que não estejam no contexto. Se algum componente estiver indisponível ou houver dados faltantes, declare isso primeiro. Explique com objetividade, em no máximo 130 palavras. Não apresente a resposta como diagnóstico definitivo.`;

  try {
    const result = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000",
        "X-Title": "GAP OEE Insight"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "qwen/qwen3.6-27b",
        temperature: 0.15,
        max_tokens: 280,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Pergunta: ${body.question}\n\nResumo autorizado: ${JSON.stringify(context)}` }
        ]
      })
    });
    if (!result.ok) {
      // Keep the provider body in server logs only. The UI receives an HTTP
      // status that is actionable but never exposes the API key or payload.
      const providerBody = await result.text();
      console.error("OpenRouter request failed", { status: result.status, providerBody });
      const hint = result.status === 401 ? "verifique a chave OPENROUTER_API_KEY" : result.status === 429 ? "o limite gratuito foi atingido; tente novamente mais tarde" : result.status === 402 ? "a conta não possui crédito ou permissão para este modelo" : "o modelo gratuito está temporariamente indisponível";
      return NextResponse.json({ error: `OpenRouter HTTP ${result.status}: ${hint}.` }, { status: 502 });
    }
    const data = await result.json();
    return NextResponse.json({ answer: data.choices?.[0]?.message?.content || "Não foi possível interpretar a resposta do assistente." });
  } catch {
    return NextResponse.json({ error: "Não foi possível conectar ao assistente agora." }, { status: 502 });
  }
}
