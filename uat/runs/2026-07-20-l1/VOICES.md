# Character panel — first-person verdicts (L1, 2026-07-20)

The felt layer. Findings are the actionable artifact; this is what the product *feels like* to eight people with different jobs. Ordered by journey.

---

## Dani Okafor — Content Marketer (Starter, marketing)

**On building from intent:** "The thing that won me over is buried in the code: when I paste a sample, the tone actually lands in the persona's identity and travels all the way into what the agent writes. That's more than Jasper ever did for me. But that field is collapsed, says 'optional,' and sits under the intent box like a footnote. The one input that decides whether this sounds like us is the one you have to go find. And when I paste a full issue — which is what a voice sample *is* — it quietly cuts me off at 8,000 characters and tells the model, not me."

**On adopting a template:** "Whoever wrote Content Cascade gets it. 'Never flatten every platform into the same template.' Then I tried to give it my voice. It asks me to paste three to five of my best posts, separated by platform headers. Into a box the width of my thumb, that won't take a line break. That's the whole grounding step. And I couldn't find where my newsletter goes — there's a Run button, so I pressed it, and it ran on nothing."

**On setting a trigger:** "I went looking for the Events thing everyone told me about and it simply isn't in my sidebar — not greyed out with 'upgrade to unlock,' just absent. I typed 'every Tuesday' somewhere and it agreed with me, then quietly decided that meant every hour."

**On refining in the Lab:** "My posts came out sounding like every other B2B LinkedIn account — the exact thing I bought this to avoid. So I go looking for the knob. There isn't one. Two tabs: Design and Settings. And the app is quietly saving a version every time I touch that prompt — I found out because a chart has little ticks labelled 'Prompt v7.' Seven! I can't read any of them. What stings most is nobody told me a better tool existed."

## Tomás Herrera — Sales Rep / SDR (Starter, sales)

"I clicked into Sales expecting prospecting plays and got lead-capture forms, an e-commerce dashboard, and a conversion auditor. The explore tile literally says 'outreach' as a category and there's nothing behind it. That's the whole reason I opened the app. The one thing that looked right isn't something I can see. And reading what it would do: it never asks me what I sell. It's told to open with recent news, and nothing in there fetches news. That's a machine that invents a funding round my prospect never had. I send that, I'm done at that account forever. Credit where due: it never sends anything itself."

## Yuki Tanaka — Customer-Support Lead (Team, support)

**On running and reviewing:** "The thing I came to test actually works. My correction isn't a status flip — my typed note lands verbatim in a memory row and I found it again inside the next run's prompt. That's more than most 'AI support' tools ship. Then I looked closer. My titles repeat — that's what a support queue *is* — and the second time I correct the same one, it's dropped on a title match, with no toast. So the loop works best on novel cases and quietly stops working on my most common ones. That's backwards."

**On building and triggers:** "I picked 'On low confidence — only pause when unsure,' which is the entire reason I'm here, and it does nothing. It's the same as 'Always.' So my choices are: gate every reply and save my team nothing, or gate nothing and wait for the screenshot that ends my quarter. Worse, if I adopt a recipe instead of hand-building, the same words mean 'auto-approve, never tell a human.' That is the exact failure mode that gets someone fired."

**On the Lab:** "Can my team's corrections ever make this agent better? No. I checked twice because I didn't believe it. The Lab, the tab literally called the place you improve the agent, has never heard of them. It writes its own test tickets, from the agent's own instructions, and grades itself. That's a student writing their own exam. I clicked 'Improve' expecting work to happen. I got a chat box asking *me* what to focus on. I run a support desk. If I knew how to rewrite the prompt, I wouldn't need the Lab."

## Aisha Mensah — Finance / Data Analyst (Team, finance)

**On building:** "It explicitly forbids the agent inventing 'realistic sample data,' and that clause alone puts it ahead of most tools I've tried. But it hands me the answer and hides the work. No query, no row count, no period boundary. And it built the whole persona knowing only that I have a connector called 'postgres' — it never looked at my tables. It never even *asked*. What broke my trust outright was the green test. Every tool passed, zero milliseconds, database untouched. A checkmark that means nothing is worse than no checkmark."

**On running:** "I'll credit it for recording the actual model version rather than the one I asked for. But when I opened the inspector to check where the receivables total came from, my query was cut off mid-clause. Five hundred characters. 'Let me parse a stream-json blob' is not an answer I give the CFO. What stopped me cold: nothing told me the number changed. A figure moving 14% month over month is the entire point of my job, and it's the one thing this doesn't watch."

**On the Lab:** "Can I prove version 4 is more accurate than version 3? No. I went looking for where I put my known-good numbers. There's no such box. It invents the test, invents the tool responses, then grades the essay it got back. That 87 is a writing score. A fabricated figure, confidently formatted, scores higher than a hedged correct one. The caution triangle on degraded scores is genuinely careful work — they just applied it to the number that doesn't matter to me."

## Sam Becker — IT / Sysadmin (Team, IT ops)

**On building:** "The build actually *asks* me about human review and stores the answer, which is more than most tools do. But I traced it: 'always' becomes a sentence in a prompt, and the CLI underneath runs with permissions skipped. That's not a gate, that's a suggestion. The agent asks permission after it already sent the email. I can tell it what to approve, but I cannot tell it what it must never touch."

**On running:** "The error taxonomy is real: eleven typed categories, durable retries that survive a restart, a storm cap. Someone who's been on-call wrote that. Then it falls over at the last hop. Every finished run pages me — success and failure share one toggle, and that toggle has no UI. I came here to cut 3am pages and this hands me more. And a timeout retry restarts the task fresh with no idempotency on tool calls — that's my auto-restarted-service scar, exactly."

**On triggers:** "I went in assuming the guardrails would be thin. They aren't. I read that overlap comment three times. Then I looked for the thing that actually keeps the lights on and it isn't there. My 03:00 triage digest fires at 09:12 when I open the lid — and the countdown ticks down confidently the whole time. A trigger that died from a bad timezone renders the same as one I created a second ago. Silence is the failure mode."

## Marcus Lee — Software Developer (Builder, engineering)

**On running:** "Reliability isn't my problem here. My problem is the autopsy. A run comes back plausible and wrong, and the one thing I need — the bytes that went down stdin — is gone. Logged as 'Prompt length: 14203 characters.' That's a receipt, not evidence. The dry-run prompt fooled me for a minute. Full text, copy button, looks authoritative. Then I read `dry_run.rs` and it's assembling without memory, without credential hints. So I'd have tuned against a prompt that never runs. That's worse than showing me nothing."

**On the Lab:** "Can I trust the numbers? No — and I found that by reading the source, which is exactly the work this tool was supposed to save me. Measuring a version swaps its prompt onto the persona, and the prompt is hashed into the scenario cache key. So v3 gets one exam, v4 gets a different one, and the table cheerfully subtracts the two and paints it green. The comment literally says 'apples-to-apples.' That's not a rounding error, that's the whole instrument. What stings is that they *built* the right thing — `run_ab_test` runs both versions against one set. It's correct, it's tested, and it's wired to nothing. The good code is orphaned and the shaky path is the one on screen."

## Priya Raman — Solo Founder (Starter, ops)

"I typed one sentence about chasing invoices and it asked me maybe four questions — better than any Zapier setup I've done. Then it said 'promoted to production and ready to use' and threw me at an editor. Ready to use. It wasn't. Nothing told me my agent had no way into my email — I'd have found out on the first Sunday it was supposed to save me. And when it did ask which email service, my vault was empty, so I got one card that just said 'Add a different credential.' Add it from where? For what? Before any of that I had to choose between 'Cinema' and 'Dialogue+Cinema' and decide whether to 'let AI decide everything.' I don't know what those are. Nobody does."

## Lena Vasquez — Freelance Consultant / Agency (Builder, client work)

**On adopting:** "The duplicate path is the real thing — it clones the persona, keeps my parameters, and disables the triggers so I don't accidentally fire a client's Slack at 3am. That's someone who's shipped before. But my whole model is build once, parameterize, redeploy — and the parameterization is theater. My answers get baked into a *title string*; the substituted prompt body gets computed and thrown away with a `void`. Someone wrote a comment explaining why. So client #2 costs half of client #1, not a tenth."

**On the Lab:** "Can I bill for tuning? Not honestly. The moment I duplicate that persona for client B, everything I charged for evaporates. I just gave away the deliverable and kept the invoice. I found a proper version-comparison report sitting in the codebase — winner badges, per-scenario matrix, exactly the PDF I'd put in front of a client — and there's no button that reaches it. Then my baseline pin didn't follow me to my laptop. localStorage. For a consultant across six client checkouts, that's not a bug, that's a misunderstanding of who I am."
