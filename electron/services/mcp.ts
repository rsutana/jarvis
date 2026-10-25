/**
 * Third-party MCP servers: connect over Streamable HTTP, SSE or a local command,
 * sign in with OAuth when the server asks (dynamic client registration or your own
 * client, PKCE, browser + loopback redirect), and discover the server's tools.
 * Header values, client secrets and tokens are OS-encrypted and stay in this process.
 */
import { app, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Integration, McpConfig, Policy } from '@shared/types'
import { MCP_CALLBACK_PORT, MCP_REDIRECT_URL } from '@shared/app-types'
import { commit, db, now } from './db'

interface Secret {
  headers: Record<string, string>
  clientSecret?: string
  tokens?: OAuthTokens
  client?: OAuthClientInformationMixed // from dynamic client registration
  verifier?: string // PKCE, between the browser hop and the token exchange
  state?: string
}

function find(id: string): Integration {
  const i = db().integrations.find((x) => x.id === id)
  if (!i?.mcp) throw new Error('Not a custom MCP integration')
  return i
}

function readSecret(i: Integration): Secret {
  if (!i.mcpSecret) return { headers: {} }
  return JSON.parse(safeStorage.decryptString(Buffer.from(i.mcpSecret, 'base64')))
}

function writeSecret(i: Integration, s: Secret): void {
  const empty = !Object.keys(s.headers).length && !s.clientSecret && !s.tokens && !s.client && !s.verifier && !s.state
  if (empty) return void (i.mcpSecret = undefined)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system, so MCP credentials cannot be saved safely.')
  i.mcpSecret = safeStorage.encryptString(JSON.stringify(s)).toString('base64')
}

const patch = (i: Integration, p: Partial<Secret>) => writeSecret(i, { ...readSecret(i), ...p })

/** The integration as the renderer may see it. */
export function publicIntegration({ mcpSecret: _s, ...i }: Integration): Integration {
  return i
}

/** OAuth state for one integration, persisted in its encrypted secret so a sign-in survives retries. */
class Provider implements OAuthClientProvider {
  constructor(
    private i: Integration,
    private onAuthUrl: (u: URL) => void
  ) {}
  get redirectUrl(): string {
    return MCP_REDIRECT_URL
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Jarvis',
      redirect_uris: [MCP_REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none' // a desktop app can't keep a secret; PKCE protects the exchange
    }
  }
  state(): string {
    const s = randomUUID()
    patch(this.i, { state: s })
    return s
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    const s = readSecret(this.i)
    const c = this.i.mcp!
    if (c.oauth === 'client') return c.clientId ? { client_id: c.clientId, ...(s.clientSecret ? { client_secret: s.clientSecret } : {}) } : undefined
    return s.client
  }
  saveClientInformation(client: OAuthClientInformationMixed): void {
    patch(this.i, { client })
  }
  tokens(): OAuthTokens | undefined {
    return readSecret(this.i).tokens
  }
  saveTokens(tokens: OAuthTokens): void {
    patch(this.i, { tokens })
  }
  redirectToAuthorization(url: URL): void {
    this.onAuthUrl(url) // opened once the loopback listener is up
  }
  saveCodeVerifier(verifier: string): void {
    patch(this.i, { verifier })
  }
  codeVerifier(): string {
    const v = readSecret(this.i).verifier
    if (!v) throw new Error('Sign-in expired. Connect again.')
    return v
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Jarvis</title><body style="font:16px system-ui;background:#0B0D10;color:#E7ECF5;display:grid;place-items:center;height:100vh;margin:0"><p>${esc(msg)}</p></body>`

/** Listen on the loopback redirect for the authorization code (5 min). Start it before opening the browser. */
function waitForCode(expectState: () => string | undefined): { code: Promise<string>; close: () => void } {
  let close = () => undefined as void
  const code = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', MCP_REDIRECT_URL)
      if (u.pathname !== '/callback') return void res.writeHead(404).end()
      const c = u.searchParams.get('code')
      const err = u.searchParams.get('error_description') ?? u.searchParams.get('error')
      const stateOk = !expectState() || u.searchParams.get('state') === expectState()
      const ok = !!c && stateOk
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(ok ? 'Signed in. You can close this tab and go back to Jarvis.' : `Sign-in failed: ${err ?? 'unexpected response'}`))
      if (ok) resolve(c!)
      else reject(new Error(err ? `Sign-in failed: ${err}` : 'Sign-in failed: the response did not match this request'))
    })
    const timer = setTimeout(() => reject(new Error('Sign-in timed out after 5 minutes')), 300_000)
    close = () => {
      clearTimeout(timer)
      server.close()
    }
    server.on('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${MCP_CALLBACK_PORT} is busy, so the sign-in can't come back. Close whatever uses it and try again.` : e.message))
    )
    server.listen(MCP_CALLBACK_PORT, '127.0.0.1')
  })
  return { code, close: () => close() }
}

function transportFor(i: Integration, provider?: OAuthClientProvider) {
  const c = i.mcp!
  if (c.transport === 'stdio') return new StdioClientTransport({ command: c.command!, args: c.args ?? [], stderr: 'pipe' })
  const s = readSecret(i)
  const headers = Object.fromEntries((c.headers ?? []).flatMap((h) => (s.headers[h.name] !== undefined ? [[h.name, s.headers[h.name]]] : [])))
  const opts = { authProvider: provider, requestInit: { headers } }
  return c.transport === 'sse' ? new SSEClientTransport(new URL(c.url!), opts) : new StreamableHTTPClientTransport(new URL(c.url!), opts)
}

const sameEndpoint = (a: McpConfig | undefined, b: McpConfig) =>
  !!a && a.transport === b.transport && a.url === b.url && a.oauth === b.oauth && a.clientId === b.clientId && a.command === b.command && (a.args ?? []).join('\0') === (b.args ?? []).join('\0')

export function configureMcp(id: string, cfg: McpConfig, secrets: { headers?: Record<string, string>; clientSecret?: string }): Integration {
  const i = find(id)
  if (!['http', 'sse', 'stdio'].includes(cfg.transport)) throw new Error('Pick a transport')
  if (cfg.transport === 'stdio') {
    if (!cfg.command?.trim()) throw new Error('Enter the command that starts the server')
  } else {
    let u: URL
    try {
      u = new URL(cfg.url ?? '')
    } catch {
      throw new Error('Enter the server URL, e.g. https://mcp.example.com/mcp')
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error('The URL must start with https:// (or http:// for a local server)')
  }
  if (cfg.oauth === 'client' && !cfg.clientId?.trim()) throw new Error('Enter the OAuth client ID')
  const names = (cfg.headers ?? []).map((h) => h.name.trim()).filter(Boolean)
  const bad = names.find((n) => !/^[A-Za-z0-9-]+$/.test(n))
  if (bad) throw new Error(`"${bad}" is not a valid header name`)

  const s = readSecret(i)
  const kept = { ...s.headers }
  s.headers = Object.fromEntries(names.flatMap((n) => {
    const v = secrets.headers?.[n] || kept[n]
    return v ? [[n, v]] : []
  }))
  if (cfg.oauth !== 'client') s.clientSecret = undefined
  else if (secrets.clientSecret) s.clientSecret = secrets.clientSecret
  const next: McpConfig = {
    transport: cfg.transport,
    url: cfg.transport === 'stdio' ? undefined : cfg.url!.trim(),
    command: cfg.transport === 'stdio' ? cfg.command!.trim() : undefined,
    args: cfg.transport === 'stdio' ? (cfg.args ?? []).filter(Boolean) : undefined,
    headers: cfg.transport === 'stdio' ? [] : names.map((n) => ({ name: n, set: n in s.headers })),
    oauth: cfg.transport === 'stdio' ? 'none' : cfg.oauth,
    clientId: cfg.oauth === 'client' ? cfg.clientId!.trim() : undefined,
    hasClientSecret: !!s.clientSecret
  }
  const same = sameEndpoint(i.mcp, next)
  if (!same) {
    // a different server or sign-in method: old tokens and registrations don't apply
    Object.assign(s, { tokens: undefined, client: undefined, verifier: undefined, state: undefined })
    i.status = 'disconnected'
  }
  i.mcp = { ...next, signedIn: !!s.tokens, ...(same ? { server: i.mcp!.server, testedAt: i.mcp!.testedAt } : {}) }
  writeSecret(i, s)
  commit('integrations')
  return publicIntegration(i)
}

/** Connect, sign in if the server needs it, and replace the tool list (keeping policies you already set). */
export async function connectMcp(id: string): Promise<Integration> {
  const i = find(id)
  // e.g. imported from Claude Code, where the value was a ${VAR} it fills from its own environment
  const empty = i.mcp!.transport === 'stdio' ? [] : (i.mcp!.headers ?? []).filter((h) => !h.set).map((h) => h.name)
  if (empty.length) throw new Error(`Enter a value for the ${empty.join(', ')} header${empty.length === 1 ? '' : 's'} first.`)
  let authUrl: URL | undefined
  const provider = i.mcp!.transport !== 'stdio' && i.mcp!.oauth !== 'none' ? new Provider(i, (u) => (authUrl = u)) : undefined
  const info = { name: 'Jarvis', version: app.getVersion() }
  let client = new Client(info)
  try {
    let transport = transportFor(i, provider)
    try {
      await client.connect(transport)
    } catch (e) {
      if (!(e instanceof UnauthorizedError) || !provider || !authUrl) throw e
      const wait = waitForCode(() => readSecret(i).state)
      try {
        await shell.openExternal(authUrl.href)
        const code = await wait.code
        await (transport as StreamableHTTPClientTransport | SSEClientTransport).finishAuth(code)
      } finally {
        wait.close()
      }
      await client.close().catch(() => undefined)
      client = new Client(info)
      transport = transportFor(i, provider)
      await client.connect(transport)
    }
    const found: { name: string; description?: string; annotations?: { title?: string; readOnlyHint?: boolean } }[] = []
    let cursor: string | undefined
    do {
      const r = await client.listTools(cursor ? { cursor } : undefined)
      found.push(...r.tools)
      cursor = r.nextCursor
    } while (cursor && found.length < 1000)
    const prev = new Map(i.tools.map((t) => [t.name, t.policy]))
    // new tools ask first, unless the server marks them read-only
    i.tools = found.map((t) => ({
      name: t.name,
      description: (t.description || t.annotations?.title || '').split('\n')[0].slice(0, 200),
      policy: prev.get(t.name) ?? ((t.annotations?.readOnlyHint ? 'allowed' : 'ask') as Policy)
    }))
    const v = client.getServerVersion()
    i.mcp = { ...i.mcp!, server: v ? { name: v.name, version: v.version } : undefined, testedAt: now(), error: undefined, signedIn: !!readSecret(i).tokens }
    i.status = 'connected'
    commit('integrations')
    return publicIntegration(i)
  } catch (e) {
    const msg = (e as Error).message || String(e)
    i.mcp = { ...i.mcp!, testedAt: now(), error: msg.slice(0, 400), signedIn: !!readSecret(i).tokens }
    i.status = 'error'
    commit('integrations')
    throw new Error(msg)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export function signOutMcp(id: string): Integration {
  const i = find(id)
  patch(i, { tokens: undefined, client: undefined, verifier: undefined, state: undefined })
  i.mcp = { ...i.mcp!, signedIn: false }
  i.status = 'disconnected'
  commit('integrations')
  return publicIntegration(i)
}
