/**
 * [INPUT]: 专用WHOOP工作库、回环HTTP、云端出口与systemd私有环境。
 * [OUTPUT]: 唯一令牌刷新进程、30分钟同步、晨间报告和受限操作队列。
 * [POS]: VPS组合根；不启动微信接收器，不读取Antigravity凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createApp } from './index.mjs';
import { CloudBridge } from './cloud.mjs';
process.umask(0o077);
const log=(event,fields={})=>process.stdout.write(JSON.stringify({event,...fields})+'\n');
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OWNER_AUTH_ID','DATA_DIR'];
if(required.some(k=>!process.env[k]))throw new Error('WHOOP_CLOUD_CONFIG_MISSING');
const app=createApp();
const bridge=new CloudBridge(app,{url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,ownerId:process.env.OWNER_AUTH_ID});
let stopped=false,lastSync=0,lastPublish=0,changes=-1,current,running=Promise.resolve();
async function step(){
  if(stopped)return;
  try{
    if(Date.now()-lastSync>=30*60000){
      lastSync=Date.now();
      if(app.store.get('tokens')){
        try{await app.whoop.sync(app.store.get('profile')?14:90);log('whoop_sync_succeeded');}
        catch{log('whoop_sync_failed');}
      }
    }
    await app.reports.tick();
    await bridge.job();
    const n=app.store.db.prepare('select total_changes() n').get().n;
    if(n!==changes||Date.now()-lastPublish>=5*60000){
      const result=await bridge.publish();changes=n;lastPublish=Date.now();log('whoop_published',result);
    }
    const sent=await bridge.morning();if(sent?.queued)log('whoop_morning_queued');
  }catch{log('whoop_cloud_cycle_failed');}
  if(!stopped)current=setTimeout(()=>{running=step();},10000);
}
app.server.listen(app.config.port,'127.0.0.1',()=>{log('whoop_ready');running=step();});
app.server.on('error',()=>{log('whoop_listener_failed');process.exitCode=1;});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
  stopped=true;clearTimeout(current);
  await running;await app.whoop.syncing;
  app.server.close(()=>{app.store.close();process.exit(0);});
});
