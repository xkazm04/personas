# Lights-Out Room

## Philosophy
The fleet is a machine room that runs in the dark. Projects are chassis (the team colour is the cable down the edge), personas are modules with one lamp, live sessions are units mounted in a rack whose size is the cap. Light means only work in flight or something that needs your hand, and a lit row spills its colour across itself. An idle fleet is a dark, calm room.

One band of chrome, the console: agent lamps (also the filter), the rack gauge (stepper, one bay per seat, over-cap bays hatched past a warning line, queue ticks beyond), layout, Autopilot with its phrase, orchestration. The side wall is Supply (plans as meters; the tick is elapsed time, so pace is the gap) over Intake.

## How it stays readable at scale
- Every seated session wears a two-digit seat number, the same one its bay shows in the console and the Runway; queued work wears `Q<rank>`. Hovering a row lights its bay.
- The rack seats only what the door counts (`is_live_state`), so it reads 7/10 when the door does; stale and finished units stay on the board with a dash.
- Masonry chassis with share bars; virtualised inbox.
- Keys are printed where they apply: `1 2 3` layouts, `N/K` attention, `A/R/Enter/arrows` in the inbox, `Alt+arrows/S/Del` in the queue.
- The seat plate opens the recap: no button over a title.

## The wow moment
A dark floor, one amber chassis, seven lit bays in the console: you know where to look before reading a word.

## Known limits
- Node rows are raw buttons, like the baseline's. No drag-to-reorder or persona right-click menu.
- No new i18n keys; hints borrow existing strings.
- Remote sessions reuse `RemoteSessionTile`.
