//! Dead-spot detector: measured CPU and GPU below the `standup.dead_spot_*`
//! thresholds for the configured minutes with filler queued, and the admission
//! backfill hook it feeds (a pure fn over the queue door). Spark app-standup.
//! WP2 owns.
