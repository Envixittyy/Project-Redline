import type { MetadataRoute } from "next";

export default function manifest():MetadataRoute.Manifest{return{name:"Forward",short_name:"Forward",description:"A private personal command center. Be curious, not judgmental.",start_url:"/",scope:"/",display:"standalone",background_color:"#111827",theme_color:"#2563eb",orientation:"portrait-primary",icons:[{src:"/favicon.ico",sizes:"any",type:"image/x-icon",purpose:"any"}]};}
