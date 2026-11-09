# Timelines in notes

An `ob` code block shows part of a native Ouroboros timeline inside a note: a strip of its eras and events, and a list of the first ten events.

````markdown
```ob
timeline: Chronicle of Veld
era: Reign of Ash
```
````

## Options

Put each option on its own line, as `name: value`. Every option is optional.

| Option | Meaning |
|---|---|
| `timeline` | Which timeline to show: its file name, with or without `.ob` (or `.evra` in compatibility mode), or a link like `[[Chronicle of Veld.ob]]`. Without it, Ouroboros uses a timeline in the same folder as the note, or else the first one in the vault. |
| `era` | Show just this era, by name. |
| `from`, `to` | Show from one year to another, as numbered in the timeline's calendar. For example, `from: 30` and `to: 50`. |
| `tag` | Show only cards with this tag. For example, `tag: war`. |

Click an event in the list to open the timeline at that card.

The embed redraws when the timeline changes.

In a timeline, **Copy an embed for this view** (in **Settings → Timeline → Export**, or the command palette) copies a ready-made block for the stretch of time on screen.

When Evra compatibility is enabled, legacy `evra` and `throughline` code blocks also work.
