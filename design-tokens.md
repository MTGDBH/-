# 设计令牌（Design Tokens）

所有视觉常量都沉淀在 `assets/css/styles.css` 的 `:root` 里，改一处全站生效。

## 颜色

### 中性
| Token | 值 | 用途 |
|---|---|---|
| `--bg-page` | `#FAF6EF` | 页面底色（暖米） |
| `--bg-card` | `#FFFFFF` | 卡片底色 |
| `--bg-topbar` | `#FFFFFF` | 顶部栏底色 |
| `--bg-soft` | `#FAF0E1` | 浅米色辅助背景 |
| `--border` | `#EDE5DA` | 分割线/边框 |

### 品牌
| Token | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#F4A261` | 主色（暖杏）—— CTA、激活态、关键数字 |
| `--color-primary-light` | `#FFE9D9` | 主色浅（数据卡背景、hover 态） |
| `--color-primary-dark` | `#E0784E` | 主色深（强调文字） |

### 数据语义
| Token | 值 | 用途 |
|---|---|---|
| `--color-green` | `#7FB069` | 健康/良好（步数、睡眠、设备在线） |
| `--color-green-light` | `#E5F0DC` | 健康背景 |
| `--color-green-dark` | `#5A8045` | 健康文字 |
| `--color-coral` | `#E8896E` | 提醒/异常（心率、异常项、用药） |
| `--color-coral-light` | `#FBE4DD` | 提醒背景 |
| `--color-coral-dark` | `#A04632` | 提醒文字 |
| `--color-purple` | `#9C7BC9` | 心电/睡眠（辅助语义色） |
| `--color-purple-light` | `#F1E8F5` | 紫色背景 |
| `--color-teal` | `#3E8E8E` | 血氧 |
| `--color-teal-light` | `#E0F0F0` | 血氧背景 |

### 文字
| Token | 值 | 用途 |
|---|---|---|
| `--text-primary` | `#3D2E1F` | 标题/重要正文（深棕） |
| `--text-secondary` | `#6B5A4A` | 次要正文（中棕） |
| `--text-muted` | `#9C8B7A` | 弱化/时间戳 |
| `--text-on-primary` | `#FFFFFF` | 主色背景上的文字 |

## 阴影（柔和暖色系）

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 2px 8px rgba(61,46,31,0.04)` | 卡片默认 |
| `--shadow-md` | `0 4px 16px rgba(61,46,31,0.06)` | hover 抬起 |
| `--shadow-lg` | `0 8px 24px rgba(61,46,31,0.08)` | 弹窗/聚焦 |

## 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `8px` | 小标签 |
| `--radius-md` | `12px` | 图标方块、按钮 |
| `--radius-lg` | `16px` | 数据卡、列表项 |
| `--radius-xl` | `20px` | 快捷卡、CTA |
| `--radius-2xl` | `24px` | 区块卡 |
| `--radius-3xl` | `28px` | 大卡片 |
| `--radius-full` | `999px` | 胶囊徽章、头像 |

## 间距

| Token | 值 |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |

## 字号（参考）

老人版优先大字号，重点参考：

| 场景 | 字号 | 字重 |
|---|---|---|
| 页面标题 | 28px | 700 |
| 问候语 | 28px | 700 |
| 卡片标题 | 18-22px | 700 |
| 大数字（健康分） | 96px | 700 |
| 中数字（子项分） | 30px | 700 |
| 标签 | 14-16px | 500 |
| 提示/时间 | 12-13px | 400 |
| 正文 | 14-15px | 400/500 |

## 字体栈

```css
font-family: "Source Han Sans CN", "Noto Sans SC", "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system,
             sans-serif;
```

## 8 种数据卡配色约定

监测页 8 个数据卡（`monitoring.html`），按指标性质分配颜色，保持视觉一致：

| 指标 | 图标字 | 背景 | 文字色 |
|---|---|---|---|
| 血压 | 压 | `--color-primary-light` | `--color-primary` |
| 血糖 | 糖 | `--color-coral-light` | `--color-primary-dark` |
| 心率 | 心 | `--color-purple-light` | `--color-purple` |
| 睡眠 | 眠 | `--color-green-light` | `--color-green-dark` |
| 血氧 | 氧 | `--color-teal-light` | `--color-teal` |
| 心电 | 电 | `--color-coral-light` | `--color-primary-dark` |
| 体重 | 重 | `--color-primary-light` | `--color-primary` |
| 步数 | 步 | `--color-green-light` | `--color-green-dark` |
