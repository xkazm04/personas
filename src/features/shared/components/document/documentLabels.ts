import type { DocumentAuthor } from './documentModel';

/**
 * Every word `DocumentSurface` puts on screen, supplied by the caller.
 *
 * The surface is a primitive and does not own vocabulary: a manifest calls its
 * authors "your hand" and "the agent's", a contract would call them something
 * else, and a primitive that hardcoded either would be wrong in the other
 * place. The feature holds the `t.<section>.<key>` lookups and hands the
 * finished strings down, which also keeps the i18n key that a translator sees
 * next to the feature it belongs to.
 */
export interface DocumentSurfaceLabels {
  /** Accessible name for the navigation rail. */
  railLabel: string;
  /** The rail's caption — "The document" / "to scale". */
  railCaption: { title: string; aside?: string };
  /** Accessible name for the chapter switcher. */
  tabsLabel: string;
  /** The author's one-word mark: seal, closed row, rail band. CSS uppercases it. */
  mark: (author: DocumentAuthor) => string;
  /** The quieter half of the seal, e.g. "your hand · saves whole". */
  sealQuiet: (author: DocumentAuthor, canWrite: boolean) => string;
  /** One sentence under the title saying who wrote this and what you may do. */
  lede: (author: DocumentAuthor) => string;
  /** Accessible verb on a clickable row in a writable section. */
  writeHere: string;
  /** Shown when a row in a read-only section is clicked. */
  readOnlyNote: string;
  /** Shown when a section has an unsaved draft and is not being written in. */
  draftKept: string;
  /** The word a closed row carries when its section holds an unsaved draft. */
  draftMark: string;
  /** Shown in place of prose when a section is empty. */
  empty: string;
  /** "<n> lines" — the caller formats the number. */
  lines: (count: number) => string;
  /** "<n> waiting" — the caller formats the number. */
  waiting: (count: number) => string;
  /** The editor's own words, built per section so the field can be named. */
  editor: (heading: string) => { field: string; hint: string; save: string };
}
