// Stores the user's own Anthropic API key on this device only (localStorage).
// Never synced to Firestore, never sent anywhere except directly to
// Anthropic's API when the user explicitly triggers AI-powered PDF parsing.

const STORAGE_KEY = 'apexwallet_ai_api_key';

export function getAiApiKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAiApiKey(key) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (e.g. private browsing) -- key simply won't persist
  }
}
