export const PREDICTION_SCHEMA_VERSION = 'health-prediction.v1';
export const VALUE_LABELS = Object.freeze({ measured: '直接测量值', estimated: '估计值', predicted: '预测值' });
export const CURVE_LINK_INPUT_FIELDS = Object.freeze([
  'metric', 'latest_value', 'trend', 'forecast_available', 'forecast_interval', 'quality_flags',
  'condition_coverage', 'boundary_hit', 'change_point', 'model_version', 'prediction_timestamp',
]);

