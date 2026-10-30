/**
 * [INPUT]: 财务图表配置及当前访问模式。
 * [OUTPUT]: 访客图表的固定金额符号、轴标签和提示框。
 * [POS]: 财务可视化的统一呈现边界，不承载真实金额。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {EChartsOption} from 'echarts';
import {isVisitor} from '../../../access';
import {escapeHtml} from './format';
export function financialOption(option:EChartsOption):EChartsOption{
 if(!isVisitor())return option;
 const axis=(value:any):any=>Array.isArray(value)?value.map(axis):value?{...value,axisLabel:{...value.axisLabel,formatter:value.type==='category'?value.axisLabel?.formatter:()=> '••••'}}:value;
 const tooltip=(value:any):any=>Array.isArray(value)?value.map(tooltip):{...value,formatter:(p:any)=>{
  const first=Array.isArray(p)?p[0]:p;
  return `${escapeHtml(first?.name||first?.axisValueLabel||'财务展示')}<br/>金额：••••<br/>示意图，不代表真实金额或比例`;
 },valueFormatter:()=> '••••'};
 return {...option,xAxis:axis(option.xAxis),yAxis:axis(option.yAxis),tooltip:tooltip(option.tooltip),
  series:Array.isArray(option.series)?option.series.map((series:any)=>({...series,label:{...series.label,formatter:()=> '••••'}})):option.series};
}
