// 经过权威来源整理的扩展知识。默认“待审核”，只能作为研究预览。
export const KNOWLEDGE_EXPANSION_VERSION = 'knowledge-expansion.2026-08-23.v1';

export const expandedKnowledgeArticles = [
  {
    category: 'qa', title: '起身头晕，为什么还要关注跌倒风险？',
    summary: '起身后的头晕、血压变化、用药情况和跌倒风险需要一起看。',
    body: `## 先做什么\n\n起身后头晕时先坐稳或扶稳，不要急着走动。记录发生时间、持续多久，以及当时是否刚起床、刚服药或饮水较少。\n\n## 为什么要一起看\n\n体位变化时血压下降、引起困倦或头晕的药物，以及步态和平衡问题，都可能增加跌倒风险。一次头晕不能自行确定原因，需要结合规范测量和专业评估。\n\n## 下一步\n\n反复出现时可记录坐位与站立后的血压和症状，并请医生或药师复核用药。不要自行停药或改剂量。`,
    tags: ['头晕', '跌倒', '血压', '用药安全'], audience: 'senior', views: 0,
    source_label: 'CDC STEADI 药学照护资料（2025）', source_url: 'https://www.cdc.gov/steadi/hcp/clinical-resources/pharmacy-care.html',
  },
  {
    category: 'topic', title: '视力变化为什么会影响居家安全？',
    summary: '看不清台阶、光线不足和慢性病可能共同增加跌倒与独处风险。',
    body: `## 不只是“眼睛的问题”\n\n视力下降会影响辨认台阶、障碍物和药品标签，也可能减少外出与社交。居家照明、通道障碍、慢性病和部分药物因素需要一并检查。\n\n## 可以记录什么\n\n记录看不清的具体场景、是否在昏暗环境发生、最近是否更换眼镜，以及是否伴头晕或跌倒。突然出现视力明显变化时应及时就医。`,
    tags: ['视力', '跌倒', '居家安全', '社会支持'], audience: 'senior', views: 0,
    source_label: 'CDC 老年视力与跌倒预防（2024）', source_url: 'https://www.cdc.gov/vision-health/prevention/older-adult-falls.html',
  },
  {
    category: 'qa', title: '睡眠变差时，还要留意哪些白天表现？',
    summary: '睡眠变化需要结合白天困倦、情绪、认知和心脑血管情况综合判断。',
    body: `## 建议一起记录\n\n除了入睡时间和睡眠时长，还可记录白天困倦、注意力变化、情绪、打鼾或憋醒，以及这些变化持续了多久。\n\n## 为什么不能只看一晚\n\n睡眠障碍和睡眠紊乱与脑健康及心脑血管风险存在关联，但单次睡不好不能说明患有某种疾病。若持续影响白天活动，或出现夜间呼吸异常，应咨询专业人员。`,
    tags: ['睡眠', '脑健康', '认知', '情绪'], audience: 'senior', views: 0,
    source_label: '美国心脏协会睡眠与脑健康科学声明（2024）', source_url: 'https://pubmed.ncbi.nlm.nih.gov/38235581/',
  },
  {
    category: 'topic', title: '营养、肌力和活动为什么要一起看？',
    summary: '体重变化、食欲、握力、行走和日常活动能共同反映功能变化。',
    body: `## 一个指标不够\n\n老年人的营养状态、肌力、活动能力和日常生活功能会相互影响。只看体重可能遗漏食欲下降、肌力变弱或活动减少。\n\n## 居家可观察线索\n\n留意近期非主动体重下降、吃饭变少、提物困难、走路变慢和从椅子起身更费力。发现连续变化时应进行营养和功能评估，而不是自行大量补充保健品。`,
    tags: ['营养', '肌力', '活动', '衰弱'], audience: 'senior', views: 0,
    source_label: 'WHO ICOPE 老年整合照护指南（2017）', source_url: 'https://www.who.int/publications/i/item/9789241550109',
  },
  {
    category: 'qa', title: '记忆担忧和低血糖为什么要一起告诉家属？',
    summary: '认知变化可能影响用药与进食，低血糖又可能加重混乱和照护难度。',
    body: `## 两方面会互相影响\n\n记忆或执行能力变化可能让按时进食、测量和用药变得困难；低血糖也可能表现为出汗、发抖、反应变慢或意识混乱。\n\n## 更安全的做法\n\n把发生时间、当时血糖、进食和用药情况记录下来，并让可信任的家属或照护者知道。治疗目标和方案应由专业人员结合功能与照护支持调整，不要自行改药。`,
    tags: ['糖尿病', '低血糖', '认知', '家属协助'], audience: 'senior', views: 0,
    source_label: 'ADA 老年糖尿病照护标准（2026）', source_url: 'https://diabetesjournals.org/care/article/49/Supplement_1/S277/163921/13-Older-Adults-Standards-of-Care-in-Diabetes-2026',
  },
  {
    category: 'topic', title: '听力、情绪和认知，为什么不能分开看？',
    summary: '听不清、情绪低落和记忆担忧可能相互影响交流与评估结果。',
    body: `## 先排除交流障碍\n\n听力下降可能让老人少参与交流，也可能影响认知筛查时对问题的理解。情绪低落同样可能影响注意力、活动和社交。\n\n## 综合观察\n\n记录听不清的场景、情绪和兴趣变化、记忆担忧，以及这些变化对日常生活的影响。正式认知结论需要规范评估，普通记忆担忧不能直接当作量表分数。`,
    tags: ['听力', '情绪', '认知', '社会支持'], audience: 'senior', views: 0,
    source_label: 'WHO ICOPE 老年整合照护指南（2017）', source_url: 'https://www.who.int/publications/i/item/9789241550109',
  },
  {
    category: 'tip', title: '多种药一起吃，怎样安全地做药物复核？',
    summary: '准备完整药物清单，重点记录头晕、困倦和跌倒等变化。',
    body: `## 复核前准备\n\n把处方药、非处方药和保健品都列出来，写清名称、用法和最近变化，同时记录头晕、困倦、站立不稳或跌倒。\n\n## 需要专业人员确认\n\n请医生或药师判断药物之间以及药物与症状的关系。不要因为看到风险提示就自行停药、减量或换药。`,
    tags: ['多重用药', '药物复核', '跌倒'], audience: 'senior', views: 0,
    source_label: 'CDC STEADI 药学照护资料（2025）', source_url: 'https://www.cdc.gov/steadi/hcp/clinical-resources/pharmacy-care.html',
  },
  {
    category: 'topic', title: '老人综合健康评估要看哪几个方面？',
    summary: '慢病之外，还应覆盖功能、情绪、认知、跌倒、营养和照护支持。',
    body: `## 不只看化验单\n\n老年健康评估通常还要了解日常生活能力、活动和跌倒、情绪与认知、营养、用药、疼痛以及家属或照护支持。\n\n## 用于发现问题，不替代诊断\n\n综合评估帮助发现需要进一步核实的变化，并据此安排复测或咨询。筛查结果不是诊断，急症信号也不能等待长期风险评估。`,
    tags: ['综合评估', '功能', '情绪', '认知', '照护支持'], audience: 'senior', views: 0,
    source_label: 'ADA 老年糖尿病照护标准（2026）', source_url: 'https://diabetesjournals.org/care/article/49/Supplement_1/S277/163921/13-Older-Adults-Standards-of-Care-in-Diabetes-2026',
  },
].map(article => ({ ...article, review_status: 'pending', review_version: KNOWLEDGE_EXPANSION_VERSION }));
