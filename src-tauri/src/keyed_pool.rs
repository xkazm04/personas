//! Generic keyed resource pool with RAII handles and automatic pruning.
//!
//! Provides a thread-safe, HashMap-backed pool where each key maps to a value
//! with an optional active-handle count. Three access patterns are supported:
//!
//! 1. **RAII acquisition** via [`KeyedResourcePool::acquire`]: returns a
//!    [`PoolHandle`] that increments the active count on creation and decrements
//!    it on drop. Inactive entries are periodically pruned.
//!
//! 2. **Direct access** via [`get`](KeyedResourcePool::get),
//!    [`insert`](KeyedResourcePool::insert),
//!    [`remove`](KeyedResourcePool::remove): plain keyed map operations without
//!    lifecycle tracking.
//!
//! 3. **Bulk operations** via [`retain`](KeyedResourcePool::retain) and
//!    [`values`](KeyedResourcePool::values).

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// Internal entry wrapping a value with an active-handle count.
struct PoolEntry<V> {
    value: V,
    /// Number of outstanding [`PoolHandle`]s referencing this entry.
    active: usize,
}

/// Shared interior behind [`KeyedResourcePool`].
struct PoolInner<K, V> {
    map: Mutex<HashMap<K, PoolEntry<V>>>,
    acquire_count: AtomicUsize,
    prune_interval: usize,
    prune_threshold: usize,
}

/// A thread-safe, keyed resource pool with RAII handle tracking and automatic
/// pruning of inactive entries.
///
/// Replaces the three bespoke keyed-map-with-lifecycle implementations:
/// - `ActiveProcessRegistry` (run_flags + run_pids)
/// - `CREDENTIAL_REFRESH_LOCKS` (credential ID → mutex with active counting)
/// - `CompositeState` (trigger ID → firing timestamps / match results)
pub struct KeyedResourcePool<K, V> {
    inner: Arc<PoolInner<K, V>>,
}

impl<K, V> Clone for KeyedResourcePool<K, V> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<K: Eq + Hash + Clone, V: Clone> KeyedResourcePool<K, V> {
    /// Create a new pool.
    ///
    /// * `prune_interval` — prune every N [`acquire`](Self::acquire) calls.
    ///   Pass `0` to disable automatic pruning.
    /// * `prune_threshold` — only prune when the map exceeds this many entries.
    pub fn new(prune_interval: usize, prune_threshold: usize) -> Self {
        Self {
            inner: Arc::new(PoolInner {
                map: Mutex::new(HashMap::new()),
                acquire_count: AtomicUsize::new(0),
                prune_interval,
                prune_threshold,
            }),
        }
    }

    /// Acquire a handle to the resource at `key`, creating it with `init` if
    /// absent. The returned [`PoolHandle`] increments the active-user count;
    /// dropping it decrements, making the entry eligible for future pruning.
    pub fn acquire(&self, key: K, init: impl FnOnce() -> V) -> PoolHandle<K, V> {
        let inner = &self.inner;
        let mut map = inner.map.lock().unwrap_or_else(|e| e.into_inner());

        // Periodic pruning of entries with zero active handles.
        if inner.prune_interval > 0 {
            let count = inner.acquire_count.fetch_add(1, Ordering::Relaxed) + 1;
            if count % inner.prune_interval == 0 && map.len() > inner.prune_threshold {
                let before = map.len();
                map.retain(|_, entry| entry.active > 0);
                let pruned = before - map.len();
                if pruned > 0 {
                    tracing::debug!(
                        pruned,
                        remaining = map.len(),
                        "KeyedResourcePool: pruned inactive entries"
                    );
                }
            }
        }

        let entry = map.entry(key.clone()).or_insert_with(|| PoolEntry {
            value: init(),
            active: 0,
        });
        entry.active += 1;
        let value = entry.value.clone();

        PoolHandle {
            pool: Arc::clone(&self.inner),
            key,
            value,
        }
    }

    /// Get a clone of the value at `key` without acquiring a handle.
    pub fn get<Q>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        let map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        map.get(key).map(|e| e.value.clone())
    }

    /// Insert or overwrite a value directly (no handle tracking).
    pub fn insert(&self, key: K, value: V) {
        let mut map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        match map.get_mut(&key) {
            Some(entry) => entry.value = value,
            None => {
                map.insert(key, PoolEntry { value, active: 0 });
            }
        }
    }

    /// Remove an entry and return its value.
    pub fn remove<Q>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        let mut map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(key).map(|e| e.value)
    }

    /// Retain only entries for which `f` returns `true`.
    pub fn retain(&self, mut f: impl FnMut(&K, &V) -> bool) {
        let mut map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|k, entry| f(k, &entry.value));
    }

    /// Return a snapshot of all values.
    pub fn values(&self) -> Vec<V> {
        let map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        map.values().map(|e| e.value.clone()).collect()
    }

    /// Mutate the value at `key` in place, returning the closure's result.
    pub fn with_mut<Q, R>(&self, key: &Q, f: impl FnOnce(&mut V) -> R) -> Option<R>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        let mut map = self.inner.map.lock().unwrap_or_else(|e| e.into_inner());
        map.get_mut(key).map(|entry| f(&mut entry.value))
    }

    /// Number of entries currently in the pool.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.inner.map.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Returns `true` if the pool contains no entries.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.inner.map.lock().unwrap_or_else(|e| e.into_inner()).is_empty()
    }
}

/// RAII handle returned by [`KeyedResourcePool::acquire`].
///
/// Holds a clone of the value and decrements the entry's active-user count
/// when dropped, making it eligible for future pruning.
pub struct PoolHandle<K: Eq + Hash, V> {
    pool: Arc<PoolInner<K, V>>,
    key: K,
    /// The resource value (cloned from the pool at acquisition time).
    pub value: V,
}

impl<K: Eq + Hash, V> Drop for PoolHandle<K, V> {
    fn drop(&mut self) {
        let mut map = self.pool.map.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get_mut(&self.key) {
            entry.active = entry.active.saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_creates_and_prunes() {
        let pool: KeyedResourcePool<String, i32> = KeyedResourcePool::new(4, 0);

        // Acquire two handles, drop one.
        let h1 = pool.acquire("a".into(), || 1);
        assert_eq!(h1.value, 1);
        {
            let _h2 = pool.acquire("b".into(), || 2);
            assert_eq!(pool.len(), 2);
        }
        // "b" is now inactive (active=0).

        // Trigger pruning (every 4 acquisitions, threshold 0).
        // We've done 2 acquires so far. Do 2 more to hit count=4.
        let _h3 = pool.acquire("c".into(), || 3);
        let _h4 = pool.acquire("d".into(), || 4); // count=4, triggers prune.

        // "b" should have been pruned (active=0).
        assert!(pool.get("b").is_none());
        // "a", "c", "d" still present (all have active handles or were just created).
        assert_eq!(h1.value, 1);
        drop(h1);
    }

    #[test]
    fn direct_ops() {
        let pool: KeyedResourcePool<String, String> = KeyedResourcePool::new(0, 0);
        pool.insert("x".into(), "hello".into());
        assert_eq!(pool.get("x"), Some("hello".into()));

        pool.with_mut("x", |v| *v = "world".into());
        assert_eq!(pool.get("x"), Some("world".into()));

        pool.retain(|_, v| v != "world");
        assert!(pool.get("x").is_none());
    }
}
