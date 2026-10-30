/**
 * [INPUT]: 已脱敏的健康设置、原版表单样式和日程组件。
 * [OUTPUT]: 同一健康页的同步、训练偏好与晨间时间表单。
 * [POS]: 云端设置适配；OAuth维护保留在私有回环入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function cloudSettings(state,{esc,icon,reportSettings}){
  const s=state.status,cfg=s.settings;
  return `<div class="settings-grid"><div class="stack"><section class="panel"><div class="panel-head"><h2>WHOOP 接入</h2><span class="badge">${s.connected?'已连接':'需要重新连接'}</span></div><p class="engine-copy">手环同步到 WHOOP 后，由常驻服务每30分钟更新。电脑关机不会中断同步。授权密钥不会发送到浏览器。</p><div class="form-row"><label class="field">同步范围<select id="sync-range"><option value="90">最近90天</option><option value="14">最近14天</option><option value="180">最近180天</option><option value="365">最近365天</option></select></label><div class="field" style="justify-content:end"><button class="btn primary" data-action="sync" ${!s.connected||s.syncing?'disabled':''}>${icon('refresh')}立即同步</button></div></div><p class="inline-note">历史删除尚不自动镜像。重新授权通过安全本机入口完成。</p></section>${reportSettings(cfg)}</div>
  <div class="stack"><section class="panel"><h2>你的健康方向</h2><form id="profile-form"><label class="field">当前目标<select name="goal">${['提升体能与恢复','改善睡眠与精力','减脂并保持肌肉','增肌与力量'].map(g=>`<option ${cfg.goal===g?'selected':''}>${g}</option>`).join('')}</select></label><label class="field">训练经历<select name="experience">${['初学 / 重新开始','规律训练','长期训练'].map(g=>`<option ${cfg.experience===g?'selected':''}>${g}</option>`).join('')}</select></label><label class="field">身体限制或已有医嘱<textarea name="constraints" maxlength="1000" placeholder="例如：膝盖不适，暂时避免跑步">${esc(cfg.constraints)}</textarea></label><p class="inline-note">未填写不等于没有限制。身体感受与医嘱优先于手环分数。</p><button type="submit" class="btn">${icon('check')}保存健康方向</button></form></section><section class="panel"><h2>每天早上的计划</h2><p class="engine-copy">沿用设置时间，在当天睡眠和恢复评分就绪、同步成功后发布。上午12点前通过微信投递一次；数据未到则等待，不使用昨日分数增加训练。</p><p class="inline-note">需有24小时内的微信会话。原始记录和报告修订保留，页面继续使用密码加动态码。</p></section></div></div>`;
}
