import type { MetadataRoute } from "next";

export default function manifest():MetadataRoute.Manifest{return{name:"Life OS",short_name:"Life OS",description:"A private personal workspace for tasks, school, calendar, and notes.",start_url:"/",scope:"/",display:"standalone",background_color:"#f5f3f1",theme_color:"#c43f4e",orientation:"portrait-primary",icons:[{src:"/favicon.ico",sizes:"any",type:"image/x-icon",purpose:"any"}]};}

