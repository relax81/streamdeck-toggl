/* eslint-disable no-unused-vars, no-undef */
// Central Toggl API layer of the plugin process.
//
// - Every request to Toggl goes through togglFetch(), which counts it (persisted for one hour) and
//   writes it to the Stream Deck log, so the usage can be inspected.
// - Lists for the Property Inspector (workspaces, projects, tasks, tags) are cached here with a long TTL,
//   so opening or switching buttons in the Stream Deck app costs no API requests.
// - On HTTP 429 further non-essential requests are paused until the Retry-After time has passed.

const API_LIMIT = 30 // requests per hour on the free Toggl plan
const LISTING_CUTOFF = 24 // non-essential requests (lists, polling) stop here, so start/stop still work
const ONE_HOUR = 60 * 60 * 1000
const CACHE_TTL = 24 * ONE_HOUR
const DEFAULT_RETRY_AFTER = 15 * 60 * 1000
const PROJECTS_PER_PAGE = 200

const LS_REQUEST_LOG = 'togglRequestLog'
const LS_BLOCKED_UNTIL = 'togglBlockedUntil'
const LS_CACHE_PREFIX = 'togglCache:'

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (_) { /* storage full or unavailable, caching is best effort */ }
}

// ---- Request accounting ------------------------------------------------

function recentRequests() {
  const cutoff = Date.now() - ONE_HOUR
  const entries = lsGet(LS_REQUEST_LOG)
  return Array.isArray(entries) ? entries.filter(ts => ts > cutoff) : []
}

function recordRequest(label) {
  const entries = recentRequests()
  entries.push(Date.now())
  lsSet(LS_REQUEST_LOG, entries)
  log(`[API] request ${entries.length}/${API_LIMIT} in last hour: ${label}`)
}

function apiUsage() {
  return {
    used: recentRequests().length,
    limit: API_LIMIT,
    blockedUntil: lsGet(LS_BLOCKED_UNTIL) || 0
  }
}

async function togglFetch(apiToken, path, { method = 'GET', body, essential = false, label = path } = {}) {
  const usage = apiUsage()
  if (!essential) {
    if (usage.blockedUntil > Date.now()) {
      throw new Error(`Toggl rate limit active, paused until ${new Date(usage.blockedUntil).toLocaleTimeString()}`)
    }
    if (usage.used >= LISTING_CUTOFF) {
      throw new Error(`API budget nearly used up (${usage.used}/${API_LIMIT} requests in the last hour)`)
    }
  }

  recordRequest(`${method} ${label}`)
  const headers = { Authorization: `Basic ${btoa(`${apiToken}:api_token`)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${togglBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'))
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_AFTER
    lsSet(LS_BLOCKED_UNTIL, Date.now() + waitMs)
    log(`[API] 429 from Toggl, pausing non-essential requests for ${Math.round(waitMs / 1000)}s`)
  }
  if (!response.ok) throw new Error(`Toggl API Error: ${await response.text()} (${response.status})`)
  return response
}

// ---- List cache for the Property Inspector -------------------------------

function cacheKey(apiToken, kind, ...ids) {
  return `${LS_CACHE_PREFIX}${kind}:${apiToken.slice(-8)}:${ids.join(':')}`
}

async function cachedList(key, force, fetcher) {
  const cached = lsGet(key)
  if (cached && !force && (Date.now() - cached.ts) <= CACHE_TTL) {
    return { data: cached.data, ts: cached.ts, cached: true }
  }
  try {
    const data = await fetcher()
    const ts = Date.now()
    lsSet(key, { ts, data })
    return { data, ts, cached: false }
  } catch (e) {
    // Rather show outdated data than nothing
    if (cached) return { data: cached.data, ts: cached.ts, cached: true, stale: true, error: e.message }
    throw e
  }
}

async function fetchJsonArray(apiToken, path, label) {
  const response = await togglFetch(apiToken, path, { label })
  const json = await response.json()
  return Array.isArray(json) ? json : []
}

async function fetchProjects(apiToken, workspaceId) {
  let data = []
  for (let page = 1; page <= 100; page++) {
    const chunk = await fetchJsonArray(
      apiToken,
      `/workspaces/${workspaceId}/projects?page=${page}&per_page=${PROJECTS_PER_PAGE}`,
      `projects page ${page}`
    )
    data = data.concat(chunk)
    if (chunk.length < PROJECTS_PER_PAGE) break // last page, no need to ask for an empty one
  }
  return data
}

function listForKind(kind, apiToken, { workspaceId, projectId }, force) {
  switch (kind) {
    case 'workspaces':
      return cachedList(cacheKey(apiToken, kind), force, () => fetchJsonArray(apiToken, '/me/workspaces', 'workspaces'))
    case 'projects':
      return cachedList(cacheKey(apiToken, kind, workspaceId), force, () => fetchProjects(apiToken, workspaceId))
    case 'tasks':
      return cachedList(cacheKey(apiToken, kind, workspaceId, projectId), force, () =>
        fetchJsonArray(apiToken, `/workspaces/${workspaceId}/projects/${projectId}/tasks`, 'tasks'))
    case 'tags':
      return cachedList(cacheKey(apiToken, kind, workspaceId), force, () =>
        fetchJsonArray(apiToken, `/workspaces/${workspaceId}/tags`, 'tags'))
    default:
      return Promise.reject(new Error(`Unknown data kind: ${kind}`))
  }
}

function clearListCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(LS_CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k))
  } catch (_) { /* ignore */ }
}

// ---- Property Inspector messages -----------------------------------------

async function handlePropertyInspectorMessage(action, context, payload) {
  const { requestId, kind, apiToken, force } = payload
  const reply = result => websocket.send(JSON.stringify({
    event: 'sendToPropertyInspector',
    action,
    context,
    payload: { requestId, kind, usage: apiUsage(), ...result }
  }))

  try {
    if (kind === 'clearCache') {
      clearListCache()
      reply({ ok: true })
    } else if (kind === 'usage') {
      reply({ ok: true })
    } else {
      const result = await listForKind(kind, apiToken, payload, !!force)
      reply({ ok: true, ...result })
    }
  } catch (e) {
    log(`[API] Property Inspector request '${kind}' failed: ${e.message}`)
    reply({ ok: false, error: e.message })
  }
}
