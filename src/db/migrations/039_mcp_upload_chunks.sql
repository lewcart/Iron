-- Migration 039: chunked-upload staging tables for MCP image uploads.
--
-- Why: Anthropic's mobile MCP client silently rejects tool calls whose
-- serialized arguments exceed a sub-64k char threshold ("Error: No approval
-- received"). The request never reaches the server. Existing
-- upload_progress_photo / upload_inspo_photo / upload_projection_photo tools
-- accept image_base64, which is unusable from Claude iOS for any image larger
-- than ~48KB binary.
--
-- Fix: server-side chunked-upload protocol. Three new MCP tools
-- (start_upload, upload_chunk, finalize_<kind>_photo) stage base64 chunks
-- here, then reassemble + push to Vercel Blob + create the photo row using
-- the existing dbCreate*Photo helpers. The existing inlined image_base64 /
-- image_url paths stay intact for non-Claude clients (server-to-server, curl).
--
-- Single-user app (Lou only): no per-user scoping on the staging rows. GC is
-- opportunistic — any start_upload or finalize call sweeps sessions older
-- than 1 hour with finalized_at IS NULL.

CREATE TABLE IF NOT EXISTS mcp_upload_sessions (
  upload_id    UUID PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('progress', 'projection', 'inspo')),
  mime_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_upload_chunks (
  upload_id   UUID NOT NULL REFERENCES mcp_upload_sessions(upload_id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL CHECK (sequence >= 0),
  data_b64    TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, sequence)
);

-- Partial index supports the GC sweep efficiently. Only orphan sessions
-- (those still pending finalize) are indexed, so the index stays tiny —
-- typically <10 rows at any moment for a single-user app.
CREATE INDEX IF NOT EXISTS mcp_upload_sessions_orphan_idx
  ON mcp_upload_sessions (created_at)
  WHERE finalized_at IS NULL;
