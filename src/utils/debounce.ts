/**
 * Debounce Utility
 * 
 * Provides a debounce function to limit the rate of function execution.
 * Essential for performance when responding to rapid events like typing.
 */

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 * 
 * @param func - The function to debounce
 * @param wait - The debounce delay in milliseconds
 * @returns A debounced function with a cancel method
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
    func: T,
    wait: number
): { (...args: Parameters<T>): void; cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const debouncedFn = (...args: Parameters<T>): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            timeoutId = undefined;
            func(...args);
        }, wait);
    };

    /**
     * Cancel any pending debounced execution
     */
    debouncedFn.cancel = (): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
    };

    return debouncedFn;
}

/**
 * Creates an async debounced version that returns a promise
 * and properly handles async functions.
 * 
 * @param func - The async function to debounce
 * @param wait - The debounce delay in milliseconds
 * @returns A debounced async function with a cancel method
 */
export function debounceAsync<T extends (...args: Parameters<T>) => Promise<ReturnType<T>>>(
    func: T,
    wait: number
): { (...args: Parameters<T>): Promise<ReturnType<T> | undefined>; cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pendingResolve: ((value: ReturnType<T> | undefined) => void) | undefined;

    const debouncedFn = (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
        return new Promise((resolve) => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
                // Resolve previous pending promise with undefined (cancelled)
                if (pendingResolve) {
                    pendingResolve(undefined);
                }
            }

            pendingResolve = resolve;

            timeoutId = setTimeout(async () => {
                timeoutId = undefined;
                pendingResolve = undefined;
                try {
                    const result = await func(...args);
                    resolve(result);
                } catch (error) {
                    // Re-throw to let caller handle
                    throw error;
                }
            }, wait);
        });
    };

    debouncedFn.cancel = (): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        if (pendingResolve) {
            pendingResolve(undefined);
            pendingResolve = undefined;
        }
    };

    return debouncedFn;
}
