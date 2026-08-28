export function MarkdownPreview({ source }:{source:string}) {
  const lines=source.split(/\r?\n/); const nodes:React.ReactNode[]=[]; let list:string[]=[];
  const flush=()=>{if(list.length){nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item,index)=><li key={index}>{inline(item)}</li>)}</ul>);list=[];}};
  for(const line of lines){if(line.startsWith("- ")){list.push(line.slice(2));continue;}flush();if(line.startsWith("### "))nodes.push(<h4 key={nodes.length}>{inline(line.slice(4))}</h4>);else if(line.startsWith("## "))nodes.push(<h3 key={nodes.length}>{inline(line.slice(3))}</h3>);else if(line.startsWith("# "))nodes.push(<h2 key={nodes.length}>{inline(line.slice(2))}</h2>);else if(line.trim())nodes.push(<p key={nodes.length}>{inline(line)}</p>);else nodes.push(<br key={nodes.length}/>);}flush();
  return <>{nodes}</>;
}
function inline(value:string){const parts=value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);return parts.map((part,index)=>part.startsWith("**")&&part.endsWith("**")?<strong key={index}>{part.slice(2,-2)}</strong>:part.startsWith("`")&&part.endsWith("`")?<code key={index}>{part.slice(1,-1)}</code>:part);}

