// OK fixture: sessionId lives only in chrome.storage.session (memory-only).
async function lock(sessionId) {
  await chrome.storage.session.set({ sessionId });
  const { sessionId: s } = await chrome.storage.session.get("sessionId");
  return s;
}
lock("abc");
