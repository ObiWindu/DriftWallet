// BAD fixture: sessionId / seed material into persistent stores — must flag.
const mmkv = { set: (k, v) => {} };
function leak(sessionId, mnemonic) {
  localStorage.setItem("sessionId", sessionId); // rule: no-store-secrets
  chrome.storage.local.set({ sessionId }); // rule: no-store-secrets
  mmkv.set("mnemonic", mnemonic); // rule: no-store-secrets
}
leak("s", "abandon abandon");
