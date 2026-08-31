#!/usr/bin/env node
// Actual React review UIs with synthetic server/model responses. No account or real writes.
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const stubs = `
let checklist = {batchId:'checklist-1',taskTitle:'Canonical saved essay',items:['Read brief','Write draft'],status:'proposed'};
let course = {batchId:'course-1',fileName:'course-smoke.txt',startDate:'2026-08-31',timeZone:'Asia/Manila',status:'proposed',proposal:{code:'CS101',name:'Computer science',instructor:null,location:'Hall A',meetings:[{title:'Lecture',weekdays:[1,3],startTime:'09:00',endTime:'10:00',location:null}]}};
let attempts=0;
function log(s) { const node=document.getElementById('calls'); node.textContent += '\\n'+s; }
export function getCompanionSession(){return {provider:'ollama',model:'fixture'}};
export async function inferLocalContent(config, request){ log('inference: '+request.prompt); return '{}'; }
export async function prepareTaskChecklistAction(id){log('checklist prepare ID only: '+id);return {ok:true,prepared:{requestId:'task-request',inference:{prompt:'canonical task fixture',model:'fixture'}}}};
export async function finalizeTaskChecklistAction(){ log('checklist finalized, no apply'); return {ok:true,review:checklist}; }
export async function reviseTaskChecklistAction(id,items){log('checklist revision, no apply'); checklist={...checklist,batchId:'checklist-2',items}; return {ok:true,review:checklist};}
export async function applyAiProposalAction(id){log('checklist APPLY ID only: '+id); attempts++;return attempts===1?{ok:false,message:'Synthetic stale proposal; no changes.'}:{ok:true};}
export async function rejectAiProposalAction(id){log('checklist reject: '+id);return {ok:true};}
export async function prepareCourseImportAction(form){log('course selected file: '+form.get('file').name);return {ok:true,prepared:{requestId:'course-request',inference:{prompt:'canonical document fixture',model:'fixture'}}};}
export async function finalizeCourseImportAction(){log('course finalized, no apply'); return {ok:true,review:course};}
export async function reviseCourseImportAction(id,proposal){log('course revision, no apply');course={...course,batchId:'course-2',proposal};return {ok:true,review:course};}
export async function applyCourseImportAction(id){log('course APPLY ID only: '+id);return {ok:true};}
export async function rejectCourseImportAction(id){log('course reject: '+id);return {ok:true};}
export async function readWorkloadAction(){return {ok:true,measuredAt:'2026-08-31T04:00:00Z',workload:{classesToday:3,remainingTasks:17,dueToday:5,overdue:2}};}
export async function checkCompanionHealth(){return {ok:false};}
export function useRouter(){return {push:(href)=>log('navigate '+href)}};
`;
const entry = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {TaskChecklistProposal} from './src/features/tasks/task-checklist-proposal';
import {CourseImportModal} from './src/features/school/course-import-modal';
import {CommandPalette,CommandPaletteTrigger} from './src/components/shell/command-palette';
function App(){const [open,setOpen]=useState(false);return <main><h1>Synthetic review UI verification</h1><p>Actual components. Synthetic actions/model only. No account, production data, or writes.</p><CommandPaletteTrigger/><CommandPalette/><TaskChecklistProposal task={{id:'task-fixture',title:'Unsaved browser title'}}/><button onClick={()=>setOpen(true)}>Open course import fixture</button>{open&&<CourseImportModal onClose={()=>setOpen(false)}/>}<h2>Fixture action log</h2><pre id="calls">Ready</pre></main>}
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true,
  write: false,
  outdir: "out",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(b) {
        b.onResolve(
          {
            filter:
              /checklist-actions$|ai-actions$|course-import-actions$|personality-actions$|companion-session$|companion-client$|^next\/navigation$/,
          },
          () => ({ path: "fixtures", namespace: "synthetic" }),
        );
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
          contents: stubs,
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css =
  readFileSync("src/styles/tokens.css", "utf8") +
  "\n" +
  readFileSync("src/styles/motion.css", "utf8") +
  "\n" +
  bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const page = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
  } else if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="en" data-motion="reduced"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI review fixture</title><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{font:16px system-ui;background:var(--canvas);color:var(--text-primary);padding:1rem}main{max-width:48rem;margin:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{min-height:44px}dialog p{font-size:14px}</style><div id="root"></div><script src="/app.js"></script></html>',
    );
  }
});
await new Promise((resolve) => page.listen(3000, "127.0.0.1", resolve));
console.log(
  "Synthetic review UIs ready at http://localhost:3000. Stops after 10 minutes.",
);
const stop = () => {
  page.closeAllConnections();
  page.close();
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
setTimeout(stop, 600000).unref();
