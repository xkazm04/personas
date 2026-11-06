//! Host sampler: whole-machine CPU / RAM (sysinfo) and GPU (PDH `_Total`) every
//! 10 s, rolled up to 1-minute `host_utilization` rows, pruned past 14 days.
//! Spark app-standup. WP2 owns.
