# Travel log

Your trips on a world map, with statistics: which countries you've been to, which airports you used, how your
country count grew, and what planned trips would add. How to enter trips is explained in the
[README](https://github.com/kjell5317/travel-log#how-it-works).

## Opening it

The app runs on port **8099** of your Home Assistant host: click **Open web UI** on this page, or go to
`http://<your Home Assistant address>:8099/`. To use another port, or none, change it under **Network** on the
*Configuration* tab.

**There is no login.** Everyone who can reach the port can see and change your trips, so only make it reachable
for people you trust.

### Behind a reverse proxy

Point your reverse proxy at `http://<your Home Assistant address>:8099`. The app works on its own host name
(`https://travel.example.com/`) as well as under a path (`https://example.com/travel/`, with the trailing slash;
the proxy must remove `/travel` before passing requests on).

Before you make it reachable from the internet, put a login in front of it in the proxy (for example basic
authentication or an identity provider such as Authelia). If the proxy runs on another machine, you can also close
the port to everyone else with your firewall.

## Your data

The app saves your travel log as `travel.json` in its config folder, together with the previous version as
`travel.backup.json`. With the Samba share, the File editor or the terminal you find it under `app_configs`
(`addon_configs` on older systems), in the folder ending in `_travel_log`.

- **Bringing your trips along:** copy your existing `travel.json` into that folder and reload the page. Or paste
  your trips into the editor's *Text* mode.
- **Editing by hand:** fine while the page isn't open; the app reads the file each time it loads.
- **Backups:** the folder is part of Home Assistant backups of this app.

The app makes no network requests: the map, airports and cities are part of it.

## Updates

Home Assistant offers an update when a new version is published in the repository, and rebuilds the app on your
device when you install it.
