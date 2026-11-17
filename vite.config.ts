import {defineConfig} from 'vite';
export default defineConfig({root:'web',envDir:'..',build:{outDir:'../dist',emptyOutDir:true},server:{port:5173}});
