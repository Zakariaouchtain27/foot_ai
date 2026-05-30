import Anthropic from "@anthropic-ai/sdk";

import type { MatchSnapshot } from "@/lib/coaching";

export const runtime = "nodejs";
// Always run fresh — this depends on live request data, never cache the response.
export const dynamic = "force-dynamic";

// Stable, frozen system prompt → cached across requests (prefix match).
// Keep this byte-identical between calls so prompt caching actually hits.
const SYSTEM_PROMPT = `You are an elite football (soccer) tactical analyst sitting on the bench next to the head coach during a live match. You receive a real-time spatial snapshot of both teams derived from player tracking.

All coordinates are normalized 0-100. x is pitch WIDTH (touchline to touchline), y is pitch LENGTH (home attacks toward y=100, away toward y=0). Metrics per team:
- defensiveLine: height of the rearmost outfield line from that team's OWN goal (higher = pushed up).
- centroidY: average team position along the pitch length.
- width: touchline-to-touchline spread of the block.
- depth: distance between the deepest and highest outfield players (compactness; bigger = more stretched).
- hullArea: % of the pitch covered by the team's outfield shape (space control).
- formation: outfield banks inferred live (e.g. 4-3-3).
- insights: pre-computed rule-based flags.

Write a concise, practical half-time-style briefing for the coach. Use this exact structure with short Markdown headings:

## How they're playing
2-3 sentences on each team's shape and approach.

## Key weaknesses
Bullet points. For each: the weakness, why it's exploitable, and which team it applies to.

## What to work on
3-4 concrete, actionable coaching instructions a coach could shout or use at the next break.

Be specific and grounded in the numbers. Use real football language (pressing, the half-spaces, switching play, stepping up, compactness). Do not invent events you can't see (no scores, no specific players beyond jersey numbers). Keep the whole thing under ~250 words.`;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. Add it to web/.env.local." },
      { status: 500 },
    );
  }

  let snapshot: MatchSnapshot;
  try {
    snapshot = (await req.json()) as MatchSnapshot;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!snapshot?.home || !snapshot?.away) {
    return Response.json({ error: "Snapshot missing team data." }, { status: 400 });
  }

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the live tactical snapshot. Produce the briefing.\n\n${JSON.stringify(
          snapshot,
          null,
          2,
        )}`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`\n\n_[Report generation failed: ${msg}]_`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
