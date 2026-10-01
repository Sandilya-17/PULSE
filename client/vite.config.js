import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import ssl from '@vitejs/plugin-basic-ssl';
const t='http://localhost:4000';
export default defineConfig({plugins:[react(),ssl()],server:{host:true,proxy:{'/api':t,'/uploads':t,'/socket.io':{target:t,ws:true}}}});
