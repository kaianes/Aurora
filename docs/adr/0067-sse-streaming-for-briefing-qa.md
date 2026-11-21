# ADR-0067: Server-Sent Events for Briefing Q&A AI Response Streaming

**Status:** Proposed
**Date:** 2026-11-16
**Epic:** E10 -- AI Creator Demo
**Governs:** NFR-04, NFR-25
**Related:** ADR-0065 (InferenceModule), ADR-0028 (briefing Q&A thread design)

## Context

US-10.1 requires that Claude's response to a creator's briefing question streams back to the browser token-by-token, with a visible "thinking" state during generation. This is the core demo beat: the audience sees Aurora respond to a live question in real time, confirming that the system is calling a live model, not returning a canned string.

Three real-time delivery mechanisms were evaluated: WebSockets, Server-Sent Events (SSE), and long polling.

**WebSockets:** Bidirectional, persistent connection over a single TCP socket. Requires a protocol upgrade handshake. Libraries available for NestJS (`@nestjs/websockets`). The bidirectional capability is unnecessary here: the creator sends one message (via HTTP POST) and the server sends many tokens in one direction. WebSockets solve a different problem (true two-way real-time interaction). They require the client to manage a persistent connection and reconnect logic, and they carry more implementation complexity on both sides for a one-way stream use case.

**Long polling:** The client POSTs the question, receives a 202, then GETs a polling endpoint repeatedly until the response is complete. Each GET returns the tokens accumulated since the last poll. The result is a chunky, batch-like experience rather than token-by-token streaming. This would not deliver the visible real-time streaming the demo requires. Long polling is also less efficient (many HTTP round trips per response) than SSE.

**Server-Sent Events (SSE):** A one-way, HTTP-based streaming protocol. The server holds the HTTP connection open and writes `data: ...\n\n` chunks as events arrive. The browser's `EventSource` API (and all major HTTP clients) handle SSE natively. No protocol upgrade, no persistent connection management beyond what HTTP already provides. The SSE connection lives exactly as long as the response takes to complete; when the stream closes, the connection closes. This maps directly onto the briefing Q&A use case: one question from the creator, one stream of tokens from Claude, then done.

SSE is the well-supported, low-complexity choice for one-directional streaming in a web application. This codebase has no existing WebSocket infrastructure; adding it for one streaming use case would be overbuilding.

**Post-only SSE:** NestJS's `@Sse()` decorator is designed for GET endpoints. This use case is a POST (the creator submits a new question, which is a write operation before the stream starts). There are two design options:

**Option A -- Split into two operations:** `POST .../messages` stores the question (returns JSON 201), then `GET .../messages/:id/stream` returns the SSE stream. The frontend makes two requests: a POST to create the question, then opens an EventSource to the GET endpoint.

The EventSource browser API is natively GET-only. This maps naturally onto option A. However, option A introduces a window between the POST returning and the GET starting where the frontend must manage two separate network operations, and the SSE GET URL must be constructed from the POST's response. This is straightforward but adds one round trip before the stream starts.

**Option B (chosen) -- Single POST that returns SSE:** A single `POST .../ask` endpoint both persists the question and opens the SSE stream in one HTTP response. The controller method injects `@Res()` to access the raw Node.js `http.ServerResponse`, sets `Content-Type: text/event-stream` and related headers, writes events using `res.write()`, and calls `res.end()` when done. NestJS's `@Sse()` decorator is not used; this is a standard NestJS controller method that writes to the response object directly.

Option B is chosen because it eliminates the two-request coordination cost. The question is persisted and the stream opens in one operation. The browser-side code uses `fetch()` with streaming response reading (the `ReadableStream` from `response.body`) rather than the native `EventSource` API (which is GET-only). `fetch()` streaming is well-supported in all modern browsers and in React Native WebView environments, covering the mobile creator use case at 360 px viewport (NFR-25). The `EventSource` API is not used.

## Decision

**US-10.1 uses a single POST endpoint at `/creator-portal/briefings/:briefingId/qa/:threadId/messages/ask` that returns a `text/event-stream` response.** The endpoint is distinct from the existing message creation endpoint. It is implemented as a NestJS controller method using `@Res()` injection and direct `res.write()` calls, not `@Sse()`.

**SSE event format:** Standard SSE format: each event is `data: <JSON string>\r\n\r\n`. The JSON structure uses a `type` field to distinguish event kinds:

```
data: {"type":"question_stored","messageId":"<uuid>","body":"...","senderType":"creator","createdAt":"<ISO8601>"}\r\n\r\n
data: {"type":"ai_thinking"}\r\n\r\n
data: {"type":"token","delta":"A "}\r\n\r\n
data: {"type":"token","delta":"taxa "}\r\n\r\n
data: {"type":"answer_stored","messageId":"<uuid>","body":"<full text>","senderType":"system","createdAt":"<ISO8601>"}\r\n\r\n
data: {"type":"done"}\r\n\r\n
```

**Error events:** If `InferenceService.streamText()` throws `InferenceUnavailableError` before or after the stream starts:

```
data: {"type":"error","error":"ai_unavailable"}\r\n\r\n
data: {"type":"done"}\r\n\r\n
```

**Persistence ordering:** The creator question is persisted (and `question_stored` emitted) before the Claude API call begins. The question is never lost because the AI call failed (US-10.1 scenario 3). The AI response is persisted (and `answer_stored` emitted) only after the complete response has been accumulated from the token stream.

**Headers the endpoint must set before writing any event:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

The `X-Accel-Buffering: no` header disables Nginx's response buffering for this connection. Without it, an Nginx reverse proxy between the browser and the server will buffer the entire response before forwarding it, defeating the streaming purpose. This header must be set even if Nginx is not currently in the deployment path, since it may be in the future (Railway and similar platforms often put a proxy in front of the application).

**Client implementation guidance for frontend-dev:** Use `fetch()` with `response.body.getReader()` to read the stream. Do not use the native `EventSource` API (it only supports GET). Parse each `\n\n`-delimited chunk as a JSON object via the `type` field. Handle `question_stored` to show the question immediately in the thread. Handle `ai_thinking` to show the thinking indicator. Handle `token` to append the delta to the in-progress response. Handle `answer_stored` to replace the accumulated tokens with the confirmed stored message. Handle `error` to clear the thinking indicator and show the unavailability message. Handle `done` to close the stream reader.

## Consequences

**What Aurora gains:**
- Token-by-token streaming with one HTTP round trip, no WebSocket infrastructure, and no two-request coordination in the frontend.
- The pattern reuses what `fetch()` and modern browsers already support natively, with no additional client library required.
- The `X-Accel-Buffering: no` header makes the streaming robust against proxy deployments from day one.
- The question is always persisted, regardless of AI availability, meeting US-10.1 scenario 3 at the architecture level rather than leaving it to implementation discipline.

**What Aurora gives up:**
- The native `EventSource` API is not used. Frontend-dev must implement the SSE parsing loop using `fetch()` streaming. This is more code than `new EventSource(url)`, but it is the same code used by all production chat-streaming applications (Claude.ai, ChatGPT, Copilot) and is well-documented. Frontend-dev should reference the Anthropic documentation's own streaming examples as a starting point.
- NestJS's `@Sse()` decorator is not used. The endpoint cannot benefit from NestJS's SSE-specific interceptors or pipes. Any cross-cutting behavior (e.g., the `CorrelationIdInterceptor`) that relies on NestJS's response lifecycle hooks may not fire for this endpoint's response. Backend-dev must ensure that the correlation ID is captured from the request and carried forward manually in the streaming code path.
- The POST response has no retry semantics. If the browser disconnects mid-stream (network interruption), the creator must resubmit the question to get a new AI response. For a demo context this is acceptable; a production implementation would add reconnection and idempotency logic.
