# 个体健康曲线消融报告

数据类别：`test_synthetic_dry_run`

> 本报告不构成临床有效性证据。合成数据仅用于工程干跑。

独立老人切分：development=['demo_a']；test=['demo_b', 'demo_c', 'demo_d']；overlap=[]

| 变体 | horizon | MAE | 80%覆盖率 | 平均区间宽度 | 拒绝率 | last_value MAE | rolling_median MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| reference | 1 | 4.1100 | 1.0000 | 8.5600 | 0.6667 | 0.2000 | 5.1050 |
| reference | 3 | 3.3800 | 1.0000 | 7.1267 | 0.6667 | 2.8133 | 4.0083 |
| reference | 7 | 3.3000 | 0.6667 | 7.0883 | 0.6667 | 3.6700 | 3.4083 |
| reference | 14 | NA | NA | NA | 1.0000 | NA | NA |
| no_anomaly_handling | 1 | 4.1100 | 1.0000 | 8.5600 | 0.6667 | 0.2000 | 5.1050 |
| no_anomaly_handling | 3 | 3.3800 | 1.0000 | 7.1267 | 0.6667 | 2.8133 | 4.0083 |
| no_anomaly_handling | 7 | 3.3000 | 0.6667 | 7.0883 | 0.6667 | 3.6700 | 3.4083 |
| no_anomaly_handling | 14 | NA | NA | NA | 1.0000 | NA | NA |
| no_change_point | 1 | 4.1100 | 1.0000 | 8.5600 | 0.6667 | 0.2000 | 5.1050 |
| no_change_point | 3 | 3.3800 | 1.0000 | 7.1267 | 0.6667 | 2.8133 | 4.0083 |
| no_change_point | 7 | 3.3000 | 0.6667 | 7.0883 | 0.6667 | 3.6700 | 3.4083 |
| no_change_point | 14 | NA | NA | NA | 1.0000 | NA | NA |
| no_damping | 1 | 4.1100 | 1.0000 | 8.5600 | 0.6667 | 0.2000 | 5.1050 |
| no_damping | 3 | 3.6400 | 1.0000 | 7.8933 | 0.6667 | 2.8133 | 4.0083 |
| no_damping | 7 | 3.4150 | 0.6667 | 7.1567 | 0.6667 | 3.6700 | 3.4083 |
| no_damping | 14 | NA | NA | NA | 1.0000 | NA | NA |
| no_refusal | 1 | 6.8400 | 1.0000 | 15.8933 | 0.0000 | 5.1300 | 7.1717 |
| no_refusal | 3 | 6.8300 | 0.7500 | 13.4200 | 0.0000 | 6.6712 | 7.1519 |
| no_refusal | 7 | 4.5089 | 0.7895 | 15.2868 | 0.0000 | 7.9737 | 4.5621 |
| no_refusal | 14 | 5.4462 | 0.7436 | 15.7805 | 0.0000 | 5.5785 | 5.4086 |
| interval_gaussian_residual | 1 | 4.1100 | 1.0000 | 9.3500 | 0.6667 | 0.2000 | 5.1050 |
| interval_gaussian_residual | 3 | 3.3800 | 1.0000 | 9.0067 | 0.6667 | 2.8133 | 4.0083 |
| interval_gaussian_residual | 7 | 3.3000 | 0.8333 | 8.8200 | 0.6667 | 3.6700 | 3.4083 |
| interval_gaussian_residual | 14 | NA | NA | NA | 1.0000 | NA | NA |
| interval_pooled_conformal | 1 | 4.1100 | 1.0000 | 8.5200 | 0.6667 | 0.2000 | 5.1050 |
| interval_pooled_conformal | 3 | 3.3800 | 0.6667 | 7.2567 | 0.6667 | 2.8133 | 4.0083 |
| interval_pooled_conformal | 7 | 3.3000 | 0.6667 | 7.5967 | 0.6667 | 3.6700 | 3.4083 |
| interval_pooled_conformal | 14 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_ets | 1 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_ets | 3 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_ets | 7 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_ets | 14 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_kalman | 1 | 4.1100 | 1.0000 | 8.5600 | 0.6667 | 0.2000 | 5.1050 |
| candidates_baselines_kalman | 3 | 3.6400 | 1.0000 | 7.8933 | 0.6667 | 2.8133 | 4.0083 |
| candidates_baselines_kalman | 7 | 3.4150 | 0.6667 | 7.1567 | 0.6667 | 3.6700 | 3.4083 |
| candidates_baselines_kalman | 14 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_quantile | 1 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_quantile | 3 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_quantile | 7 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_quantile | 14 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_only | 1 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_only | 3 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_only | 7 | NA | NA | NA | 1.0000 | NA | NA |
| candidates_baselines_only | 14 | NA | NA | NA | 1.0000 | NA | NA |

评分公式：`prediction_error + 0.50×calibration_error + 0.35×instability_penalty + complexity_penalty`。

验收时必须换入有来源的真实纵向数据，并保持老人独立、严格时间外推和双基线对照。
