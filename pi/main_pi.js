/* eslint-disable no-unused-vars, no-undef */
let websocket = null
let uuid = null
let actionUUID = null

// Toggl data is fetched (and cached) by the plugin process, see plugin/toggl_api.js
const pendingRequests = new Map()
let requestSeq = 0
let forceReload = false

function connectElgatoStreamDeckSocket (inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
  uuid = inPropertyInspectorUUID
  actionUUID = JSON.parse(inActionInfo).action

  // Open the web socket (use 127.0.0.1 vs localhost because windows is "slow" resolving 'localhost')
  websocket = new WebSocket('ws://127.0.0.1:' + inPort)

  websocket.onopen = function () {
    // WebSocket is connected, register the Property Inspector
    websocket.send(JSON.stringify({
      event: inRegisterEvent,
      uuid: inPropertyInspectorUUID
    }))

    // Request settings
    websocket.send(JSON.stringify({
      event: 'getSettings',
      context: uuid
    }))
  }

  websocket.onmessage = function (evt) {
    // Received message from Stream Deck
    const jsonObj = JSON.parse(evt.data)

    if (jsonObj.event === 'didReceiveSettings') {
      const payload = jsonObj.payload.settings

      if (payload.apiToken) document.getElementById('apitoken').value = payload.apiToken
      document.getElementById('apiFrequency').value = payload.apiFrequency ?? 600
      if (payload.label) document.getElementById('label').value = payload.label
      if (payload.activity) document.getElementById('activity').value = payload.activity
      document.getElementById('billable').value = payload.billableToggle ? 1 : 0
      document.getElementById('trackingmode').value = payload.trackingMode ?? (payload.fallbackToggle ? 2 : 0) // handle old fallback toggle for backwards compatibility
      
      document.querySelector('.hiddenAll').classList.remove('hiddenAll')

      loadAll(payload)
    } else if (jsonObj.event === 'sendToPropertyInspector') {
      const reply = jsonObj.payload
      updateUsage(reply.usage)
      const pending = pendingRequests.get(reply.requestId)
      if (!pending) return
      pendingRequests.delete(reply.requestId)
      clearTimeout(pending.timer)
      if (reply.ok) pending.resolve(reply)
      else pending.reject(new Error(reply.error))
    }
  }
}

// Fills all dropdowns for the given (saved or current) selection
async function loadAll (selection) {
  const apiToken = document.getElementById('apitoken').value
  if (!apiToken) return

  await updateWorkspaces(apiToken)
  if (!selection.workspaceId) return

  document.getElementById('workspaceError').classList.add('hiddenError')
  document.getElementById('wid').value = selection.workspaceId

  const projectsDone = updateProjects(apiToken, selection.workspaceId).then(async () => {
    if (!selection.projectId) return
    document.getElementById('pid').value = selection.projectId

    await updateTasks(apiToken, selection.workspaceId, selection.projectId)
    if (selection.taskId) document.getElementById('tid').value = selection.taskId
  })

  const tagsDone = updateTags(apiToken, selection.workspaceId).then(() => {
    if (selection.tagIds && selection.tagIds.length > 0) {
      document.querySelectorAll('#tagList input[type="checkbox"]').forEach(cb => {
        cb.checked = selection.tagIds.includes(Number(cb.value))
      })
      updateTagPreview()
    }
  })

  await Promise.all([projectsDone, tagsDone])
}

function requestFromPlugin (kind, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestSeq
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('The plugin did not respond (is it running?)'))
    }, 60000)
    pendingRequests.set(requestId, { resolve, reject, timer })
    websocket.send(JSON.stringify({
      event: 'sendToPlugin',
      action: actionUUID,
      context: uuid,
      payload: { requestId, kind, force: forceReload, ...params }
    }))
  })
}

function updateUsage (usage) {
  if (!usage) return
  let text = `${usage.used}/${usage.limit} requests in the last hour`
  if (usage.blockedUntil > Date.now()) {
    text += ` - paused until ${new Date(usage.blockedUntil).toLocaleTimeString()}`
  }
  document.getElementById('apiUsage').textContent = text
}

// Discards cached lists and reloads them from Toggl (costs about 5 API requests)
function reloadFromToggl () {
  const apiToken = document.getElementById('apitoken').value
  if (!apiToken) return
  forceReload = true
  loadAll({
    workspaceId: document.getElementById('wid').value,
    projectId: document.getElementById('pid').value,
    taskId: document.getElementById('tid').value,
    tagIds: Array.from(document.querySelectorAll('#tagList input:checked')).map(cb => Number(cb.value))
  }).finally(() => { forceReload = false })
}

function sendSettings () {
  websocket && (websocket.readyState === 1) &&
  websocket.send(JSON.stringify({
    event: 'setSettings',
    context: uuid,
    payload: {
      apiToken: document.getElementById('apitoken').value,
      apiFrequency: document.getElementById('apiFrequency').value,
      label: document.getElementById('label').value,
      activity: document.getElementById('activity').value,
      workspaceId: document.getElementById('wid').value,
      projectId: document.getElementById('pid').value,
      taskId: document.getElementById('tid').value,
      tagIds: Array.from(document.querySelectorAll('#tagList input:checked')).map(cb => Number(cb.value)),
      billableToggle: document.getElementById('billable').value == 1 ?  true : false,
      trackingMode: document.getElementById('trackingmode').value
    }
  }))
}

function setAPIToken () {
  document.getElementById('wid').innerHTML = ''
  document.getElementById('pid').innerHTML = ''
  updateWorkspaces(document.getElementById('apitoken').value)
  sendSettings()
}

function setWorkspace () {
  document.getElementById('workspaceError').classList.add('hiddenError')
  updateProjects(document.getElementById('apitoken').value, document.getElementById('wid').value)
  updateTags(document.getElementById('apitoken').value, document.getElementById('wid').value)
  sendSettings()
}

function setProject () {
  updateTasks(document.getElementById('apitoken').value, document.getElementById('wid').value, document.getElementById('pid').value)
  sendSettings()
}

async function updateTasks (apiToken, workspaceId, projectId) {
  try {
    await getTasks(apiToken, workspaceId, projectId).then(tasksData => {
      document.getElementById('tid').innerHTML = '<option value="0"></option>'
      document.getElementById('taskWrapper').classList.toggle('hidden', !tasksData || tasksData.length === 0)
      const selectEl = document.getElementById('tid')

      if (tasksData != null) tasksData.sort((a, b) => { return (a.active === b.active) ? 0 : a.active ? -1 : 1; });

      for (taskNum in tasksData) {
        const optionEl = document.createElement('option')
        optionEl.innerText = tasksData[taskNum].name + (tasksData[taskNum].active ? `` : ` (Done)`)
        optionEl.value = tasksData[taskNum].id.toString()
        selectEl.append(optionEl)
      }
    })
  } catch (e) {
    document.getElementById('taskWrapper').classList.add('hidden')
    log("Error in updateTasks: " + (e instanceof Error ? e.message : typeof e === "string" ? e : String(e)))
  }
}

async function updateProjects (apiToken, workspaceId) {
  try {
    await getProjects(apiToken, workspaceId).then(projectsData => {
      document.getElementById('pid').innerHTML = '<option value="0"></option>'
      document.getElementById('workspaceError').classList.add('hiddenError')
      document.getElementById('projectWrapper').classList.remove('hidden')
      document.getElementById('billableWrapper').classList.remove('hidden')
      document.getElementById('trackingModeWrapper').classList.remove('hidden')
      const selectEl = document.getElementById('pid')

      if (projectsData != null) projectsData.sort((a, b) => { return (a.active === b.active) ? 0 : a.active ? -1 : 1; });

      for (projectNum in projectsData) {
        const optionEl = document.createElement('option')
        optionEl.innerText = projectsData[projectNum].name + (projectsData[projectNum].active ? `` : ` (Archived)`)
        optionEl.value = projectsData[projectNum].id.toString()
        selectEl.append(optionEl)
      }
    })
  } catch (e) {
    document.getElementById('taskWrapper').classList.add('hidden')
    document.getElementById('projectWrapper').classList.add('hidden')
    document.getElementById('billableWrapper').classList.add('hidden')
    document.getElementById('trackingModeWrapper').classList.add('hidden')
    log("Error in updateProjects: " + (e instanceof Error ? e.message : typeof e === "string" ? e : String(e)))
  }
}

async function updateTags (apiToken, workspaceId) {
  try {
    await getTags(apiToken, workspaceId).then(tagsData => {
      const listEl = document.getElementById('tagList')
      listEl.innerHTML = ''
      if (tagsData.length > 0) {
        tagsData.sort((a, b) => a.name.localeCompare(b.name))
        for (const tag of tagsData) {
          const label = document.createElement('label')
          label.className = 'tag-item'
          const cb = document.createElement('input')
          cb.type = 'checkbox'
          cb.value = tag.id.toString()
          cb.dataset.name = tag.name
          cb.onchange = () => { updateTagPreview(); sendSettings() }
          label.appendChild(cb)
          label.appendChild(document.createTextNode(tag.name))
          listEl.appendChild(label)
        }
        document.getElementById('tagWrapper').classList.remove('hidden')
      } else {
        document.getElementById('tagWrapper').classList.add('hidden')
      }
      updateTagPreview()
    })
  } catch (e) {
    document.getElementById('tagWrapper').classList.add('hidden')
    log("Error in updateTags: " + (e instanceof Error ? e.message : typeof e === "string" ? e : String(e)))
  }
}

function toggleTagDropdown () {
  const panel = document.getElementById('tagPanel')
  const isOpen = !panel.classList.contains('hidden')
  panel.classList.toggle('hidden', isOpen)
  if (!isOpen) document.getElementById('tagSearch').focus()
}

function filterTags () {
  const query = document.getElementById('tagSearch').value.toLowerCase()
  document.querySelectorAll('#tagList .tag-item').forEach(item => {
    const name = item.querySelector('input').dataset.name.toLowerCase()
    item.style.display = name.includes(query) ? '' : 'none'
  })
}

function updateTagPreview () {
  const names = Array.from(document.querySelectorAll('#tagList input:checked')).map(cb => cb.dataset.name)
  document.getElementById('tagPreview').textContent = names.join(', ')
}

document.addEventListener('click', function (e) {
  const dropdown = document.getElementById('tagDropdown')
  if (dropdown && !dropdown.contains(e.target)) {
    document.getElementById('tagPanel')?.classList.add('hidden')
  }
})

async function updateWorkspaces (apiToken) {
  try {
    await getWorkspaces(apiToken).then(workspaceData => {
      document.getElementById('wid').innerHTML = '<option value="0"></option>'
      document.getElementById('errorMessage').innerHTML = ""
      document.getElementById('error').classList.add('hiddenError')
      document.getElementById('workspaceWrapper').classList.remove('hidden')
      document.getElementById('labelWrapper').classList.remove('hidden')
      document.getElementById('activityWrapper').classList.remove('hidden')
      document.getElementById('workspaceError').classList.remove('hiddenError')
      const selectEl = document.getElementById('wid')

      for (ws in workspaceData) {
        const optionEl = document.createElement('option')
        optionEl.innerText = workspaceData[ws].name
        optionEl.value = workspaceData[ws].id.toString()
        selectEl.append(optionEl)
      }
    })
  } catch (e) {
    document.getElementById('errorMessage').innerHTML = (e instanceof Error ? e.message : typeof e === "string" ? e : String(e))
    document.getElementById('error').classList.remove('hiddenError')
    document.getElementById('workspaceWrapper').classList.add('hidden')
    document.getElementById('labelWrapper').classList.add('hidden')
    document.getElementById('activityWrapper').classList.add('hidden')
    document.getElementById('projectWrapper').classList.add('hidden')
    document.getElementById('taskWrapper').classList.add('hidden')
    document.getElementById('tagWrapper').classList.add('hidden')
    document.getElementById('workspaceError').classList.add('hiddenError')
    log("Error in updateWorkspaces: " + (e instanceof Error ? e.message : typeof e === "string" ? e : String(e)))
  }
}

function openPage (site) {
  websocket && (websocket.readyState === 1) &&
  websocket.send(JSON.stringify({
    event: 'openUrl',
    payload: {
      url: 'https://' + site
    }
  }))
}

async function getTags(apiToken, workspaceId) {
  return (await requestFromPlugin('tags', { apiToken, workspaceId })).data
}

async function getTasks(apiToken, workspaceId, projectId) {
  return (await requestFromPlugin('tasks', { apiToken, workspaceId, projectId })).data
}

async function getProjects(apiToken, workspaceId) {
  return (await requestFromPlugin('projects', { apiToken, workspaceId })).data
}

async function getWorkspaces(apiToken) {
  return (await requestFromPlugin('workspaces', { apiToken })).data
}

function log(message) {
  websocket.send(JSON.stringify({
    event: "logMessage",
    payload: { message }
  }));
}
