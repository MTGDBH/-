import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT = "D:/BIGCHUANG/-/deliverables/national_award/elderly_health_national_award.pptx";
const PREVIEW = "D:/BIGCHUANG/-/deliverables/national_award/ppt_build";
const C = {
  bg: "#FBF8F3", ink: "#44362D", muted: "#806F61", orange: "#F3A15D",
  orangeDeep: "#D77A3E", blue: "#4C83C3", purple: "#8066A6", green: "#5B9274",
  line: "#E4D9CC", white: "#FFFFFF", paleBlue: "#E9F1FB", paleOrange: "#FCE9D8",
};
const W = 1280, H = 720;
const page = { left: 76, top: 56, width: 1128, height: 608 };

async function writeBlob(path, blob) { await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer())); }
function box(slide, x, y, w, h, fill = "none", line = C.line, radius = "rounded-xl") {
  const cfg = { geometry: radius === "none" ? "rect" : "roundRect", position: { left:x, top:y, width:w, height:h }, fill, line: { style:"solid", fill:line, width: line === "none" ? 0 : 1 } };
  if (radius !== "none") cfg.borderRadius = radius;
  return slide.shapes.add(cfg);
}
function text(slide, value, x, y, w, h, size=20, color=C.ink, bold=false, align="left") {
  const s = slide.shapes.add({ geometry:"textbox", position:{left:x,top:y,width:w,height:h}, fill:"none", line:{style:"solid",fill:"none",width:0} });
  s.text = value; s.text.style = { fontSize:size, color, bold, alignment:align, fontFamily:"Arial" }; return s;
}
function title(slide, kicker, headline, sub="") {
  text(slide, kicker.toUpperCase(), page.left, 38, 500, 24, 13, C.orangeDeep, true);
  text(slide, headline, page.left, 72, 1080, 58, 36, C.ink, true);
  if (sub) text(slide, sub, page.left, 140, 1060, 34, 18, C.muted, false);
  box(slide, page.left, 188, 1128, 2, C.orange, "none", "none");
}
function footer(slide, n) { text(slide, `老年人健康管理智能体  ·  ${String(n).padStart(2,"0")}`, 76, 686, 500, 18, 11, C.muted); }
function notes(slide, body, sources=[]) { const src = sources.length ? `\n\n[Sources]\n${sources.map(s=>`- ${s}`).join("\n")}` : ""; slide.speakerNotes.textFrame.setText(body + src); slide.speakerNotes.setVisible(true); }
function bullet(slide, items, x, y, w, lineH=36, size=21, color=C.ink) {
  items.forEach((v,i)=>{ text(slide, "•", x, y+i*lineH, 22, lineH, size, C.orangeDeep, true); text(slide, v, x+30, y+i*lineH, w-30, lineH, size, color, false); });
}
function metric(slide, x, y, w, big, label, color=C.orangeDeep) {
  box(slide,x,y,w,110,C.white,C.line,"rounded-xl");
  const bigSize = big.length > 8 ? 24 : 34;
  text(slide,big,x+18,y+15,w-36,56,bigSize,color,true);
  text(slide,label,x+18,y+76,w-36,20,14,C.muted,false);
}
function pill(slide, label, x, y, w, fill, color=C.ink) { box(slide,x,y,w,32,fill,"none","rounded-xl"); text(slide,label,x,y+5,w,20,14,color,true,"center"); }

async function main() {
  await fs.mkdir(PREVIEW, { recursive:true });
  const p = Presentation.create({ slideSize:{width:W,height:H} });
  // 1 cover
  { const s=p.slides.add(); s.background.fill=C.bg; box(s,0,0,W,H,C.bg,"none","none"); box(s,76,98,10,420,C.orange,"none","none"); text(s,"大创项目阶段性汇报",112,104,520,28,16,C.orangeDeep,true); text(s,"让健康数据\n变成老人听得懂的行动",112,166,680,150,48,C.ink,true); text(s,"老年人健康管理智能体：Curve V2 × 疾病风险筛查 × GraphRAG",116,350,710,64,22,C.muted); box(s,858,116,290,390,C.white,C.line,"rounded-xl"); text(s,"真实数据",902,170,190,30,18,C.orangeDeep,true,"center"); text(s,"→",974,225,60,50,42,C.orangeDeep,true,"center"); text(s,"证据图谱",902,290,190,30,18,C.blue,true,"center"); text(s,"→",974,345,60,50,42,C.blue,true,"center"); text(s,"可执行建议",902,410,190,30,18,C.green,true,"center"); text(s,"2026.08  ·  国奖冲刺版",116,604,400,24,15,C.muted); notes(s,"开场：系统的核心不是给出一条看起来漂亮的曲线，而是把真实记录、证据关系和下一步行动连接起来。",["项目代码与验收材料：D:/BIGCHUANG/-/FINAL_DELIVERY.md"]); }
  // 2 problem
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"01  为什么要做","老人真正需要的不是“一个概率”，而是下一步怎么做","现有健康应用常见三个断点：数据、证据和行动没有闭环。"); box(s,80,240,320,260,C.white,C.line,"rounded-xl"); text(s,"数据断点",112,270,250,30,23,C.orangeDeep,true); text(s,"单次测量被当成结论\n步数等行为指标被过度预测\n缺测和异常点被隐藏",112,330,250,110,19,C.ink); box(s,478,240,320,260,C.white,C.line,"rounded-xl"); text(s,"证据断点",510,270,250,30,23,C.blue,true); text(s,"建议缺少适用人群\n关系没有版本和审核状态\n大模型可能把相关说成因果",510,330,250,110,19,C.ink); box(s,876,240,320,260,C.white,C.line,"rounded-xl"); text(s,"行动断点",908,270,250,30,23,C.green,true); text(s,"知道异常，却不知道何时复测\n提醒不能转成待办\n家属和医生无法按授权协同",908,330,250,110,19,C.ink); footer(s,2); notes(s,"把问题从“能不能回答”改成“能不能安全地支持一次行动”。",["reports/national-award-task-matrix-20260821.md"]); }
  // 3 architecture
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"02  总体方案","先把证据和安全门槛固定，再让大模型组织语言","模型负责估计，GraphRAG 负责证据与关系，DeepSeek 不能创造数据。"); const ys=[250,342,434]; const labels=["老人 / 设备 / 手工记录","Curve V2 + 风险模型 + GraphRAG","安全门槛 → DeepSeek → 证据卡片与行动闭环"]; const cols=[C.orange,C.blue,C.green]; ys.forEach((y,i)=>{box(s,210,y,860,66,i===1?C.paleBlue:i===2?"#EAF5EF":C.paleOrange,C.line,"rounded-xl"); text(s,labels[i],240,y+18,800,30,23,cols[i],true,"center"); if(i<2) text(s,"↓",625,y+67,30,28,24,C.muted,true,"center");}); pill(s,"证据先于生成",505,190,180,C.orange,C.white); footer(s,3); notes(s,"强调安全顺序：数据质量和证据治理先于大模型调用。",["D:/BIGCHUANG/-/elderly-health-rag/output/source_manifest.json","D:/BIGCHUANG/-/server/src/ai/agent.js"]); }
  // 4 curve
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"03  Curve V2","曲线不再追求“画得像”，而是解释个人基线与不确定性","观测、趋势、预测三层分离；不足时拒绝预测。"); box(s,78,236,690,350,C.white,C.line,"rounded-xl"); // chart
    const chartX=120, chartY=300, chartW=590, chartH=210; for(let i=0;i<5;i++){box(s,chartX,chartY+i*42,chartW,1,C.line,"none","none");}
    text(s,"mmHg",92,272,70,20,13,C.muted); const pts=[[0,130],[70,123],[140,128],[210,118],[280,126],[350,129],[420,122],[490,125],[560,121]]; for(let i=0;i<pts.length-1;i++){ const [x1,v1]=pts[i],[x2,v2]=pts[i+1]; const y1=chartY+chartH-(v1-100)*3.1, y2=chartY+chartH-(v2-100)*3.1; box(s,chartX+x1,y1,Math.max(2,x2-x1),3,C.orange,"none","none"); }
    pts.forEach(([x,v])=>{ const y=chartY+chartH-(v-100)*3.1; box(s,chartX+x-5,y-5,10,10,C.orangeDeep,"none","rounded-xl"); });
    box(s,chartX+490,chartY+20,100,120,"#DCE9F8","none","none"); text(s,"未来 7 天\n80% 区间",chartX+500,chartY+45,80,50,15,C.blue,true,"center"); text(s,"原始点",140,540,90,22,15,C.orangeDeep,true); text(s,"稳健趋势",258,540,120,22,15,C.blue,true); text(s,"预测带",410,540,100,22,15,C.blue,true);
    box(s,820,236,370,350,C.paleOrange,C.line,"rounded-xl"); text(s,"按指标分层",850,268,280,30,23,C.orangeDeep,true); bullet(s,["血压：收缩压 / 舒张压双序列","血糖：空腹、餐后、随机分组","体重：日/周中位数","步数、睡眠：行为模式，不外推精确日值"],850,324,310,42,18); footer(s,4); notes(s,"曲线展示重点：真实时间戳、个人基线、预测带和拒绝原因。",["D:/BIGCHUANG/-/reports/curve-model-evaluation-2026-08-20.md","D:/BIGCHUANG/-/reports/curve-external-validation-protocol-20260821.md"]); }
  // 5 risk
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"04  疾病风险","XGBoost 不是“万能预测器”，而是和可解释基线并列比较","风险接口用于队列筛查与复测分层，不输出诊断。"); metric(s,96,240,220,"0.6643","高血压严格留出 AUC",C.orangeDeep); metric(s,344,240,220,"0.04319","高血压 Brier",C.blue); metric(s,592,240,220,"4 类","疾病筛查模型",C.green); metric(s,840,240,300,"Bootstrap + 校准 + 决策曲线","扩展审计",C.purple); box(s,96,400,1044,150,C.white,C.line,"rounded-xl"); text(s,"当前证据",126,426,180,26,20,C.orangeDeep,true); text(s,"Logistic 与 XGBoost 在训练集内部交叉验证选择，测试集只做一次严格留出评估；同时报告 Brier、校准分箱、Bootstrap 95% 区间和决策曲线。",126,466,950,48,20,C.ink); text(s,"Wave4→5 AUC：0.5887 / 0.5566 / 0.6205 / 0.6546；\n参与者独立敏感性分析（重叠=0）：0.5402 / 0.5394 / 0.5703 / 0.6377。",126,514,950,40,15,C.muted); footer(s,5); notes(s,"风险模型的价值不是追求单一 AUC，而是告诉用户概率能否支持复测分层，并明确不适用人群。PPT 同时展示严格随机留出、CHARLS 波次时间审计和参与者独立敏感性分析；这些仍不是独立地区外部验证。",["D:/BIGCHUANG/-/ml/reports/national-award-risk-evaluation-20260821.json","D:/BIGCHUANG/-/reports/national-award-risk-temporal-evaluation-20260821.md","D:/BIGCHUANG/-/reports/national-award-risk-temporal-disjoint-evaluation-20260821.md","D:/BIGCHUANG/-/reports/risk-fairness-evaluation-2026-08-20.md"]); }
  // 6 GraphRAG
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"05  GraphRAG","从“相似文本”升级为“证据关系 + 用户上下文”","每条建议都能回答：为什么是这个老人？证据来自哪里？"); metric(s,90,236,190,"78","可追溯来源",C.orangeDeep); metric(s,300,236,190,"159","实体",C.blue); metric(s,510,236,190,"419","关系",C.purple); metric(s,720,236,190,"61","黄金问题",C.green); metric(s,930,236,250,"20/20","配对建议发生变化",C.orangeDeep); box(s,90,390,1090,150,C.white,C.line,"rounded-xl"); text(s,"GraphRAG 的可量化改进",120,420,300,26,20,C.orangeDeep,true); text(s,"必需证据召回 83.6% → 100%\n路径解释率 0% → 100%\n个性化行动变化率 0% → 100%\n急症召回维持 100%",120,462,460,82,19,C.ink); text(s,"普通 RAG 仍有价值：权威来源率 84.4% 高于当前 GraphRAG 83.9%，因此下一步是提升证据排序，而不是夸大图谱优势。",650,428,470,72,18,C.muted); footer(s,6); notes(s,"诚实呈现对照：GraphRAG 的核心提升是路径、上下文和可审计个性化，不把检索改进写成临床疗效。",["D:/BIGCHUANG/-/reports/graphrag-method-comparison-20260821.md","D:/BIGCHUANG/-/reports/graphrag-personalization-pairs-20260821.md","D:/BIGCHUANG/-/reports/graphrag-source-gate-regression-20260821.json","D:/BIGCHUANG/-/elderly-health-rag/output/source_manifest.json"]); }
  // 7 safety
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"06  安全边界","不是所有关系都能直接变成老人建议","未审核高风险关系被挡在老人端；急症关系只保留为安全提示。"); const items=[ ["审核状态","83 条高风险关系全部有 AI 预审意见；66 条仅限健康教育，17 条必须临床确认",C.orangeDeep], ["门槛回归","老人端阻断 16 条未确认边，医生/审计视图保留完整路径；4 个 legacy 来源默认显式标记待复核",C.blue], ["大模型约束","DeepSeek 只能组织工具与 GraphRAG 证据，不能创造指标、日期、概率或剂量",C.green] ]; items.forEach((it,i)=>{const y=235+i*120; box(s,110,y,1050,92,C.white,C.line,"rounded-xl"); box(s,132,y+24,44,44,it[2],"none","rounded-xl"); text(s,String(i+1),132,y+34,44,22,20,C.white,true,"center"); text(s,it[0],202,y+18,220,26,21,it[2],true); text(s,it[1],202,y+50,900,26,18,C.ink);}); footer(s,7); notes(s,"这里要主动说明：AI 预审不是医生签字，真实医疗部署仍需持证人员确认。",["D:/BIGCHUANG/-/reports/medical-pre-review-20260821.md","D:/BIGCHUANG/-/reports/medical-gate-regression-20260821.json","D:/BIGCHUANG/-/reports/graphrag-source-gate-regression-20260821.json"]); }
  // 8 agent loop
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"07  智能体闭环","回答只是起点，复测结果才是下一轮输入","从问题理解到行动完成，系统保留证据和状态。"); const nodes=["理解意图","读取数据","调用工具\n与图谱","安全过滤","DeepSeek\n组织语言","创建待办\n复测反馈"]; nodes.forEach((n,i)=>{const x=82+i*188; if(i<nodes.length-1) box(s,x+128,335,60,3,C.orange,"none","none"); box(s,x,285,128,100,i===4?C.paleBlue:i===3?"#EAF5EF":C.white,C.line,"rounded-xl"); text(s,n,x+10,316,108,48,18,i===4?C.blue:C.ink,true,"center"); if(i<nodes.length-1) text(s,"→",x+143,317,30,22,22,C.orangeDeep,true,"center"); }); text(s,"状态可追溯：建议内容 · 用户确认 · 执行时间 · 复测结果 · 是否解除提醒",245,485,800,30,20,C.muted,true,"center"); footer(s,8); notes(s,"演示时用张奶奶账号走一遍：问最近血压 → 查看证据 → 创建复测 → 完成后回填。",["D:/BIGCHUANG/-/FINAL_DELIVERY.md","D:/BIGCHUANG/-/server/src/ai/agent.js"]); }
  // 9 evaluation
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"08  可复现证据","把“看起来能用”变成可审计的运行记录","每次实验都绑定数据版本、代码版本、模型版本和参数。"); box(s,92,236,500,320,C.white,C.line,"rounded-xl"); text(s,"已通过的本地验收",126,270,380,28,23,C.orangeDeep,true); bullet(s,["Curve V2：28/28","GraphRAG：61题黄金 + 24题改写留出","个性化配对：20/20","Node 工具：22/22","Node 趋势：26/26","最终验收：PASS"],126,326,380,35,18); box(s,650,236,500,320,C.paleBlue,C.line,"rounded-xl"); text(s,"仍需外部完成",684,270,380,28,23,C.blue,true); bullet(s,["持证医生逐条签字","15–30 名老人 + 3–5 名医生盲评","60–90 天真实纵向曲线","带日期独立队列外部验证","学校模板与作者信息确认"],684,326,380,42,18); footer(s,9); notes(s,"这一页把已完成与未完成分开，答辩时不把工程回归冒充临床证据。",["D:/BIGCHUANG/-/reports/national-award-task-matrix-20260821.md","D:/BIGCHUANG/-/reports/graphrag-internal-holdout-20260821.md","D:/BIGCHUANG/-/reports/deepseek-runtime-audit-20260821.md"]); }
  // 10 roadmap
  { const s=p.slides.add(); s.background.fill=C.bg; title(s,"09  冲奖路线","下一步不是继续堆功能，而是补齐外部证据","14 天提交冲刺按“审核—验证—人因—材料”推进。"); const rows=[ ["D1–3","医学审核","4 类核心疾病逐条确认高风险关系"], ["D4–6","实验扩展","60 条问题、三路检索和安全集冻结"], ["D7–9","个性化盲评","不同老人数据→不同证据路径与行动"], ["D10–12","曲线外部验证","按老人隔离、真实日期、拒绝预测"], ["D13–14","材料提交","PPT、总结书、数据卡、模型卡、演示脚本"] ]; rows.forEach((r,i)=>{const y=228+i*70; text(s,r[0],100,y,110,28,18,C.orangeDeep,true); text(s,r[1],240,y,200,28,19,C.ink,true); text(s,r[2],470,y,650,28,18,C.muted); box(s,90,y+43,1040,1,C.line,"none","none");}); footer(s,10); notes(s,"把技术路线落到可验收的外部证据，才能从功能展示升级为研究成果。",["D:/BIGCHUANG/-/reports/national-award-task-matrix-20260821.md","D:/BIGCHUANG/-/reports/human-evaluation-protocol-20260821.md","D:/BIGCHUANG/-/reports/curve-external-validation-protocol-20260821.md"]); }
  // 11 close
  { const s=p.slides.add(); s.background.fill=C.ink; text(s,"一句话总结",88,110,300,30,17,C.orange,true); text(s,"让每一次健康记录，\n都能回到一个安全、可解释、可执行的行动。",88,170,830,150,44,C.white,true); text(s,"Curve V2 解释变化 · 风险模型分层筛查 · GraphRAG 连接证据 · 智能体闭环行动",92,390,850,56,21,"#EBDCCD"); pill(s,"现场演示：张奶奶账号",92,540,220,C.orange,C.ink); text(s,"谢谢",1040,596,120,40,27,C.orange,true,"right"); notes(s,"收束：邀请评委关注同一问题在不同老人数据下的证据路径和行动差异。",["D:/BIGCHUANG/-/FINAL_DELIVERY.md"]); }
  for (const [i,s] of p.slides.items.entries()) { const png=await p.export({slide:s,format:"png",scale:1}); await writeBlob(`${PREVIEW}/slide-${String(i+1).padStart(2,"0")}.png`,png); }
  await writeBlob(`${PREVIEW}/deck-montage.webp`, await p.export({format:"webp",montage:true,scale:1}));
  const pptx=await PresentationFile.exportPptx(p); await pptx.save(OUT);
  console.log(JSON.stringify({slides:p.slides.items.length, output:OUT}));
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
