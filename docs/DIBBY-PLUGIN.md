# Dibby plugin connection

The plugin source is in `plugins/midnight-palette/`. Its read-only Streamable HTTP endpoint is `/mcp`, served by the existing Node app. No new npm dependencies or paid provider calls are needed.

The endpoint is disabled by default. To enable on the existing host, set `DIBBY_PUBLIC_CATALOG=true` in the server `.env`, preserving APP_PASSWORD and PUBLIC_ORIGIN, and restart the existing Midnight Palette process. This explicitly publishes only the bundled original lessons, materials and care guidance. It does not expose the database, generated projects, browser boards, passwords or API keys. The normal app stays password protected. Links to app illustrations and lessons may require app sign-in.

MCP tools: `find_canvases` (query, medium, level, minutes, limit), `get_canvas` (id), `get_medium_guide` (medium). All are read-only. The server accepts JSON POST with both `application/json` and `text/event-stream` in Accept. It returns JSON and uses no persistent MCP sessions. GET/SSE is not offered. Requests with an unrecognized Origin are rejected; server-to-server requests without Origin are supported. No CORS wildcard is added.

Before account creation, verify initialization, tool discovery and a harmless find_canvases call at https://midnight-palette.aibrylabs.com/mcp. Package the plugin directory as a ZIP and use Plugin Creator's private account upload. Do not upload a package whose production MCP endpoint has not been deployed and verified.

The skill includes session selection, practical painting/drawing advice, honest critique and real-demo guidance. Videos and personal workspace synchronization need separate app features; the plugin does not invent them.
