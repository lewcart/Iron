/**
 * URL-path-secret MCP endpoint for Claude Web connector compatibility.
 *
 * Claude Web (claude.ai) does not support custom headers, so the MCP secret
 * must be passed as a URL path segment instead:
 *   POST /api/mcp/<REBIRTH_MCP_SECRET>
 *
 * This route validates the path segment against REBIRTH_MCP_SECRET, then
 * delegates to the same handler used by /api/mcp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { tools, executeTool } from '@/lib/mcp-tools';

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function err(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Single request handler (shared logic) ─────────────────────────────────────

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const expected = process.env.REBIRTH_MCP_SECRET?.trim();

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

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

export async function GET() {
  return NextResponse.json({ name: 'rebirth-mcp', version: '1.0.0', status: 'ok' });
}
