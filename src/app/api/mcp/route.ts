/**
 * Rebirth MCP Server — stateless JSON-RPC 2.0 over HTTP
 *
 * Implements the Model Context Protocol so Claude can manage training,
 * nutrition, and body composition data directly in Neon.
 *
 * Auth: REBIRTH_MCP_SECRET bearer token (MCP-specific).
 *       Falls back to REBIRTH_API_KEY if REBIRTH_MCP_SECRET is unset.
 *       If neither env var is set, all requests are allowed (local dev mode).
 *
 * Transport: plain POST — no SSE streaming needed for tool calls.
 * Each Vercel invocation is stateless; initialize/tools-list/tools-call
 * all handled in the same function with no session state.
 *
 * Batch support: if the request body is an array, each item is processed
 * independently and an array of responses is returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { tools, executeTool } from '@/lib/mcp-tools';

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(request: NextRequest): NextResponse | null {
  const secret = (process.env.REBIRTH_MCP_SECRET ?? process.env.REBIRTH_API_KEY)?.trim();
  if (!secret) return null; // No secret configured — open access (local dev)

  const authHeader = request.headers.get('authorization');
  const provided =
    authHeader?.startsWith('Bearer ') ? authHeader.slice(7) :
    request.headers.get('x-api-key');

  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function err(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Single request handler ────────────────────────────────────────────────────

type RpcRequest = {
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
  id?: unknown;
};

async function handleRpcRequest(body: RpcRequest) {
  const { method, params = {}, id } = body;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'rebirth-mcp', version: '1.0.0' },
      });

    case 'notifications/initialized':
      // Fire-and-forget notification — no response body required
      return null;

    case 'ping':
      return ok(id, { status: 'ok', service: 'rebirth-mcp' });

    case 'tools/list':
      return ok(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const name = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await executeTool(name, toolArgs);
      return ok(id, result);
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  // Batch support: array of requests → array of responses
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map(item => handleRpcRequest(item as RpcRequest))
    );
    return NextResponse.json(responses.filter(r => r !== null));
  }

  const response = await handleRpcRequest(body as RpcRequest);
  if (response === null) return new NextResponse(null, { status: 204 });
  return NextResponse.json(response);
}

// MCP servers must not respond to GET with an error (Claude Code health-checks via GET)
export async function GET() {
  return NextResponse.json({ name: 'rebirth-mcp', version: '1.0.0', status: 'ok' });
}
