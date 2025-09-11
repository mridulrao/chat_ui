// utils/thread.js
// Helpers to identify whether a reply continues the main thread (tail) of a root
export const getRootIdOf = (messagesRef, id) => {
const idToMsg = new Map(messagesRef.current.map(x => [x.id, x]));
let cur = idToMsg.get(id);
while (cur?.parentId) cur = idToMsg.get(cur.parentId);
return cur?.id ?? id;
};


export const getTailIdForRoot = (messagesRef, rootId) => {
  const idToMsg = new Map(messagesRef.current.map(x => [x.id, x]));
  // Messages that belong to this root
  const inRoot = messagesRef.current.filter((m) => {
    let c = m;
    while (c?.parentId) c = idToMsg.get(c.parentId);
    return c?.id === rootId;
  });
  if (!inRoot.length) return rootId;
  // Only consider non-thread (main-chain) messages as candidates for main tail
  const mainOnly = inRoot.filter((m) => !m.isThread);
  if (!mainOnly.length) return rootId;
  const tail = mainOnly.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
  return tail.id;
};