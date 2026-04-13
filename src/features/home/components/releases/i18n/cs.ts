export const cs = {
  whatsNew: {
    title: 'Novinky',
    subtitle: {
      roadmap: 'Co stavíme teď a co přijde dál.',
      changelog: 'Co je nového ve vaší verzi Personas.',
    },
    navBar: {
      roadmapLabel: 'Plán',
    },
    status: {
      released: 'Vydáno',
      active: 'Aktuální',
      planned: 'Plánováno',
      roadmap: 'Plán',
    },
    type: {
      feature: 'Nové',
      fix: 'Opraveno',
      security: 'Bezpečnost',
      docs: 'Dokumentace',
      chore: 'Údržba',
      breaking: 'Zásadní změna',
    },
    itemStatus: {
      in_progress: 'Probíhá',
      planned: 'Plánováno',
      completed: 'Hotovo',
    },
    priority: {
      now: 'Nyní',
      next: 'Další',
      later: 'Později',
    },
    summary: {
      inProgress: '{count} probíhá',
      next: '{count} v plánu',
    },
    empty: 'Pro tuto verzi zatím není co sdílet — vraťte se brzy.',
    releases: {
      '0.0.1': {
        label: 'Alpha 1',
        summary: 'První náhled Personas.',
        items: {
          '1': {
            title: 'První veřejný náhled',
            description:
              'Navrhujte AI agenty, spouštějte je podle plánu nebo události a sledujte jejich práci živě na své ploše.',
          },
        },
      },
      '0.0.2': {
        label: 'Alpha 2',
        summary: 'Propojte Personas s dalšími AI nástroji a čtěte novinky přímo v aplikaci.',
        items: {
          '1': {
            title: 'Otevřete své agenty dalším AI nástrojům',
            description:
              'Personas teď umí komunikovat s ostatními AI nástroji prostřednictvím sdíleného protokolu. Vyberte přesně, které agenty chcete sdílet, a chraňte je přístupovými klíči, které máte pod kontrolou — vaši soukromí agenti zůstávají ve výchozím stavu soukromí.',
          },
          '2': {
            title: 'Bezpečnější přístup pro desktopovou aplikaci',
            description:
              'Desktopová aplikace si při každém spuštění vytváří vlastní krátkodobý přístupový klíč, takže může komunikovat se svými službami v pozadí, aniž by odhalila cokoliv, co jste neschválili.',
          },
          '3': {
            title: 'Poznámky k vydání přímo v aplikaci',
            description:
              'Sledujte novinky v každém vydání Personas, aniž byste opustili aplikaci. Přepínejte mezi minulými verzemi, aktuálním vydáním a dlouhodobým plánem z jednoho místa.',
          },
          '4': {
            title: 'Vaši agenti se učí z každé relace',
            description:
              'Personas nyní zachycuje poznatky z každé relace agenta, destiluje je do znovupoužitelných znalostí a přenáší je do dalšího běhu. Vaši agenti jsou tím chytřejší, čím déle je používáte — bez nutnosti je sami trénovat.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-12
          '5': {
            title: 'Turn any document into a listenable briefing',
            description:
              'A new template that turns research reports, meeting transcripts, or long articles into a 5- to 15-minute two-host audio conversation you can listen to on the go. You pick the style — casual, formal, news, or executive — and review the script before the voices are generated.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-12
          '6': {
            title: 'A Stanford-trained editor for your writing',
            description:
              'A new template that reviews your drafts using the Stanford "Writing in the Sciences" method. It flags passive voice, dead-weight phrases, and jargon — and explains exactly why every suggested change makes the sentence clearer. It learns your voice from the edits you accept or reject.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '7': {
            title: 'Turn 20 hours of YouTube production into 3',
            description:
              'A new template compresses a full YouTube video cycle down to about three hours by handling everything except filming. It checks your niche is worth pursuing, drafts a hook-first script in your voice, and auto-removes retakes from raw footage using the approved script as ground truth — so you can film naturally, stumble freely, and keep going.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '8': {
            title: 'Run Apify scrapers from your agents',
            description:
              'Connect any actor from the Apify platform — YouTube scrapers, Twitter scrapers, browser automation, and hundreds of others — directly to your agents. Unlocks research workflows that need data the official APIs cannot reach.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '9': {
            title: 'X (Twitter) is now a connector',
            description:
              'Search recent tweets, track trending topics, and post directly from your agents. Useful for content research, social listening, and marketing automation without leaving Personas.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '10': {
            title: 'Watch YouTube from your agents',
            description:
              'The first video platform connector in Personas. Search videos, fetch channel statistics, pull trending content, and analyze competitors directly from any agent that needs to understand what is happening on YouTube.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '11': {
            title: 'Turn audio into text with Deepgram',
            description:
              'A new speech-to-text connector that transcribes audio files or URLs with word-level timing. Powers the YouTube creator assistant for auto-editing, and gives any agent the ability to process voice notes, meeting recordings, or podcast content.',
          },
          // TODO(i18n-cs): untranslated — English source-of-truth added 2026-04-13
          '12': {
            title: 'Other AI tools can check on and stop your agents',
            description:
              "When another AI tool calls one of your shared agents, it can now ask 'is this still running?' and 'please stop now' in mid-flight. Long research jobs no longer have to keep the connection open the whole time, and stuck runs can be cancelled cleanly from the calling side. Each agent only ever sees its own runs, so nothing leaks across agents.",
          },
        },
      },
      roadmap: {
        label: 'Plán',
        summary: 'Co stavíme teď a co přijde dál.',
        items: {
          '2': {
            title: 'Cloudová integrace',
            description:
              'Spouštějte své agenty 24/7 v cloudu a streamujte jejich práci v reálném čase zpět na svůj desktop.',
          },
          '3': {
            title: 'Webová aplikace',
            description:
              'Webový společník pro účty, fakturaci a správu agentů z libovolného prohlížeče.',
          },
          '4': {
            title: 'Používejte Personas ve svém jazyce',
            description:
              'Plná podpora více jazyků, včetně rozložení zprava doleva a fontů specifických pro jednotlivé jazyky.',
          },
          '6': {
            title: 'Týmové pracovní prostory',
            description:
              'Stavte agenty společně s týmem — sdílené prostory, oprávnění pro role a živé dashboardy.',
          },
        },
      },
    },
  },
};
