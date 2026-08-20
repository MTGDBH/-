# 老年人健康管理系统：四阶段最终交付说明

## 交付范围

1. **时间趋势**：对血压、心率、体重、血糖等具有相对连续性的指标进行稳健历史拟合和保守 0–30 天外推；步数、睡眠只做行为趋势，不做精确医学预测。输出原始点、清洗点、拟合线、预测点、预测上下界、异常点、可信度和数据门槛原因。
2. **疾病风险**：用 CHARLS Wave1→Wave2 的新发结局训练四类两年筛查模型；Logistic 与 XGBoost 使用训练集交叉验证选择，测试集只做最终评估，概率经校准并输出缺失特征和模型卡。
3. **GraphRAG**：WHO、AHA/ASA、ADA、随机试验和系统综述等 14 份知识源 → 可复现索引 → 63 个实体/218 条显式与词法关系/疾病社区 → 关键词+图邻域检索。每个回答依据带来源、章节、证据等级、关系链和免责声明。
4. **智能体**：DeepSeek 负责自然语言解释，后端按意图调用健康摘要、趋势、行为模式、设备、风险和 GraphRAG 知识工具；用户数据由服务端按登录身份读取，预测与常识分开，数据不足时禁止编造。

## 验收命令

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\ml\curve\test_health_curve.py
& $py D:\BIGCHUANG\-\ml\disease_risk\test_multidisease.py
& $py D:\BIGCHUANG\-\elderly-health-rag\test_graphrag.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_personalization.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_graph.py
node D:\BIGCHUANG\-\server\data\evaluate_risk_personalization.mjs
node D:\BIGCHUANG\-\server\data\test_risk_profile.mjs
node D:\BIGCHUANG\-\server\data\test_actions.mjs
node D:\BIGCHUANG\-\server\data\test_care_permissions.mjs
node D:\BIGCHUANG\-\server\data\test_device_sync.mjs
node D:\BIGCHUANG\-\server\data\test_health_summary.mjs
node D:\BIGCHUANG\-\server\data\test_trend_alerts.mjs
node D:\BIGCHUANG\-\server\data\test_agent_tools.mjs
node D:\BIGCHUANG\-\server\data\test_graph_grounding.mjs
```

Node 端使用 Node 22 启动 `server/src/index.js`，登录张奶奶后依次验证：趋势问题、疾病风险问题、知识解释问题、`/api/chat/history` 和四个疾病预测接口。风险接口同时返回 `data_completeness`，说明缺失字段和建议补采内容；智能体证据卡片由后端真实上下文生成。

当前闭环模块还包括：

- 智能体建议可创建待办/复测；敏感行动需要确认并记录执行状态；
- “最近身体怎么样”会批量读取近 90 天指标、行为、缺失项、待办和预警，并在回复下方生成后端证据卡片；证据随对话持久化，刷新或打开新对话仍可回看；
- 指标保存后仅在异常或明显趋势时异步生成主动提醒，同一指标/提醒类型 24 小时去重；
- “有哪些待处理提醒”会调用只读预警工具；“帮我明早测血压/通知家属/联系医生”先生成带行动类型的计划，只有点击并确认后才写入行动闭环；
- 老人一次性授权家属或医生，只允许授权关系读取只读健康摘要；
- 蓝牙/模拟设备统一通过 `/api/devices/:id/sync` 写入 `metrics.source=device`，智能体可查询同步状态；
- 注销账号会按外键依赖清理会话、健康记录、授权关系、行动和提醒数据。

## 医疗安全边界

模型结果是队列筛查，不是诊断；GraphRAG 条目目前标记为演示知识，必须经专业人员审核后才能用于真实医疗场景。任何胸痛、呼吸困难、意识改变、单侧无力或言语含糊等危险信号都应直接建议急救，不等待模型预测。
