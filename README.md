# Toggl Track for Stream Deck: API-friendly fork

> **Fork of [blueshiftone/streamdeck-toggl](https://github.com/blueshiftone/streamdeck-toggl)**, built for the Toggl **free plan** (30 API requests per hour). Cached lists, an API usage display and rate limit handling keep the plugin from using up your quota.
> Drop-in replacement for the original (same plugin ID), so your buttons and settings are kept. Only one of the two versions can be installed at a time.
>
> **[⬇ Download the latest release](https://github.com/relax81/streamdeck-toggl/releases)**

Hassle-free time tracking using [Elgato Stream Deck](https://www.elgato.com/en/gaming/stream-deck) and [Toggl Track](https://toggl.com/track/).

## 🔀 About this fork

[blueshiftone/streamdeck-toggl](https://github.com/blueshiftone/streamdeck-toggl) continues the discontinued and archived [tobimori/streamdeck-toggl](https://github.com/tobimori/streamdeck-toggl). Note that the Toggl plugin in the Stream Deck marketplace is the old plugin that is no longer maintained.

This fork keeps Toggl API usage low. The free Toggl plan only allows **30 API requests per hour**, and the original plugin could use that up just by setting up a few buttons. Changes in this fork:

* **Cached lists.** Workspaces, projects and tags are loaded once and cached for 24 hours by the plugin. Opening or switching buttons in the Stream Deck app no longer calls the Toggl API. Use the *Reload projects/tags from Toggl* link in the Property Inspector to refresh them.
* **Tasks on the free plan.** Tasks are a paid Toggl feature. The plugin remembers that the free plan has none instead of asking again for every button, and hides the Task field.
* **API Usage display.** The Property Inspector shows how many requests were used in the last hour. Every request is also written to the Stream Deck log (`[API] request n/30 ...`).
* **Rate limit handling.** When Toggl reports the hourly limit, all requests pause until the quota resets. Requests that Toggl rejects are no longer repeated every second, and polling for the running timer keeps priority over loading lists.
* **Display.** Multi-line button labels, the timer sits directly above the label, and elapsed times from one hour on are shown as `hh:mm`.

This fork uses the same plugin ID as the original, so it replaces an installed original and keeps your existing buttons and settings. Only one of them can be installed at a time.

## ✏️ Setup

Download the latest .streamDeckPlugin file from [Releases](https://github.com/relax81/streamdeck-toggl/releases) and double click to install into the Stream Deck app. Once installed, a button called "Toggl" will become available in section "Custom".

![PropertyInspector](resources/readme/PropertyInspector.png)

* **Title** is a default Stream Deck property available for every button in Stream Deck. You should leave it empty (see Button Label).
* **API Token** is your private API Token you can get from your [Toggl profile](https://track.toggl.com/profile). This Token is handled like a password. ***Don't share it***. Required.
* **API Frequency** is the frequency with which the plugin will call the Toggl API. Start and Stop actions always require API calls, as does loading the list of workspaces, projects and tasks, so this just changes the interval for checking for the currently running time entry and updating button active highlighting. Every check is one API request per API token, no matter how many buttons use it. With the free Toggl plan (30 requests per hour) keep it at 10 minutes or more. Required.
* **API Usage** shows the API requests used in the last hour and, if Toggl's limit was hit, when requests resume.
* **Button Label** is used instead of *Title*. If the tracker isn't running, the Label is shown on the button. If the tracker is running the elapsed time is shown additionally. The label can have several lines (press Enter). If *Title* is set, it will override *Button Label*.
* **Entry Name** describes the activity you want to report. It is not required but strongly recommended.
* **Workspace** is your workspace you start the time entries in. Required.
* **Project** is the project you want to assign the time entry to. Leave blank for no project. New projects can be added in Toggl.
* **Task** is the task you want to assign the time entry to. Leave blank for no task. New tasks can be added in Toggl. Only shown if your Toggl plan supports tasks (paid plans).
* **Billable** sets Toggl's billable flag (for Toggl paid plans only).
* **Tracking Mode** controls how buttons are determined to be active. Exact Match designates that the button should be active only if the current time entry has an exact match on Description, Project and Task. Match Ignoring Description designates that the button should be active if the current time entry has a match on Project and Task. Fallback designates this button as a fallback button - starting a defined activity as normal (e.g. "TBD"), but showing as active when the current time entry does not match any other button.

![StreamDeckScreenshot](resources/readme/StreamDeckScreenshot.png)

Just press any Toggl Button to start tracking time. The button should indicate tracking by turning red and showing the current tracking time (if no *Title* is set). The status of the button is defined by workspace, project and entry name. If you setup two identical buttons (even on different Stream Deck profiles), both button indicate the same. If you start or stop your timer using the Toggl app (web, desktop, mobile) Toggl for Stream Deck will follow by changing the status.

## 📞 Help

Please use GitHub Issues for reporting bugs and requesting new features.

## 📄 License

streamdeck-toggl is licensed under the [MIT License](LICENSE).

## Build & Debug Instructions

Prerequisites:
* Ensure your root folder as one.blueshift.streamdeck.toggl.sdPlugin
* Install the [Elgato CLI](https://www.npmjs.com/package/@elgato/cli)
* Enable developer mode with `streamdeck dev`

To debug locally:
```
cd [path]\one.blueshift.streamdeck.toggl.sdPlugin
streamdeck link
streamdeck restart one.blueshift.streamdeck.toggl
```

To build a .streamDeckPlugin installer:
```
cd [path]\one.blueshift.streamdeck.toggl.sdPlugin
streamdeck pack --version [new version] --output [output directory] --force
```
