import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type AssistantRequest = {
  question?: string;
  metrics?: Record<string, unknown>;
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
    losses_minutes: body.losses || [],
    missing_inputs: body.dataQuality || []
  };
  const system = `Você é GAP Insight, um analista industrial que explica OEE em português do Brasil. Use exclusivamente o resumo JSON fornecido. Não invente causas, metas, números ou dados que não estejam no contexto. Se algum componente estiver indisponível ou houver dados faltantes, declare isso primeiro. Explique com objetividade, em no máximo 130 palavras. Não apresente a resposta como diagnóstico definitivo.`;

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
    if (!result.ok) return NextResponse.json({ error: "O provedor de IA não respondeu. Tente novamente ou verifique a configuração." }, { status: 502 });
    const data = await result.json();
    return NextResponse.json({ answer: data.choices?.[0]?.message?.content || "Não foi possível interpretar a resposta do assistente." });
  } catch {
    return NextResponse.json({ error: "Não foi possível conectar ao assistente agora." }, { status: 502 });
  }
}
