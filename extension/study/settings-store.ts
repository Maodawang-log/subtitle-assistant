const SETTINGS_KEY = 'biliscriptJapaneseSettings';
let writes = Promise.resolve();
// Serialize this page's independent controls and merge only their own fields.
export function updateStudySettings(patch: Record<string, unknown>): Promise<Record<string, any>> {
  const operation = writes.catch(() => {}).then(async () => {
    const latest = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    const next = { ...latest, ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
  writes = operation.then(() => {}, () => {});
  return operation;
}
