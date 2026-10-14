//! Per-process GPU utilisation, read from the Windows GPU-engine performance
//! counters (`\GPU Engine(*)\Utilization Percentage`) through PDH.
//!
//! ONE query per tick for the whole machine, never one per pid: the counter
//! is wildcarded over every engine instance, and each instance name carries
//! the owning process (`pid_1234_luid_0x..._phys_0_eng_0_engtype_3D`). The
//! reader folds the instances into a `pid -> share` map the sampler then sums
//! over each run's process tree.
//!
//! The counter is a RATE, so PDH needs two collections before it can format a
//! value: the query handle stays open across ticks and the first read returns
//! `None`. Off Windows, or when PDH cannot open the counter (no GPU driver
//! exposing engines, a locked-down host), every read is `None` - never `0`,
//! because "no reading" and "used no GPU" are different facts.

use std::collections::HashMap;

/// The owning pid named in a GPU-engine instance name, or `None` when the
/// name is not of the `pid_<digits>[_...]` shape.
pub fn parse_instance_pid(instance: &str) -> Option<u32> {
    let rest = instance.strip_prefix("pid_")?;
    let digits = rest.split('_').next()?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Fold `(instance name, utilisation percent)` pairs into a per-pid share
/// (`percent / 100`, summed over the pid's engines). Instances that name no
/// pid, and non-finite or negative values, are skipped.
pub fn fold_instances<'a>(items: impl IntoIterator<Item = (&'a str, f64)>) -> HashMap<u32, f64> {
    let mut out: HashMap<u32, f64> = HashMap::new();
    for (name, pct) in items {
        if !pct.is_finite() || pct < 0.0 {
            continue;
        }
        if let Some(pid) = parse_instance_pid(name) {
            *out.entry(pid).or_insert(0.0) += pct / 100.0;
        }
    }
    out
}

/// Sum `pids`' shares out of a tick's map, clamped to `1.0`. `None` when the
/// tick had no reading at all.
pub fn tree_share(per_pid: Option<&HashMap<u32, f64>>, pids: &[u32]) -> Option<f64> {
    let map = per_pid?;
    let sum: f64 = pids.iter().filter_map(|p| map.get(p)).sum();
    Some(sum.clamp(0.0, 1.0))
}

/// The machine-wide GPU-engine reader. Holds the PDH query across ticks.
pub struct GpuReader {
    #[cfg(windows)]
    inner: Option<pdh::Query>,
}

impl GpuReader {
    /// Open the counter. Failure is not an error: the reader then reads
    /// `None` forever, and the run's GPU stays unknown.
    pub fn open() -> Self {
        #[cfg(windows)]
        {
            let inner = match pdh::Query::open() {
                Ok(q) => Some(q),
                Err(code) => {
                    tracing::info!(
                        code = format!("0x{code:08X}"),
                        "resources: GPU engine counters unavailable; GPU reads as unknown"
                    );
                    None
                }
            };
            Self { inner }
        }
        #[cfg(not(windows))]
        {
            Self {}
        }
    }

    /// This tick's per-pid GPU share, or `None` (first collection, a failed
    /// collection, or no counter at all).
    pub fn read(&mut self) -> Option<HashMap<u32, f64>> {
        #[cfg(windows)]
        {
            self.inner.as_mut()?.collect()
        }
        #[cfg(not(windows))]
        {
            None
        }
    }
}

#[cfg(windows)]
mod pdh {
    use std::collections::HashMap;

    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE_ITEM_W,
        PDH_FMT_DOUBLE, PDH_MORE_DATA,
    };

    const ERROR_SUCCESS: u32 = 0;

    pub struct Query {
        query: isize,
        counter: isize,
        /// The first collection only primes the rate; it has nothing to read.
        primed: bool,
    }

    // The handles are plain integers owned by this struct (so it is `Send`).
    // PDH allows a query to be used from any thread, one call at a time,
    // which the sampler's mutex guarantees.

    impl Query {
        pub fn open() -> Result<Self, u32> {
            let mut query: isize = 0;
            // SAFETY: a null data source means "live counters"; `query` is a
            // valid out-pointer for the call's duration.
            let rc = unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) };
            if rc != ERROR_SUCCESS {
                return Err(rc);
            }
            let mut counter: isize = 0;
            // SAFETY: `query` was just opened; the path is a static wide
            // string; `counter` is a valid out-pointer.
            let rc = unsafe {
                PdhAddEnglishCounterW(
                    query,
                    w!("\\GPU Engine(*)\\Utilization Percentage"),
                    0,
                    &mut counter,
                )
            };
            if rc != ERROR_SUCCESS {
                // SAFETY: closing the query we opened above.
                unsafe { PdhCloseQuery(query) };
                return Err(rc);
            }
            Ok(Self {
                query,
                counter,
                primed: false,
            })
        }

        pub fn collect(&mut self) -> Option<HashMap<u32, f64>> {
            // SAFETY: `self.query` is open for the lifetime of `self`.
            let rc = unsafe { PdhCollectQueryData(self.query) };
            if rc != ERROR_SUCCESS {
                self.primed = false;
                return None;
            }
            if !self.primed {
                self.primed = true;
                return None;
            }
            let mut bytes: u32 = 0;
            let mut count: u32 = 0;
            // SAFETY: a size query - no buffer, two valid out-pointers.
            let rc = unsafe {
                PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut bytes,
                    &mut count,
                    None,
                )
            };
            if rc != PDH_MORE_DATA || bytes == 0 {
                // No engine instance at all reads as "no reading", not 0.
                return None;
            }
            // A buffer of ITEM structs (so it is aligned for them) at least
            // `bytes` long; PDH appends the instance strings after the items.
            let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            let mut buf: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> =
                vec![PDH_FMT_COUNTERVALUE_ITEM_W::default(); (bytes as usize).div_ceil(item)];
            // SAFETY: `buf` holds at least `bytes` bytes, as the size query
            // asked for; PDH writes `count` items and their strings into it.
            let rc = unsafe {
                PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut bytes,
                    &mut count,
                    Some(buf.as_mut_ptr()),
                )
            };
            if rc != ERROR_SUCCESS {
                return None;
            }
            let n = (count as usize).min(buf.len());
            let mut pairs: Vec<(String, f64)> = Vec::with_capacity(n);
            for it in &buf[..n] {
                let status = it.FmtValue.CStatus;
                if status != PDH_CSTATUS_VALID_DATA && status != PDH_CSTATUS_NEW_DATA {
                    continue;
                }
                if it.szName.is_null() {
                    continue;
                }
                // SAFETY: PDH set `szName` to a NUL-terminated string inside
                // `buf`, which is alive for this loop.
                let Ok(name) = (unsafe { it.szName.to_string() }) else {
                    continue;
                };
                // SAFETY: the counter was formatted with PDH_FMT_DOUBLE, so
                // the union holds `doubleValue`.
                let value = unsafe { it.FmtValue.Anonymous.doubleValue };
                pairs.push((name, value));
            }
            Some(super::fold_instances(
                pairs.iter().map(|(n, v)| (n.as_str(), *v)),
            ))
        }
    }

    impl Drop for Query {
        fn drop(&mut self) {
            // SAFETY: closing the query this struct opened; also frees the
            // counter added to it.
            unsafe { PdhCloseQuery(self.query) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_names_yield_their_pid() {
        assert_eq!(
            parse_instance_pid("pid_1234_luid_0x00000000_0x0000D1A2_phys_0_eng_0_engtype_3D"),
            Some(1234)
        );
        assert_eq!(
            parse_instance_pid("pid_7_luid_0x00000000_0x00011F5B_phys_0_eng_3_engtype_VideoDecode"),
            Some(7)
        );
        assert_eq!(parse_instance_pid("pid_42"), Some(42));
    }

    #[test]
    fn malformed_instance_names_yield_nothing() {
        for bad in [
            "",
            "pid_",
            "pid__luid_0x0",
            "pid_abc_luid_0x0",
            "pid_12a_luid",
            "PID_12_luid",
            "luid_0x00000000_pid_12",
            "_Total",
            "pid_99999999999999_luid",
        ] {
            assert_eq!(parse_instance_pid(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn instances_fold_per_pid_and_a_tree_sum_clamps() {
        let per_pid = fold_instances([
            ("pid_10_luid_0x0_phys_0_eng_0_engtype_3D", 40.0),
            ("pid_10_luid_0x0_phys_0_eng_1_engtype_Copy", 10.0),
            ("pid_11_luid_0x0_phys_0_eng_0_engtype_3D", 70.0),
            ("_Total", 99.0),
            ("pid_12_luid_0x0_phys_0_eng_0_engtype_3D", f64::NAN),
        ]);
        assert_eq!(per_pid.get(&10), Some(&0.5));
        assert_eq!(per_pid.get(&11), Some(&0.7));
        assert_eq!(per_pid.get(&12), None);
        assert_eq!(tree_share(Some(&per_pid), &[10]), Some(0.5));
        assert_eq!(tree_share(Some(&per_pid), &[10, 11]), Some(1.0), "clamped");
        // A tree that used no engine reads 0 - there WAS a reading.
        assert_eq!(tree_share(Some(&per_pid), &[99]), Some(0.0));
        // No reading at all stays None.
        assert_eq!(tree_share(None, &[10]), None);
    }
}
