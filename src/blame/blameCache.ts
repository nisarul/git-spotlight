/**
 * Blame Cache
 * 
 * Memoization layer for git blame results to avoid redundant git calls.
 * Cache is keyed by (file path, HEAD commit) combination.
 * 
 * Cache invalidation occurs when:
 * - File changes (different path)
 * - HEAD changes (new commits, branch switch)
 * - Manual clear
 */

import { BlameParseResult } from './blameParser';

/**
 * Cache entry containing blame data and metadata
 */
interface BlameCacheEntry {
    /** Parsed blame result */
    blameResult: BlameParseResult;
    /** HEAD commit hash when this was cached */
    headCommit: string;
    /** Timestamp when cache entry was created */
    cachedAt: number;
    /** File path for debugging */
    filePath: string;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
    /** Total number of cache entries */
    entryCount: number;
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Hit rate percentage */
    hitRate: number;
}

/**
 * Blame cache manager
 */
export class BlameCache {
    /** Cache storage: Map<filePath, CacheEntry> */
    private cache: Map<string, BlameCacheEntry> = new Map();
    
    /** Cache hit count for statistics */
    private hits = 0;
    
    /** Cache miss count for statistics */
    private misses = 0;

    /** Maximum number of entries to keep in cache */
    private maxEntries: number;

    /**
     * Create a new blame cache
     * @param maxEntries - Maximum number of files to cache (default: 50)
     */
    constructor(maxEntries: number = 50) {
        this.maxEntries = maxEntries;
    }

    /**
     * Generate cache key for a file
     * We use just the file path as the key, and check headCommit separately
     * to allow for cache invalidation detection
     */
    private getCacheKey(filePath: string): string {
        // Normalize path separators
        return filePath.replace(/\\/g, '/').toLowerCase();
    }

    /**
     * Get cached blame result for a file
     * 
     * @param filePath - Absolute path to the file
     * @param currentHeadCommit - Current HEAD commit hash
     * @returns Cached blame result or undefined if not cached or stale
     */
    get(filePath: string, currentHeadCommit: string): BlameParseResult | undefined {
        const key = this.getCacheKey(filePath);
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        // Check if HEAD has changed (cache is stale)
        if (entry.headCommit !== currentHeadCommit) {
            this.misses++;
            // Don't delete the entry - update will replace it
            return undefined;
        }

        this.hits++;
        return entry.blameResult;
    }

    /**
     * Store blame result in cache
     * 
     * @param filePath - Absolute path to the file
     * @param headCommit - HEAD commit hash at time of blame
     * @param blameResult - Parsed blame result to cache
     */
    set(filePath: string, headCommit: string, blameResult: BlameParseResult): void {
        const key = this.getCacheKey(filePath);

        // Evict oldest entries if at capacity
        if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
            this.evictOldest();
        }

        this.cache.set(key, {
            blameResult,
            headCommit,
            cachedAt: Date.now(),
            filePath,
        });
    }

    /**
     * Check if a file has a valid cache entry
     * 
     * @param filePath - Absolute path to the file
     * @param currentHeadCommit - Current HEAD commit hash
     * @returns true if cache entry exists and is valid
     */
    has(filePath: string, currentHeadCommit: string): boolean {
        const key = this.getCacheKey(filePath);
        const entry = this.cache.get(key);
        return entry !== undefined && entry.headCommit === currentHeadCommit;
    }

    /**
     * Remove a specific file from cache
     * @param filePath - File path to remove
     */
    delete(filePath: string): boolean {
        const key = this.getCacheKey(filePath);
        return this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Clear all entries for a specific HEAD commit
     * Useful when HEAD changes and all cache is potentially stale
     * @param excludeHeadCommit - Keep entries matching this HEAD
     */
    invalidateForHeadChange(newHeadCommit: string): void {
        const keysToDelete: string[] = [];
        
        this.cache.forEach((entry, key) => {
            if (entry.headCommit !== newHeadCommit) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(key => this.cache.delete(key));
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            entryCount: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? (this.hits / total) * 100 : 0,
        };
    }

    /**
     * Evict the oldest cache entry
     */
    private evictOldest(): void {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;

        this.cache.forEach((entry, key) => {
            if (entry.cachedAt < oldestTime) {
                oldestTime = entry.cachedAt;
                oldestKey = key;
            }
        });

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * Get the number of cached entries
     */
    get size(): number {
        return this.cache.size;
    }
}

// Singleton instance for the extension
let globalCache: BlameCache | undefined;

/**
 * Get the global blame cache instance
 * @returns Global cache instance
 */
export function getBlameCache(): BlameCache {
    if (!globalCache) {
        globalCache = new BlameCache();
    }
    return globalCache;
}

/**
 * Reset the global cache (useful for testing)
 */
export function resetBlameCache(): void {
    globalCache?.clear();
    globalCache = undefined;
}
