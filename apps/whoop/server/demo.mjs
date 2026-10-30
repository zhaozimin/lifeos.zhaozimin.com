/**
 * [INPUT]: 依赖当前日期；模拟 WHOOP v2 字段与关联键。
 * [OUTPUT]: 导出 makeDemo；返回内存数据集与示例身体测量。
 * [POS]: server 的演示源；只走分析层，绝不进入持久化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function makeDemo(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const dayMs = 86400000;
  const dataset = { cycles: [], recoveries: [], sleeps: [], workouts: [] };
  for (let i = 89; i >= 0; i--) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * dayMs)
      .toISOString()
      .slice(0, 10);
    const seed = 89 - i;
    const wave = Math.sin(seed * 1.37);
    const recovery =
      i === 0 ? 78 : Math.round(65 + wave * 22 + Math.cos(seed * 0.41) * 10);
    const hours = i === 0 ? 7.75 : 7.25 + Math.sin(seed * 0.87) * 0.95;
    const id = 10000 + seed;
    const sleepId = `demo-sleep-${id}`;
    const end = `${date}T07:10:00Z`;
    const start = new Date(
      Date.parse(end) - (hours + 0.45) * 3600000,
    ).toISOString();
    const strain = i === 0 ? 8.4 : Math.max(3, 10.8 + wave * 4.8);
    dataset.cycles.push({
      id,
      user_id: 1,
      created_at: end,
      updated_at: end,
      start: end,
      end: i === 0 ? null : new Date(Date.parse(end) + dayMs).toISOString(),
      timezone_offset: "Z",
      score_state: "SCORED",
      score: {
        strain,
        kilojoule: 8700 + wave * 1300,
        average_heart_rate: 68,
        max_heart_rate: 159,
      },
      step_count: Math.round(7200 + wave * 2600),
    });
    dataset.recoveries.push({
      cycle_id: id,
      sleep_id: sleepId,
      user_id: 1,
      created_at: end,
      updated_at: end,
      score_state: "SCORED",
      score: {
        user_calibrating: false,
        recovery_score: recovery,
        resting_heart_rate: i === 0 ? 54 : 57 - wave * 4,
        hrv_rmssd_milli: i === 0 ? 68 : 57 + wave * 13 + seed / 14,
        spo2_percentage: 97.6,
        skin_temp_celsius: 33.5,
      },
    });
    dataset.sleeps.push({
      id: sleepId,
      cycle_id: id,
      user_id: 1,
      created_at: end,
      updated_at: end,
      start,
      end,
      timezone_offset: "Z",
      nap: false,
      score_state: "SCORED",
      score: {
        stage_summary: {
          total_light_sleep_time_milli: hours * 0.51 * 3600000,
          total_slow_wave_sleep_time_milli: hours * 0.23 * 3600000,
          total_rem_sleep_time_milli: hours * 0.26 * 3600000,
          total_awake_time_milli: 0.45 * 3600000,
          total_no_data_time_milli: 0,
          total_in_bed_time_milli: (hours + 0.45) * 3600000,
          disturbance_count: 8,
          sleep_cycle_count: 5,
        },
        sleep_needed: {
          baseline_milli: 7.8 * 3600000,
          need_from_sleep_debt_milli: 0.15 * 3600000,
          need_from_recent_strain_milli: 0.2 * 3600000,
          need_from_recent_nap_milli: 0,
        },
        respiratory_rate: 14.2 + wave * 0.3,
        sleep_performance_percentage: Math.min(
          100,
          Math.round((hours / 8.15) * 100),
        ),
        sleep_efficiency_percentage: (hours / (hours + 0.45)) * 100,
        sleep_consistency_percentage: 84,
      },
    });
    if (i % 3 !== 1 && i !== 0) {
      const minutes = 30 + (seed % 4) * 10;
      dataset.workouts.push({
        id: `demo-workout-${id}`,
        start: `${date}T17:00:00Z`,
        end: new Date(
          Date.parse(`${date}T17:00:00Z`) + minutes * 60000,
        ).toISOString(),
        timezone_offset: "Z",
        sport_name: ["跑步", "力量训练", "骑行"][seed % 3],
        score_state: "SCORED",
        score: {
          strain: strain * 0.8,
          average_heart_rate: 126 + (seed % 12),
          max_heart_rate: 162,
          kilojoule: 1300 + (seed % 5) * 120,
          percent_recorded: 99.6,
          zone_durations: {
            zone_zero_milli: 0,
            zone_one_milli: minutes * 0.2 * 60000,
            zone_two_milli: minutes * 0.5 * 60000,
            zone_three_milli: minutes * 0.3 * 60000,
            zone_four_milli: 0,
            zone_five_milli: 0,
          },
        },
      });
    }
  }
  return {
    dataset,
    body: { height_meter: 1.78, weight_kilogram: 72.5, max_heart_rate: 185 },
  };
}
