# 老年人健康管理系统：四阶段最终交付说明

## 交付范围

1. **时间趋势**：对血压、心率、体重、血糖等具有相对连续性的指标进行稳健历史拟合和保守 0–30 天外推；步数、睡眠只做行为趋势，不做精确医学预测。输出原始点、清洗点、拟合线、预测点、预测上下界、异常点、可信度和数据门槛原因。
2. **疾病风险**：用 CHARLS Wave1→Wave2 的新发结局训练四类两年筛查模型；Logistic 与 XGBoost 使用训练集交叉验证选择，测试集只做最终评估，概率经校准并输出缺失特征和模型卡。
3. **GraphRAG**：疾病指南 Markdown → 可复现索引 → 实体/关系/疾病社区 → 关键词+图邻域检索。每个回答依据带来源文件、章节、证据等级和免责声明。
4. **智能体**：DeepSeek 负责自然语言解释，后端按意图调用趋势、风险和知识工具；用户数据由服务端按登录身份读取，预测与常识分开，数据不足时禁止编造。

## 验收命令

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\ml\curve\test_health_curve.py
& $py D:\BIGCHUANG\-\ml\disease_risk\test_multidisease.py
& $py D:\BIGCHUANG\-\elderly-health-rag\test_graphrag.py
```

Node 端使用 Node 22 启动 `server/src/index.js`，登录张奶奶后依次验证：趋势问题、疾病风险问题、知识解释问题、`/api/chat/history` 和四个疾病预测接口。

## 医疗安全边界

模型结果是队列筛查，不是诊断；GraphRAG 条目目前标记为演示知识，必须经专业人员审核后才能用于真实医疗场景。任何胸痛、呼吸困难、意识改变、单侧无力或言语含糊等危险信号都应直接建议急救，不等待模型预测。
