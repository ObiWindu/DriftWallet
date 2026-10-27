// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Injected EIP-1193 / Solana / CIP-30 provider — relays via window.postMessage channel drift-v1.
// This module exports the shim SOURCES as string templates. The content-script
// injects them into the page world via a <script> tag; nothing here executes
// in the extension world. Keeping them strings lets review.mjs + CSP audits
// scan the exact bytes shipped to dapps.

export const CHANNEL = "drift-v1";

export const EIP1193_SHIM = `(()=>{const ch=${JSON.stringify(CHANNEL)};
if(window.ethereum&&window.ethereum.__drift)return;
const pending=new Map();let seq=0;
function call(method,params){return new Promise((res,rej)=>{const id="r"+(++seq);pending.set(id,{res,rej});
window.postMessage({channel:ch,method,origin:location.origin,payload:params??{},__req:id},"*");});}
window.addEventListener("message",(ev)=>{if(ev.source!==window)return;const d=ev.data;
if(!d||d.channel!==ch||typeof d.__res==="undefined")return;const p=pending.get(d.__res);
if(!p)return;pending.delete(d.__res);if(d.ok)p.res(d.result);else p.rej(new Error(d.error||"request failed"));});
window.ethereum={__drift:true,isMetaMask:false,chainId:"0x1",
request:({method,params})=>call(method,params),on(){},removeListener(){}};})();`;

export const SOLANA_SHIM = `(()=>{const ch=${JSON.stringify(CHANNEL)};
if(window.driftSolana)return;
window.driftSolana={isDrift:true,
connect:()=>new Promise((res,rej)=>{window.postMessage({channel:ch,method:"solana_signTransaction",origin:location.origin,payload:{intent:"connect"}},"*");
function h(ev){if(ev.source!==window||!ev.data||ev.data.channel!==ch)return;window.removeEventListener("message",h);res({publicKey:"Drift111111111111111111111111111111111111"});}window.addEventListener("message",h);}),
signTransaction:(tx)=>new Promise((res,rej)=>{window.postMessage({channel:ch,method:"solana_signTransaction",origin:location.origin,payload:{tx}},"*");}),
signMessage:(msg)=>new Promise((res)=>{window.postMessage({channel:ch,method:"solana_signTransaction",origin:location.origin,payload:{msg}},"*");})};})();`;

export const CARDANO_SHIM = `(()=>{const ch=${JSON.stringify(CHANNEL)};
if(window.cardano&&window.cardano.__drift)return;
window.cardano=Object.assign(window.cardano||{},{__drift:true,drift:{apiVersion:"0.1.0",name:"DriftWallet",
enable:async()=>({signTx:async(tx)=>new Promise((res,rej)=>{window.postMessage({channel:ch,method:"cardano_signTx",origin:location.origin,payload:{tx}},"*");}),getUtxos:async()=>[]})}});})();`;

/** All shims bundled for the content-script <script> injection, in order. */
export const INJECTED_BUNDLE: readonly string[] = [EIP1193_SHIM, SOLANA_SHIM, CARDANO_SHIM];

export function buildInjectedScript(): string {
  return INJECTED_BUNDLE.join("\n");
}
