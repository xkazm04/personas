// Synthetic tapes for the integrated Twin Detail page and the training overlay
// (spark twin-portable-blueprint, WP6; twinDetailSurfaces.tsx). One twin with a
// real spread of data: four voiced channels and one bound but unvoiced, an
// approved / pending / rejected memory mix, self-facts and one contact fact (the
// Knowledge count must leave it out), tagged training answers, and a plan with
// setup and training goals. Every row is built from the TS bindings' shapes.
//
//   twin/detail   the Detail page: `twin_setup_get` answers with a ready plan
//                 and a live question (a pure read; nothing opens a session).
//   twin/stage-dealt  the overlay with that live question dealt over the blueprint.
//   twin/stage    the overlay on the training stage: `twin_setup_open` deals the
//                 live question; `twin_setup_answer` and `twin_setup_get` answer
//                 with the snapshot after it (the answer scored, no question
//                 live yet, the deep pass running), so once the surface plays
//                 the card the hand lifts and stays off while the blueprint
//                 shows the reconciled delta and the waiting state.
//
// The sample-proposal command answers with an error, as it does until the
// learn-from-sample backend lands: the Detail page must treat it as absent.
// Fixture CODE, no personal data.

export function twinDetailTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const TWIN = 'twin-kristyna';

  const profile = {
    id: TWIN, name: 'Kristýna Nováková', slug: 'kristyna',
    bio: 'Head of partnerships for Central Europe. Writes short, warm emails that open with the ask and close with one concrete next step; argues from real deals rather than from the playbook.',
    role: 'Head of Partnerships, Central Europe', languages: '["cs","en","de"]', pronouns: 'female',
    obsidian_subpath: 'personas/twins/kristyna', is_active: true, knowledge_base_id: null,
    training_directives: null, created_at: ago(60 * 24 * 40), updated_at: ago(60 * 3),
  };

  const dims = (formality, warmth, humor, energy, length, directness, expressiveness, detail) =>
    ({ formality, warmth, humor, energy, length, directness, expressiveness, detail });
  const style = (source, name, d) => JSON.stringify({ source, presetId: source === 'preset' ? 'warm-direct' : null, name, summary: '', avoid: '', dims: d });
  const tone = (channel, over) => ({
    id: `tone-${channel}`, twin_id: TWIN, channel, voice_directives: '', examples_json: null,
    constraints_json: null, length_hint: null, style_json: null, updated_at: ago(60 * 5), ...over,
  });
  const tones = [
    tone('generic', {
      voice_directives: 'Warm and direct. Lead with the point, one idea per sentence.',
      examples_json: JSON.stringify(['Happy to help. Can you send the draft by Thursday?', 'Short version: yes, if legal signs off first.', 'Thanks, that settles it.']),
      constraints_json: JSON.stringify(['No emoji', 'Never promise a date I do not control', 'No "per my last email"']),
      length_hint: '2-4 sentences', style_json: style('preset', 'Warm and direct', dims(3, 4, 2, 3, 2, 4, 3, 3)),
    }),
    tone('email', {
      voice_directives: 'Open with the ask. Close with one concrete next step and a date.',
      examples_json: JSON.stringify(['Hi Jan, could we move the review to Monday? I will bring the revised terms.', 'Dear Ms. Weber, attached are the figures we discussed. Next step: a 30-minute call this week.']),
      constraints_json: JSON.stringify(['Always a subject line that states the ask', 'Sign off with first name only']),
      length_hint: 'One short paragraph', style_json: style('learned', 'Learned from email', dims(4, 3, 1, 3, 3, 3, 2, 4)),
    }),
    tone('slack', {
      voice_directives: 'Lowercase is fine. Thread replies, no channel-wide pings.',
      examples_json: JSON.stringify(['on it, back in 10', 'yes, ship it']),
      style_json: style('rolled', 'Quick and dry', dims(2, 3, 3, 4, 1, 4, 2, 2)),
    }),
    tone('teams', { examples_json: JSON.stringify(['Thanks all, notes are in the channel.']) }),
  ];
  const channel = (type, label) => ({
    id: `ch-${type}`, twin_id: TWIN, channel_type: type, credential_id: `cred-${type}`, persona_id: null,
    label, is_active: true, created_at: ago(60 * 24 * 20), updated_at: ago(60 * 24),
  });
  const channels = [channel('slack', 'Partner Slack'), channel('email', 'Work mail'), channel('teams', 'Teams'), channel('whatsapp', 'WhatsApp')];

  const TOPICS = ['opinions', 'expertise', 'values', 'background', 'communication', 'expertise', 'opinions', 'personal'];
  const comms = TOPICS.map((topic, i) => ({
    id: `comm-${i}`, twin_id: TWIN, channel: 'training', direction: 'out', contact_handle: null,
    content: `Training answer ${i + 1}`, summary: `Training Q&A ${i + 1}`,
    key_facts_json: JSON.stringify({ kind: 'training_qa', topic, pairs: [{ q: `Question ${i + 1}`, a: `Answer ${i + 1}` }] }),
    occurred_at: ago(60 * (2 + i * 7)), created_at: ago(60 * (2 + i * 7)),
  }));
  const memory = (id, status, title, content, comm, minutesAgo) => ({
    id, twin_id: TWIN, channel: comm ? 'training' : null, content, title, importance: 3, status,
    reviewer_notes: null, source_communication_id: comm, created_at: ago(minutesAgo),
    reviewed_at: status === 'pending' ? null : ago(minutesAgo - 30),
  });
  const approved = [
    memory('m1', 'approved', 'Disagrees with discount-first deals', 'Will not open a negotiation with a discount; starts from value delivered.', 'comm-0', 60 * 3),
    memory('m2', 'approved', 'Renews the Vienna contract every March', 'The Vienna distributor contract renews each March; terms are reviewed in February.', 'comm-1', 60 * 9),
    memory('m3', 'approved', 'Never promises a launch date', 'Commits to dates only when engineering has signed off.', 'comm-2', 60 * 16),
    memory('m4', 'approved', 'Started in sales engineering', 'Spent six years in sales engineering before moving to partnerships.', 'comm-3', 60 * 23),
    memory('m5', 'approved', 'Prefers calls for bad news', 'Moves a thread from email to a call when the news is bad.', 'comm-4', 60 * 30),
    memory('m6', 'approved', 'Knows EU distribution law', 'Negotiates exclusivity clauses under EU distribution rules every quarter.', 'comm-5', 60 * 37),
    memory('m7', 'approved', null, 'Weekly partner sync is on Tuesdays at 10:00.', null, 60 * 48),
  ];
  const pending = [
    memory('p1', 'pending', 'Pushes back on the sales playbook', 'Would drop the scripted discovery call for partners she already knows.', 'comm-6', 60 * 2),
    memory('p2', 'pending', 'Runs on weekends', 'Trains for a half marathon; mentions it in small talk.', 'comm-7', 60 * 2),
  ];
  const rejected = [memory('r1', 'rejected', 'Likes long meetings', 'Mis-heard: she does not.', null, 60 * 70)];
  const fact = (id, content, contact = null) => ({
    id, twin_id: TWIN, contact_handle: contact, content, importance: 3, sources_json: '["comm-0"]',
    created_at: ago(60 * 24), last_seen_at: ago(60 * 6),
  });
  const facts = [
    fact('f1', 'Based in Brno, travels to Vienna monthly'),
    fact('f2', 'Speaks Czech, English and German at work'),
    fact('f3', 'Reports to the Chief Revenue Officer'),
    fact('f4', 'Jan from Distribuce prefers calls after 4 pm', 'jan@slack'),
  ];

  const goal = (id, slot, title, coverage, answered, state, lastWhy = null, criteria = []) => ({
    id, slot, title, intent: '', criteria, state, pinned: false, coverage, position: 0, answered, lastWhy,
  });
  const goalsBefore = [
    goal('g-identity', 'identity', 'Her role and what she is accountable for', 1, 5, 'covered', null, ['Role and scope', 'Who she reports to']),
    goal('g-tone', 'tone', 'Email voice with partners she has never met', 0.82, 6, 'open', 'Opens with the ask, closes with one concrete next step.', ['First line states the ask', 'One next step with a date']),
    goal('g-channels', 'channels', 'When a thread moves from email to a call', 0.4, 2, 'open'),
    goal('g-memories', 'memories', 'Standing commitments and recurring meetings', 0.6, 4, 'open'),
    goal('g-opinions', 'training:opinions', 'Where she disagrees with the sales playbook', 0.3, 3, 'open', null, ['A position she holds', 'A reason from a real deal']),
    goal('g-expertise', 'training:expertise', 'Contract terms she negotiates every quarter', 0.9, 7, 'covered'),
    goal('g-values', 'training:values', 'What she will not promise a partner', 0.15, 1, 'open'),
  ];
  const KINDS = ['scene', 'opinion', 'reply_drill', 'fact', 'opinion', 'scene', 'rule', 'preference', 'reply_drill', 'scene'];
  const answeredStep = (i, kind) => ({
    id: `step-${i}`, goalId: i % 2 ? 'g-opinions' : 'g-tone', stage: i < 5 ? 'setup' : 'training', origin: 'plan', kind,
    question: `Question ${i + 1}: how would you answer this partner?`, answerMode: kind === 'reply_drill' ? 'write' : 'pick',
    incoming: null, toneChannel: kind === 'reply_drill' ? 'email' : null, suggestions: [], status: 'answered',
    answer: `My answer to question ${i + 1}.`, position: i, askedAt: ago(60 * (40 - i * 3)), answeredAt: ago(60 * (40 - i * 3) - 2),
    reconciled: true, coverageGain: 0.05,
  });
  const transcript = KINDS.map((kind, i) => answeredStep(i, kind));
  const LIVE_QUESTION = 'A partner asks you to commit to a launch date you do not control. What do you write back?';
  const live = {
    id: 'step-live', goalId: 'g-values', stage: 'training', origin: 'plan', kind: 'opinion', question: LIVE_QUESTION,
    answerMode: 'pick', incoming: null, toneChannel: null,
    suggestions: [
      { text: 'I give the date engineering gives me, and say so.', reason: 'Honest about who owns the date.' },
      { text: 'I promise a window, not a day, and name the risk.', reason: 'Keeps the partner planning.' },
      { text: 'I ask what they need the date for first.', reason: 'Finds the real constraint.' },
    ],
    status: 'live', answer: null, position: 11, askedAt: ago(1), answeredAt: null, reconciled: false, coverageGain: null,
  };
  const observations = [
    { id: 'o1', text: 'Answers in short lines and never hedges a refusal.', evidence: 4, updatedAt: ago(60) },
    { id: 'o2', text: 'Reaches for a real deal as evidence before any principle.', evidence: 3, updatedAt: ago(90) },
    { id: 'o3', text: 'Switches to German for Austrian partners.', evidence: 2, updatedAt: ago(200) },
  ];
  const snapshot = (over) => ({
    twinId: TWIN, stage: 'training', topicPreset: 'values', focusSlot: null, planStatus: 'ready', planVersion: 3,
    planError: null, changeNote: null, goals: goalsBefore, live, upcoming: [], transcript, offers: [],
    lastAnswerOfferIds: [], observations, planning: false, reconciling: false, ...over,
  });
  const before = snapshot({});
  // After the live card is answered: scored by the reconcile pass, no next
  // question yet, the fifth-answer deep pass running.
  const after = snapshot({
    live: null,
    planning: true,
    goals: goalsBefore.map((g) => (g.id === 'g-values'
      ? { ...g, coverage: 0.27, answered: 2, lastWhy: 'Took a clear side and gave a reason from a real deal.' }
      : g)),
    transcript: [...transcript, { ...live, status: 'answered', answer: live.suggestions[0].text, answeredAt: ago(0), reconciled: true, coverageGain: 0.12 }],
    observations,
  });

  const memoryCalls = [
    { cmd: 'twin_list_pending_memories', args: { twinId: TWIN, status: 'approved', limit: null }, response: approved },
    { cmd: 'twin_list_pending_memories', args: { twinId: TWIN, status: 'pending', limit: null }, response: pending },
    { cmd: 'twin_list_pending_memories', args: { twinId: TWIN, status: 'rejected', limit: null }, response: rejected },
  ];
  const common = [
    { cmd: 'twin_list_profiles', response: [profile] },
    { cmd: 'twin_list_tones', response: tones },
    { cmd: 'twin_list_channels', response: channels },
    ...memoryCalls,
    { cmd: 'twin_list_distilled_facts', response: facts },
    { cmd: 'twin_list_communications', response: comms },
    { cmd: 'twin_sample_proposals', error: 'twin_sample_proposals: not built (page harness)' },
  ];
  const tape = (module, note, calls) => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [...common, ...calls] });

  return {
    TWIN,
    profile,
    builders: {
      'twin/detail': () => tape('twin/detail', 'Synthetic: the Detail page of a twin with four voiced channels, a ready plan and a live question; sample proposals not built.', [
        { cmd: 'twin_setup_get', response: before },
      ]),
      'twin/stage-dealt': () => tape('twin/stage-dealt', 'Synthetic: the training overlay with the live card dealt over the blueprint.', [
        { cmd: 'twin_setup_open', response: before },
        { cmd: 'twin_setup_steer', response: before },
        { cmd: 'twin_setup_get', response: before },
      ]),
      'twin/stage': () => tape('twin/stage', 'Synthetic: the training overlay; the live card is answered by the surface, then the hand stays off while the blueprint shows the scored answer and the deep pass.', [
        { cmd: 'twin_setup_open', response: before },
        { cmd: 'twin_setup_steer', response: before },
        { cmd: 'twin_setup_answer', response: after },
        { cmd: 'twin_setup_get', response: after },
      ]),
    },
  };
}
