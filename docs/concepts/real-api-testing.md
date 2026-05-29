# Real API Testing

> Placeholder stub — created to unblock the `companion/brain/doctrine.rs`
> `include_str!("../../../../docs/concepts/real-api-testing.md")` reference
> (added by commit "Safe check" without the file). Replace with the real
> doctrine content; the owning session should fill this in.

Guidance for testing personas against **real external APIs** rather than mocks:

- Prefer a sandbox/test account with scoped credentials over production keys.
- Keep live runs idempotent and cost-bounded (small `limit`s, dry-run first).
- Use a mock or simulation as the default when a live call is destructive,
  rate-limited, or expensive; reserve real calls for the cases that genuinely
  need to exercise the network + auth path.
- Record outcomes so a flaky external dependency is distinguishable from a
  real persona/logic failure.
