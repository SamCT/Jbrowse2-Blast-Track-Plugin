const contactEmailStorageKey = 'blastTrackContactEmail'

export function readStoredContactEmail() {
  try {
    return globalThis.localStorage?.getItem(contactEmailStorageKey) ?? ''
  } catch {
    return ''
  }
}

export function storeContactEmail(email: string) {
  try {
    if (email) {
      globalThis.localStorage?.setItem(contactEmailStorageKey, email)
    } else {
      globalThis.localStorage?.removeItem(contactEmailStorageKey)
    }
  } catch {
    // Ignore storage errors in locked-down browsers.
  }
}
