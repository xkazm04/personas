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
