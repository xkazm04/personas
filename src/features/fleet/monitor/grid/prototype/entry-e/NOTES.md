# Annunciator

## Philosophy

The Activity tab is one control-room panel, modelled on an industrial annunciator: a lamp lights only when its thing is working or needs you. Idle agents are dark glass that still reads at body size. Running agents glow in the theme colour, agents waiting on you amber, failures red. One grammar (plate, window, lamp) runs through the census, cap, usage, bays, agents, sessions, queue and inbox.

Three columns under one band of chrome:

- **Supply** (left): the cap as a socket rack, Autopilot with its verdict in words, usage as fuel strips.
- **Board** (middle): Classic bays, the Runway rack, or three Lanes.
- **Desk** (right): everything waiting on a human.

## How it stays readable at scale

- A bay's nameplate lights with the worst state inside it, so the bays that need you show before any name is read.
- Pending work is written out in words, not glyph chips.
- The inbox is the virtualised `RailList` with 96px rows: two title lines, verdicts on the focused row (keys A and R).
- Rank is a large numeral, wait is a bar with a not-before fence, age is a six-rung log ladder, and free capacity is empty wells.

## The wow moment

The panel opens dark, and the few lit lamps are the to-do list. Usage shows the light that is *left*: a plan running out goes dark, and the auto-rotate threshold is a notch on the live plan's 5-hour strip.

## Known limits

- No right-click menus or drag-to-reorder.
- The Runway rack treats running, spawning, awaiting input and idle as holding a slot, which matches today's door count.
- `isParked` is copied locally because the original is private.
