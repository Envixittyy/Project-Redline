"use client";

import { AlertTriangle, CheckCircle2, CloudOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { flushOfflineMutations, listOfflineMutations, subscribeOfflineQueue, type OfflineMutation } from "@/lib/offline/queue";

import styles from "./pwa-client.module.css";

export function PwaClient(){const[online,setOnline]=useState(true);const[items,setItems]=useState<OfflineMutation[]>([]);const[syncing,setSyncing]=useState(false);useEffect(()=>{if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(error=>console.error("[pwa] service worker registration failed:",error));const refresh=()=>{setOnline(navigator.onLine);void listOfflineMutations().then(setItems);};refresh();const unsubscribe=subscribeOfflineQueue(refresh);const sync=async()=>{if(!navigator.onLine)return;setSyncing(true);await flushOfflineMutations();refresh();setSyncing(false);};window.addEventListener("online",sync);void sync();return()=>{unsubscribe();window.removeEventListener("online",sync);};},[]);const failed=items.some(item=>item.state==="failed"||item.state==="conflict");if(online&&!items.length)return null;return <aside className={styles.status} role="status" data-state={!online?"offline":failed?"failed":syncing?"syncing":"pending"}>{!online?<CloudOff size={15}/>:failed?<AlertTriangle size={15}/>:syncing?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>}<span>{!online?`Offline · ${items.length} pending`:failed?"Offline changes need attention":syncing?"Syncing offline changes":`${items.length} pending`}</span>{online&&items.length?<button type="button" onClick={()=>void flushOfflineMutations()}>Retry</button>:null}</aside>}

