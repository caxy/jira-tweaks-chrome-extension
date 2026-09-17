# Jira Tweaks

Chrome extension that makes the **Due date** field editable on Jira board issue panels
(Active Sprints / backlog side panel) where Jira renders it read-only.

It saves through Jira's own REST API (`PUT /rest/api/2/issue/{key}`) from the page itself,
so your existing login session is used. No tokens, no extra permissions.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Reload your Jira board tab.

## Use

Open an issue in the board panel. Hover the Due date value, click it, pick a date,
then **Save** (or press Enter). **Clear** removes the due date. **Cancel** / Esc backs out.

## Self-hosted Jira

The manifest only targets `*.atlassian.net` and `*.jira.com`. For Jira Server / Data Center,
add your host to `content_scripts[0].matches` in `manifest.json`, e.g. `"https://jira.example.com/*"`,
then reload the extension.

## Debugging

In the page console run `localStorage.jiraTweaksDebug = '1'` and reload. The script logs which
elements it enhances or skips. `test/mock.html` is a stand-alone page with a fake REST API for
trying the UI without a real Jira.

## Caveat

If Jira refuses the update with "Field 'duedate' cannot be set. It is not on the appropriate screen",
the field is missing from the project's **Edit** screen. That is a project configuration issue
the REST API also enforces; a Jira admin has to add Due date to the edit screen.
