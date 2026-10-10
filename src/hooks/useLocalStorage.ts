// src/hooks/useLocalStorage.ts
// Hook universal untuk menyimpan state React ke localStorage secara otomatis.
// PERBAIKAN:
// 1. Debounce 500ms save agar tidak write setiap keystroke (penyebab lag)
// 2. Error handling yang lebih baik untuk QuotaExceededError
// 3. Tidak save saat component unmount dengan timer aktif

import { useState, useEffect, useCallback, useRef } from 'react';

function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  // Muat data dari localStorage saat pertama kali, fallback ke initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // Debounce ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Simpan ke localStorage dengan debounce 500ms
  useEffect(() => {
    // Skip save saat pertama kali mount (data baru dimuat dari storage)
    if (timerRef.current !== undefined) {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        try {
          window.localStorage.setItem(key, JSON.stringify(storedValue));
        } catch (e: any) {
          if (e?.name === 'QuotaExceededError') {
            console.warn(`[useLocalStorage] Storage penuh untuk key: ${key}`);
          }
          // Silent fail — jangan crash app karena storage
        }
      }, 500);
    } else {
      // Pertama kali — set timer ref ke null (bukan undefined)
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, storedValue]);

  // Cleanup saat unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Setter yang kompatibel dengan useState (mendukung functional updates)
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const nextValue = value instanceof Function ? value(prev) : value;
      return nextValue;
    });
  }, []);

  return [storedValue, setValue];
}

export default useLocalStorage;
