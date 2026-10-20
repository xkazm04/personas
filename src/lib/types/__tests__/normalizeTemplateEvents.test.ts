import { describe, it, expect } from 'vitest';
import { normalizeTemplateEvents } from '../types';

describe('normalizeTemplateEvents', () => {
  it('maps the legacy {eventType,label} seed shape onto {id,name,description}', () => {
    const [e] = normalizeTemplateEvents([{ eventType: 'message_received', label: 'Message Received' }]);
    expect(e).toMatchObject({ id: 'message_received', name: 'Message Received', description: '' });
  });
  it('keeps canonical events and drops unidentifiable ones', () => {
    const out = normalizeTemplateEvents([{ id: 'a', name: 'A', description: 'd' }, {}, null, 'x']);
    expect(out).toEqual([{ id: 'a', name: 'A', description: 'd' }]);
  });
});
