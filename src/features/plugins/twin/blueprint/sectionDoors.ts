/**
 * Which door of the Twin experience edits which blueprint section (spark
 * twin-portable-blueprint). The Detail page's "Edit in setup" and a section
 * pressed on the training overlay's blueprint both open the experience on it:
 * Identity is the sheet, Voice the style studio, Knowledge the fields editor
 * (memories are reviewed in the Hub, the rest is typed there), Training the
 * plan behind the questions.
 */
import type { ExperienceDoor } from '../experience/table/TableChrome';
import type { SectionId } from './blueprintContract';

export const SECTION_DOOR: Readonly<Record<SectionId, ExperienceDoor>> = {
  identity: 'sheet',
  voice: 'studio',
  knowledge: 'fields',
  training: 'plan',
};
